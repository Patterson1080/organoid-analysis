import test from 'node:test';
import assert from 'node:assert/strict';
import { cablePoint, organoidCable, patchArc } from './cables.ts';
import type { Cable } from './cables.ts';
import { routingLayout } from './layout.ts';
import type { Box } from './layout.ts';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const insideBox = (b: Box, [x, y]: [number, number], eps = 0.5) => x > b.x + eps && x < b.x + b.w - eps && y > b.y + eps && y < b.y + b.h - eps;
const length = (c: Cable) => {
    let len = 0, prev = cablePoint(c, 0);
    for (let i = 1; i <= 64; i++) {
        const p = cablePoint(c, i / 64);
        len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        prev = p;
    }
    return len;
};
const parallel = (a: [number, number], b: [number, number]) => near(a[0] * b[1] - a[1] * b[0], 0, 1e-6 * Math.hypot(...a) * Math.hypot(...b)) && a[0] * b[0] + a[1] * b[1] > 0;

test('a cable leaves the rim radially and meets the card square to its facing edge, at its middle', () => {
    const centre = { cx: 500, cy: 400, r: 200 };
    const card: Box = { x: 20, y: 30, w: 200, h: 160 };
    const c = organoidCable(centre, card, 'right');
    assert.deepEqual(c.p3, [220, 110]);
    assert.ok(near(Math.hypot(c.p0[0] - 500, c.p0[1] - 400), 203), 'just outside the rim');
    assert.ok(parallel([c.p1[0] - c.p0[0], c.p1[1] - c.p0[1]], [c.p0[0] - 500, c.p0[1] - 400]), 'radial at the rim');
    assert.ok(parallel([c.p3[0] - c.p2[0], c.p3[1] - c.p2[1]], [-1, 0]), 'square into the right edge');
    assert.deepEqual(cablePoint(c, 0), c.p0);
    assert.deepEqual(cablePoint(c, 1), c.p3);
});

test('a cable leaves the rim toward the open space beside the cards, not straight at them', () => {
    const centre = { cx: 500, cy: 400, r: 200 };
    const above: Box = { x: 20, y: 30, w: 200, h: 160 }; // left of the organoid, above its centre
    const direct = Math.atan2(110 - 400, 220 - 500);
    const c = organoidCable(centre, above, 'right');
    const left = Math.atan2(c.p0[1] - 400, c.p0[0] - 500);
    assert.ok(left > direct && left < -Math.PI / 2, `leaves higher up the rim (${left.toFixed(2)} vs ${direct.toFixed(2)})`); // canvas y is down: up-left is (−π, −π/2)
    const level: Box = { x: 20, y: 320, w: 200, h: 160 }; // square across from the centre
    const straight = organoidCable(centre, level, 'right');
    assert.ok(near(straight.p0[1], 400), 'a card level with the centre is met straight across');
    const below: Box = { x: 40, y: 640, w: 300, h: 100 }; // portrait: under the organoid, to the left
    const p = organoidCable(centre, below, 'top');
    const pa = Math.atan2(p.p0[1] - 400, p.p0[0] - 500), pd = Math.atan2(640 - 400, 190 - 500);
    assert.ok(pa > pd, `leaves further round toward the side (${pa.toFixed(2)} vs ${pd.toFixed(2)})`);
});

for (const [w, h] of [[1600, 900], [1440, 860], [1100, 1000], [900, 1600], [600, 1200]]) {
    test(`cables at ${w}×${h} stay clear of the organoid and the cards, and are long enough to see`, () => {
        const l = routingLayout(w, h), { cx, cy, r } = l.centre;
        for (const [key, c] of Object.entries(l.cables)) {
            assert.ok(length(c) >= 0.15 * r, `${key} is ${length(c).toFixed(1)} long, r ${r.toFixed(1)}`);
            for (let i = 1; i < 32; i++) {
                const p = cablePoint(c, i / 32);
                assert.ok(Math.hypot(p[0] - cx, p[1] - cy) > r, `${key} crosses into the organoid at t ${i / 32}`);
                for (const [k, b] of Object.entries(l.cards)) assert.ok(!insideBox(b, p), `${key} runs over ${k} at t ${i / 32}`);
            }
        }
    });
}

test('the strikes arc joins the sound and solenoid cards on the side facing the organoid', () => {
    const from: Box = { x: 600, y: 20, w: 300, h: 200 }, to: Box = { x: 600, y: 230, w: 300, h: 150 };
    const c = patchArc(from, to, 'left', 40);
    assert.equal(c.p0[0], 600);
    assert.equal(c.p3[0], 600);
    assert.ok(c.p0[1] > from.y + from.h / 2 && c.p0[1] < from.y + from.h, 'leaves the lower half of the sound card');
    assert.ok(c.p3[1] > to.y && c.p3[1] < to.y + to.h / 2, 'enters the upper half of the solenoid card');
    const apex = cablePoint(c, 0.5);
    assert.ok(near(apex[0], 600 - 0.75 * 40), 'bows out by three quarters of the bulge');
    for (let i = 1; i < 32; i++) {
        const p = cablePoint(c, i / 32);
        assert.ok(!insideBox(from, p) && !insideBox(to, p), `runs over a card at t ${i / 32}`);
    }
});
