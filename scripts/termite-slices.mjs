#!/usr/bin/env node
// The termite form's mesh (dev/termites/Final_Scaled_Artifact.obj, ~870 MB) → data/termite_slices.bin:
// horizontal contours per print segment (one OBJ object each), chained and simplified, for the
// routing view's FAB card. Usage:
//   node scripts/termite-slices.mjs <mesh.obj> [out=data/termite_slices.bin] [step=2] [tolerance=0.25]

import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { rdp, sliceHeights, sliceMesh } from '../src/show/routing/slicer.ts';
import { encodeTermiteSlices } from '../src/show/routing/termiteSlices.ts';

const [objPath, out = 'data/termite_slices.bin', stepArg = '2', tolArg = '0.25'] = process.argv.slice(2);
if (!objPath) {
    console.error('usage: node scripts/termite-slices.mjs <mesh.obj> [out] [step] [tolerance]');
    process.exit(1);
}
const step = Number(stepArg), tolerance = Number(tolArg), started = Date.now();

let V = new Float32Array(1 << 20), nv = 0;
let F = new Uint32Array(1 << 21), nf = 0;
const objects = []; // { name, faceStart }
const grow = (a, need) => {
    if (need <= a.length) return a;
    const b = new a.constructor(Math.max(need, a.length * 2));
    b.set(a);
    return b;
};
const vertex = token => {
    const i = parseInt(token, 10); // 'v', 'v/vt', 'v//vn' and 'v/vt/vn' all start with v
    return i < 0 ? nv + i : i - 1;
};

for await (const line of createInterface({ input: createReadStream(objPath, { highWaterMark: 1 << 24 }), crlfDelay: Infinity })) {
    if (line.startsWith('v ')) {
        const p = line.split(/\s+/);
        V = grow(V, nv * 3 + 3);
        V[nv * 3] = +p[1];
        V[nv * 3 + 1] = +p[2];
        V[nv * 3 + 2] = +p[3];
        nv++;
    } else if (line.startsWith('f ')) {
        const p = line.trim().split(/\s+/).slice(1).map(vertex);
        for (let k = 1; k + 1 < p.length; k++) { // a polygon fans into triangles
            F = grow(F, nf * 3 + 3);
            F[nf * 3] = p[0];
            F[nf * 3 + 1] = p[k];
            F[nf * 3 + 2] = p[k + 1];
            nf++;
        }
    } else if (line.startsWith('o ') || line.startsWith('g ')) {
        objects.push({ name: line.slice(2).trim(), faceStart: nf });
    }
}
if (objects.length === 0 || objects[0].faceStart > 0) objects.unshift({ name: '(unnamed)', faceStart: 0 });
const mesh = { V: V.subarray(0, nv * 3), F: F.subarray(0, nf * 3) };
console.log(`read ${nv} vertices, ${nf} faces, ${objects.length} objects in ${((Date.now() - started) / 1000).toFixed(1)} s`);

const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
for (let i = 0; i < nv; i++) {
    const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
}

// Each object is a print segment; number them bottom to top, all cut on one grid of heights.
const parts = objects
    .map((o, i) => ({ ...o, faceEnd: i + 1 < objects.length ? objects[i + 1].faceStart : nf }))
    .filter(o => o.faceEnd > o.faceStart)
    .map(o => {
        let yMin = Infinity, yMax = -Infinity;
        for (let f = o.faceStart; f < o.faceEnd; f++) for (let k = 0; k < 3; k++) {
            const y = V[F[f * 3 + k] * 3 + 1];
            yMin = Math.min(yMin, y);
            yMax = Math.max(yMax, y);
        }
        return { ...o, yMin, yMax };
    })
    .sort((a, b) => a.yMin - b.yMin);
const heights = sliceHeights(bounds.minY, bounds.maxY, step);

let lines = 0, points = 0;
const segments = parts.map((p, i) => {
    const slices = sliceMesh(mesh, p.faceStart, p.faceEnd, heights).map(s => ({
        y: s.y,
        lines: s.lines.map(l => rdp(l, tolerance)).filter(l => l.length >= 4),
    }));
    for (const s of slices) for (const l of s.lines) { lines++; points += l.length / 2; }
    console.log(`segment ${i + 1}: ${p.name} · y ${p.yMin.toFixed(1)}…${p.yMax.toFixed(1)} · ${slices.length} slices`);
    return { yMin: p.yMin, yMax: p.yMax, slices };
});

const buf = encodeTermiteSlices({ step, bounds, segments });
writeFileSync(out, Buffer.from(buf));
console.log(`${segments.length} segments · ${heights.length} heights · ${lines} polylines · ${points} points → ${out} (${(buf.byteLength / 1e6).toFixed(2)} MB) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
