import test from 'node:test';
import assert from 'node:assert/strict';
import { playRate, lowerBound, extrapolateIndex, formatClock, rateBins, cyclePosition, phaseRemainingMs, cueLabel, spikesBetween } from './showMath.ts';
import type { ShowState, SpikeEvent } from '../types';

const spikes: SpikeEvent[] = [10, 20, 20, 30, 1000].map((t, i) => ({ timestamp_ms: t, neuron_id: i }));
const base: ShowState = {
    running: true, pass: 1, phase: 'on', index: 100, phaseElapsedMs: 0, phaseDurationMs: 3_000_000,
    config: {
        startIndex: 0, endIndex: 179999, fps: 60, offSeconds: 120, fadeSeconds: 5, indexAddress: '/index',
        passStartCue: '/sim_resetSimsOnly', onAddress: '/sim_on', offAddress: '/sim_off', spreadCues: [],
    },
    cues: [], timing: { passFrames: 180000, passMs: 3_000_000, cycleMs: 3_120_000 }, destinations: [], leds: false,
};

test('lowerBound finds the first spike at or after t', () => {
    assert.equal(lowerBound(spikes, 0), 0);
    assert.equal(lowerBound(spikes, 20), 1);
    assert.equal(lowerBound(spikes, 21), 3);
    assert.equal(lowerBound(spikes, 5000), 5);
});

test('extrapolateIndex advances at fps and clamps at the pass end', () => {
    assert.equal(extrapolateIndex(base, 0), 100);
    assert.equal(extrapolateIndex(base, 500), 130);
    assert.equal(extrapolateIndex({ ...base, index: 179990 }, 10_000), 179999);
    assert.equal(extrapolateIndex({ ...base, phase: 'off', index: null }, 10), null);
    assert.equal(extrapolateIndex({ ...base, running: false }, 10), null);
});

test('playRate: the play panel\'s speed as indices a second, within the bridge\'s limits', () => {
    assert.equal(playRate(180000, 180), 1000); // 1x
    assert.equal(playRate(180000, 3000), 60); // the installation's 50-minute pass
    assert.equal(playRate(180000, 750), 240);
    assert.equal(playRate(180000, 10), 1000); // 18x asked: capped at 1x
    assert.equal(playRate(180000, 0), 1000); // no duration: real time
    assert.equal(playRate(1000, 3600), 1);
});

test('formatClock rounds up to whole seconds', () => {
    assert.equal(formatClock(1_487_000), '24:47');
    assert.equal(formatClock(83_001), '1:24');
    assert.equal(formatClock(0), '0:00');
    assert.equal(formatClock(-5), '0:00');
});

test('rateBins counts spikes per slice, end inclusive', () => {
    assert.deepEqual(Array.from(rateBins(spikes, 0, 1000, 4)), [4, 0, 0, 1]);
    assert.deepEqual(Array.from(rateBins(spikes, 0, 999, 2)), [4, 0]);
    assert.equal(rateBins([], 0, 1000, 8).length, 8);
});

test('cyclePosition: ON fills the first 50/52, OFF the rest; null when stopped', () => {
    assert.equal(cyclePosition({ ...base, phaseElapsedMs: 1_500_000 }), 1_500_000 / 3_120_000);
    assert.equal(
        cyclePosition({ ...base, phase: 'off', index: null, phaseElapsedMs: 60_000, phaseDurationMs: 120_000 }),
        3_060_000 / 3_120_000,
    );
    assert.equal(cyclePosition({ ...base, running: false, phase: 'stopped' }), null);
});

test('phaseRemainingMs counts down with extrapolation', () => {
    assert.equal(phaseRemainingMs({ ...base, phaseElapsedMs: 1000 }, 500), 2_998_500);
    assert.equal(phaseRemainingMs({ ...base, phaseElapsedMs: 3_000_000 }, 500), 0);
});

test('cueLabel abbreviates reset addresses', () => {
    assert.equal(cueLabel('/sim_resetTermites'), 'T');
    assert.equal(cueLabel('/sim_resetPhysarum'), 'P');
    assert.equal(cueLabel('/palette_next'), 'P');
    assert.equal(cueLabel(''), '•');
});

test('spikesBetween returns spikes in (after, upTo]', () => {
    assert.deepEqual(spikesBetween(spikes, 20, 30).map(s => s.timestamp_ms), [30]);
    assert.deepEqual(spikesBetween(spikes, 19, 20).map(s => s.timestamp_ms), [20, 20]);
    assert.deepEqual(spikesBetween(spikes, -1, 10).map(s => s.timestamp_ms), [10]);
    assert.deepEqual(spikesBetween(spikes, 30, 999), []);
});
