import test from 'node:test';
import assert from 'node:assert/strict';
import { rdp, sliceHeights, sliceMesh } from './slicer.ts';
import type { Mesh } from './slicer.ts';

const mesh = (verts: number[][], faces: number[][]): Mesh => ({ V: Float32Array.from(verts.flat()), F: Uint32Array.from(faces.flat()) });
const pairs = (a: Float32Array) => Array.from({ length: a.length / 2 }, (_, i) => [a[i * 2], a[i * 2 + 1]]);
const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test('slice heights sit mid-step', () => {
    assert.deepEqual(sliceHeights(0, 10, 4), [2, 6]);
});

test('a tetrahedron cut in the middle gives one closed contour', () => {
    // apex up at y = 1, base triangle at y = 0; the cut at 0.5 meets each slanted edge at its middle
    const tet = mesh([[0, 1, 0], [1, 0, 0], [-1, 0, 1], [-1, 0, -1]], [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]]);
    const [slice] = sliceMesh(tet, 0, 4, [0.5]);
    assert.equal(slice.y, 0.5);
    assert.equal(slice.lines.length, 1);
    const pts = pairs(slice.lines[0]);
    assert.equal(pts.length, 4);
    assert.ok(close(pts[0], pts[3]), 'closed');
    for (const want of [[0.5, 0], [-0.5, 0.5], [-0.5, -0.5]]) assert.ok(pts.some(p => close(p, want)), `missing ${want}`);
});

test('a triangle touching the plane at a vertex gives no segment', () => {
    const [slice] = sliceMesh(mesh([[0, 0, 0], [1, 1, 0], [0, 1, 1]], [[0, 1, 2]]), 0, 1, [0]);
    assert.equal(slice.lines.length, 0);
});

test('two triangles sharing an edge chain into one polyline', () => {
    const quad = mesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 1, 2], [0, 2, 3]]);
    const [slice] = sliceMesh(quad, 0, 2, [0.5]);
    assert.equal(slice.lines.length, 1);
    const pts = pairs(slice.lines[0]);
    assert.equal(pts.length, 3);
    assert.ok(close(pts[1], [0.5, 0]), 'the shared diagonal is the middle point');
});

test("heights outside the faces' range are skipped, so segments share one grid", () => {
    const quad = mesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 1, 2], [0, 2, 3]]);
    assert.deepEqual(sliceMesh(quad, 0, 2, [-0.5, 0.5, 1.5]).map(s => s.y), [0.5]);
});

test('rdp keeps corners and drops collinear points', () => {
    const l = Float32Array.from([0, 0, 1, 0, 2, 0, 2, 1, 2, 2]);
    assert.deepEqual(Array.from(rdp(l, 0.1)), [0, 0, 2, 0, 2, 2]);
    const square = Float32Array.from([0, 0, 1, 0, 2, 0, 2, 1, 2, 2, 1, 2, 0, 2, 0, 1, 0, 0]);
    assert.deepEqual(Array.from(rdp(square, 0.1)), [0, 0, 2, 0, 2, 2, 0, 2, 0, 0]);
});
