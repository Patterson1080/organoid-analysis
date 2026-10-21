import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTermiteSlices, parseTermiteSlices } from './termiteSlices.ts';
import type { TermiteSlices } from './termiteSlices.ts';

const bounds = { minX: -10, maxX: 10, minY: 0, maxY: 40, minZ: -5, maxZ: 15 };
const sample = (): TermiteSlices => ({
    step: 2,
    bounds,
    segments: [
        { yMin: 0, yMax: 20, slices: [{ y: 1, lines: [Float32Array.from([-10, -5, 0, 0, 10, 15])] }, { y: 3, lines: [] }] },
        { yMin: 20, yMax: 40, slices: [{ y: 21, lines: [Float32Array.from([1.25, 2.5, 3.75, 5]), Float32Array.from([-9.5, 14.5, 9.5, -4.5])] }] },
    ],
});

test('TSL1 round-trips within the quantization', () => {
    const t = parseTermiteSlices(encodeTermiteSlices(sample()));
    assert.equal(t.step, 2);
    assert.deepEqual(t.bounds, bounds);
    assert.deepEqual(t.segments.map(s => [s.yMin, s.yMax, s.slices.length]), [[0, 20, 2], [20, 40, 1]]);
    assert.deepEqual(t.segments.flatMap(s => s.slices.map(sl => sl.y)), [1, 3, 21]);
    const want = sample().segments.flatMap(s => s.slices.flatMap(sl => sl.lines.flatMap(l => Array.from(l))));
    const got = t.segments.flatMap(s => s.slices.flatMap(sl => sl.lines.flatMap(l => Array.from(l))));
    assert.equal(got.length, want.length);
    const tol = 20 / 65535; // the larger of the x and z spans over the int16 steps
    got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= tol, `${v} vs ${want[i]}`));
});

test('a segment without slices round-trips', () => {
    const t = sample();
    t.segments[1].slices = [];
    assert.deepEqual(parseTermiteSlices(encodeTermiteSlices(t)).segments[1].slices, []);
});

test('bad files throw', () => {
    const good = new Uint8Array(encodeTermiteSlices(sample()));
    const magic = good.slice();
    magic[0] = 'X'.charCodeAt(0);
    assert.throws(() => parseTermiteSlices(magic.buffer), /not a TSL1 file/);
    assert.throws(() => parseTermiteSlices(good.slice(0, good.length - 3).buffer), /truncated TSL1/);
    assert.throws(() => parseTermiteSlices(encodeTermiteSlices({ ...sample(), segments: [] })), /no segments/);
});
