// TSL1: the termite form as print-layer contours, one stack per print segment (bottom to top),
// small enough for the page. Made by scripts/termite-slices.mjs from the form's mesh.
//
//   'TSL1' · uint32 segments · float32 step · float32 minX maxX minY maxY minZ maxZ
//   per segment: float32 yMin yMax · uint32 slices
//     per slice: float32 y · uint32 lines
//       per line: uint32 points · points × (int16 x, int16 z), quantized over the x and z bounds

import type { Slice } from './slicer.ts';

export interface TermiteSegment {
    yMin: number;
    yMax: number;
    slices: Slice[];
}

export interface TermiteSlices {
    step: number;
    bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
    segments: TermiteSegment[];
}

const MAGIC = 'TSL1';
const Q = 65535;

const span = (lo: number, hi: number) => (hi > lo ? hi - lo : 1);
const quantize = (v: number, lo: number, hi: number) => Math.round(((v - lo) / span(lo, hi)) * Q) - 32768;
const restore = (q: number, lo: number, hi: number) => lo + ((q + 32768) / Q) * span(lo, hi);

export function encodeTermiteSlices(t: TermiteSlices): ArrayBuffer {
    let bytes = 4 + 4 + 4 + 24;
    for (const seg of t.segments) {
        bytes += 12;
        for (const slice of seg.slices) {
            bytes += 8;
            for (const line of slice.lines) bytes += 4 + (line.length / 2) * 4;
        }
    }
    const buf = new ArrayBuffer(bytes);
    const dv = new DataView(buf);
    let at = 0;
    const u32 = (v: number) => { dv.setUint32(at, v, true); at += 4; };
    const f32 = (v: number) => { dv.setFloat32(at, v, true); at += 4; };
    const i16 = (v: number) => { dv.setInt16(at, v, true); at += 2; };
    for (let i = 0; i < 4; i++) dv.setUint8(at++, MAGIC.charCodeAt(i));
    const b = t.bounds;
    u32(t.segments.length);
    f32(t.step);
    [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].forEach(f32);
    for (const seg of t.segments) {
        f32(seg.yMin);
        f32(seg.yMax);
        u32(seg.slices.length);
        for (const slice of seg.slices) {
            f32(slice.y);
            u32(slice.lines.length);
            for (const line of slice.lines) {
                u32(line.length / 2);
                for (let i = 0; i < line.length; i += 2) {
                    i16(quantize(line[i], b.minX, b.maxX));
                    i16(quantize(line[i + 1], b.minZ, b.maxZ));
                }
            }
        }
    }
    return buf;
}

export function parseTermiteSlices(buf: ArrayBuffer): TermiteSlices {
    const dv = new DataView(buf);
    let at = 0;
    const need = (n: number) => { if (at + n > buf.byteLength) throw new Error('truncated TSL1'); };
    const u32 = () => { need(4); const v = dv.getUint32(at, true); at += 4; return v; };
    const f32 = () => { need(4); const v = dv.getFloat32(at, true); at += 4; return v; };
    need(4);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== MAGIC) throw new Error('not a TSL1 file');
    at = 4;
    const count = u32();
    if (count === 0) throw new Error('no segments');
    const step = f32();
    const [minX, maxX, minY, maxY, minZ, maxZ] = [f32(), f32(), f32(), f32(), f32(), f32()];
    const segments: TermiteSegment[] = [];
    for (let s = 0; s < count; s++) {
        const yMin = f32(), yMax = f32(), sliceCount = u32();
        const slices: Slice[] = [];
        for (let k = 0; k < sliceCount; k++) {
            const y = f32(), lineCount = u32();
            const lines: Float32Array[] = [];
            for (let l = 0; l < lineCount; l++) {
                const points = u32();
                need(points * 4);
                const line = new Float32Array(points * 2);
                for (let p = 0; p < points; p++) {
                    line[p * 2] = restore(dv.getInt16(at, true), minX, maxX);
                    line[p * 2 + 1] = restore(dv.getInt16(at + 2, true), minZ, maxZ);
                    at += 4;
                }
                lines.push(line);
            }
            slices.push({ y, lines });
        }
        segments.push({ yMin, yMax, slices });
    }
    return { step, bounds: { minX, maxX, minY, maxY, minZ, maxZ }, segments };
}
