import test from 'node:test';
import assert from 'node:assert/strict';
import { depthAlpha, fabPanels, pairLayout, sliceStride, termiteStack, vesselStack } from './sliceView.ts';
import type { Box } from './layout.ts';
import type { TermiteSlices } from './termiteSlices.ts';
import type { Vessel } from './vessel.ts';

test('the front gets the higher alpha', () => {
    assert.equal(depthAlpha(10, 10), 1);
    assert.equal(depthAlpha(-10, 10), 0.25);
    const mid = depthAlpha(0, 10);
    assert.ok(mid > 0.25 && mid < 1);
});

test('the stride keeps slices 3 px apart', () => {
    assert.equal(sliceStride(285, 300), 3);
    assert.equal(sliceStride(285, 2000), 1);
    assert.equal(sliceStride(0, 100), 1);
});

test('the vessel becomes one closed loop per layer', () => {
    const v: Vessel = {
        layers: [{ pts: Float32Array.from([1, 0, 0, 1, -1, 0]), radius: 1 }, { pts: Float32Array.from([2, 0, 0, 2]), radius: 2 }],
        layerMm: 1.6, heightMm: 3.2, maxRadius: 2, header: {},
    };
    const stack = vesselStack(v);
    assert.deepEqual(stack.map(s => [s.y, s.segment]), [[1.6, -1], [3.2, -1]]);
    assert.deepEqual(Array.from(stack[0].lines[0]), [1, 0, 0, 1, -1, 0, 1, 0]);
});

test('segments explode upward in order', () => {
    const slice = (y: number) => ({ y, lines: [Float32Array.from([0, 0, 1, 1])] });
    const t: TermiteSlices = {
        step: 2, bounds: { minX: 0, maxX: 1, minY: 0, maxY: 30, minZ: 0, maxZ: 1 },
        segments: [0, 10, 20].map(y => ({ yMin: y, yMax: y + 10, slices: [slice(y + 1), slice(y + 3)] })),
    };
    const stack = termiteStack(t, 10);
    assert.deepEqual(stack.map(s => [s.y, s.segment]), [[1, 0], [3, 0], [21, 1], [23, 1], [41, 2], [43, 2]]);
});

test('fab panels tile the story at any aspect', () => {
    const EPS = 1e-9;
    const inside = (o: Box, i: Box) => i.x >= o.x - EPS && i.y >= o.y - EPS && i.x + i.w <= o.x + o.w + EPS && i.y + i.h <= o.y + o.h + EPS;
    const overlap = (a: Box, b: Box) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
    for (const story of [{ x: 40, y: 30, w: 1600, h: 700 }, { x: 0, y: 0, w: 2960, h: 420 }, { x: 12, y: 50, w: 300, h: 860 }]) {
        const boxes = Object.values(fabPanels(story));
        assert.equal(boxes.length, 3);
        for (const b of boxes) assert.ok(inside(story, b) && b.w > 0 && b.h > 0, JSON.stringify(b));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]));
    }
});

test('one scale for both, on one ground line', () => {
    const box = { x: 10, y: 20, w: 600, h: 400 };
    const p = pairLayout(box, { w: 233, h: 700 }, { w: 332, h: 451 }, 20);
    assert.ok(p.termite && p.vessel);
    const t = p.termite as Box, v = p.vessel as Box;
    assert.ok(Math.abs(t.h / v.h - 700 / 451) < 1e-9, 'heights keep their ratio');
    assert.ok(Math.abs(t.w / t.h - 233 / 700) < 1e-9 && Math.abs(v.w / v.h - 332 / 451) < 1e-9);
    assert.equal(t.y + t.h, box.y + box.h);
    assert.equal(v.y + v.h, box.y + box.h);
    for (const b of [t, v]) assert.ok(b.x >= box.x - 1e-9 && b.y >= box.y - 1e-9 && b.x + b.w <= box.x + box.w + 1e-9);
    assert.ok(t.x + t.w + 20 <= v.x + 1e-9, 'side by side with the gap');
    assert.ok(Math.abs(p.mmPerPx - 700 / t.h) < 1e-9);
});

test('a lone artifact fills the pair box', () => {
    const box = { x: 0, y: 0, w: 600, h: 400 };
    const p = pairLayout(box, null, { w: 332, h: 451 }, 20);
    assert.equal(p.termite, null);
    const v = p.vessel as Box;
    assert.ok(Math.abs(v.h - 400) < 1e-9 && Math.abs(v.x + v.w / 2 - 300) < 1e-9);
});
