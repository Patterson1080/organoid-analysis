import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_PAD, createSwarm, fleeSources, stepSwarm } from './swarm.ts';
import type { SwarmSpec } from './swarm.ts';

const lcg = (seed = 1) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const straight: SwarmSpec = { perNeuron: 1, step: 0.01, turn: 0, spread: 10, speedMul: 2 };

test('agents start near their neuron', () => {
    const s = createSwarm([{ x: 0, y: 0 }, { x: 1, y: 1 }], { ...straight, perNeuron: 3, spread: 0.05 }, lcg());
    assert.equal(s.count, 6);
    const homes = [[HOME_PAD, HOME_PAD], [1 - HOME_PAD, 1 - HOME_PAD]];
    for (let i = 0; i < s.count; i++) {
        const [hx, hy] = homes[i % 2];
        assert.ok(Math.hypot(s.x[i] - hx, s.y[i] - hy) <= 0.05, `agent ${i} near neuron ${i % 2}`);
    }
});

test("firing neurons' agents move speedMul times as far", () => {
    const s = createSwarm([{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 0.5, y: 0.2 }], straight, lcg());
    const before = [s.x[0], s.y[0], s.x[1], s.y[1], s.x[2], s.y[2]];
    stepSwarm(s, new Float32Array([1, 0, 0.15]), 0.1, 1, null, lcg(7));
    assert.ok(Math.abs(Math.hypot(s.x[0] - before[0], s.y[0] - before[1]) - 0.02) < 1e-9);
    assert.ok(Math.abs(Math.hypot(s.x[1] - before[2], s.y[1] - before[3]) - 0.01) < 1e-9);
    // threshold-based like EoC: just over the threshold is the full multiplier, not a graded one
    assert.ok(Math.abs(Math.hypot(s.x[2] - before[4], s.y[2] - before[5]) - 0.02) < 1e-9);
});

test('agents flee a firing termite', () => {
    const s = createSwarm([{ x: 0.5, y: 0.5 }], straight, lcg());
    s.x[0] = 0.5;
    s.y[0] = 0.5;
    s.h[0] = 0; // heading straight at the source
    stepSwarm(s, new Float32Array([0]), 0.1, 1, [0.51, 0.5], lcg(7));
    assert.ok(Math.hypot(s.x[0] - 0.51, s.y[0] - 0.5) > 0.01);
});

test('fleeSources returns firing termites only', () => {
    const t = createSwarm([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], { ...straight, spread: 0.01 }, lcg());
    const out = fleeSources(t, new Float32Array([0.2, 0.05]), 0.1, []);
    assert.deepEqual(out, [t.x[0], t.y[0]]);
});
