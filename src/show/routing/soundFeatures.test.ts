import test from 'node:test';
import assert from 'node:assert/strict';
import { paperMappings, peakRate, populationRate, stepBurst } from './soundFeatures.ts';
import type { SpikeEvent } from '../../types';

const s: SpikeEvent[] = [1, 50, 99, 100, 101, 250].map((t, i) => ({ timestamp_ms: t, neuron_id: i + 1 }));

test('rate counts the window ending at the index', () => {
    assert.equal(populationRate(s, 100), 4);
    assert.equal(populationRate(s, 200), 1);
});

test('peak is the busiest window', () => {
    assert.equal(peakRate(s), 4);
    assert.equal(peakRate([]), 1);
});

test('a burst end is counted once', () => {
    let b = stepBurst({ inBurst: false, ends: 0 }, 50, 40);
    assert.deepEqual(b, { inBurst: true, ends: 0 });
    b = stepBurst(b, 30, 40);
    assert.deepEqual(b, { inBurst: false, ends: 1 });
    b = stepBurst(b, 30, 40);
    assert.deepEqual(b, { inBurst: false, ends: 1 });
});

test('mappings hit the published ranges', () => {
    assert.deepEqual(paperMappings(0), { toneDensity: 0.21, grainDensity: 160, grainMs: 6.25, kickDensity: 0.83 });
    assert.deepEqual(paperMappings(1), { toneDensity: 20, grainDensity: 5, grainMs: 400, kickDensity: 0.1 });
    assert.ok(Math.abs(paperMappings(0.25).toneDensity - 10.105) < 1e-9);
    assert.deepEqual(paperMappings(-1), paperMappings(0));
});
