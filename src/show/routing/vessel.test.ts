import test from 'node:test';
import assert from 'node:assert/strict';
import { layerForIndex, parseVesselGcode, printedLayers } from './vessel.ts';
import type { Vessel } from './vessel.ts';

/** A circular spiral like the growth sketch's export: header, priming moves, marker, then the climb. */
function spiral(turns: number, perTurn: number, layerMm: number, r: number, cx: number, cy: number): string {
    const lines = [
        '; Export DifferentialLineSingle object (stacked)',
        `; layers=${turns}`,
        `; layerHeight=${layerMm}, nozzle=4.0`,
        'G1 X205.00 Y202.50 F10000',
        'G1 Z20',
        ';;; ======',
    ];
    for (let i = 0; i < turns * perTurn; i++) {
        const a = (i / perTurn) * 2 * Math.PI;
        const x = (cx + r * Math.cos(a)).toFixed(3), y = (cy + r * Math.sin(a)).toFixed(3), z = ((i / perTurn) * layerMm).toFixed(3);
        lines.push(`G1 F1200 X${x} Y${y} Z${z} E${i}`);
    }
    return lines.join('\n');
}

test('a spiral splits into layers centred on its axis', () => {
    const v = parseVesselGcode(spiral(3, 40, 1.6, 10, 100, 50), 20);
    assert.equal(v.layers.length, 3);
    let sumX = 0, count = 0;
    for (const layer of v.layers) {
        assert.equal(layer.pts.length, 40);
        assert.ok(Math.abs(layer.radius - 10) < 0.01, `radius ${layer.radius}`);
        for (let i = 0; i < layer.pts.length; i += 2) { sumX += layer.pts[i]; count++; }
    }
    assert.ok(Math.abs(sumX / count) < 0.5, `mean x ${sumX / count}`);
    assert.equal(v.header.layerHeight, '1.6');
    assert.equal(v.header.nozzle, '4.0');
    assert.ok(Math.abs(v.heightMm - 4.76) < 0.001, `height ${v.heightMm}`);
});

test('a bare G-code parses with defaults', () => {
    const v = parseVesselGcode('G1 X0 Y10 Z0.2\nG1 X10 Y0 Z0.2\nG1 X0 Y-10 Z0.2\n');
    assert.equal(v.layerMm, 1.6);
    assert.equal(v.layers.length, 1);
});

test('no moves throws', () => {
    assert.throws(() => parseVesselGcode('; nothing\n'), /no toolpath moves/);
});

test('moves that make no layer throw too (a vessel always has one)', () => {
    assert.throws(() => parseVesselGcode('G1 X0 Y10 Z-1\nG1 X10 Y0 Z-1\n'), /no toolpath layers/);
});

const v283: Vessel = {
    layers: Array.from({ length: 283 }, () => ({ pts: new Float32Array(0), radius: 0 })),
    layerMm: 1.6,
    heightMm: 451.2,
    maxRadius: 0,
    header: {},
};

test('the index walks the layers linearly', () => {
    assert.equal(layerForIndex(v283, 0), 0);
    assert.equal(layerForIndex(v283, 90000), 141);
    assert.equal(layerForIndex(v283, 179999), 282);
    assert.equal(layerForIndex(v283, -5), 0);
    assert.equal(layerForIndex(v283, 200000), 282);
});

test('printed cut-off', () => {
    assert.equal(printedLayers(v283, null), 283);
    assert.equal(printedLayers(v283, 3.2), 2);
    assert.equal(printedLayers(v283, 0), 0);
    assert.equal(printedLayers(v283, 9999), 283);
});

test('layers count from where the toolpath starts: each is one whole turn, closed', () => {
    // The exporter starts each turn half a layer up (Z0.8 for 1.6 mm): bins from z = 0 cut every turn in two.
    const lines = ['; layerHeight=1.6', ';;; ======'];
    for (let i = 0; i < 3 * 40; i++) {
        const a = (i / 40) * 2 * Math.PI;
        lines.push(`G1 X${(10 * Math.cos(a)).toFixed(3)} Y${(10 * Math.sin(a)).toFixed(3)} Z${(0.8 + (i / 40) * 1.6).toFixed(3)}`);
    }
    const v = parseVesselGcode(lines.join('\n'), 40);
    assert.equal(v.layers.length, 3);
    for (const { pts } of v.layers) {
        const gap = Math.hypot(pts[pts.length - 2] - pts[0], pts[pts.length - 1] - pts[1]);
        assert.ok(gap < 2, `a turn's ends ${gap.toFixed(1)} mm apart`); // one step of 40 around r 10 is 1.6 mm
    }
});

test('a printed height on a layer boundary counts that layer', () => {
    const v = parseVesselGcode(spiral(5, 40, 1.6, 10, 0, 0));
    assert.equal(printedLayers(v, 4.8), 3); // 4.8 / 1.6 is 2.9999999999999996 in floating point
});
