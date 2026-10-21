import test from 'node:test';
import assert from 'node:assert/strict';
import { routingPlayhead } from './playhead.ts';
import type { ShowState } from '../../types';

const state: ShowState = {
    running: true, pass: 1, phase: 'on', index: 100, phaseElapsedMs: 0, phaseDurationMs: 3_000_000,
    config: {
        startIndex: 0, endIndex: 179999, fps: 60, offSeconds: 120, fadeSeconds: 5, indexAddress: '/index',
        passStartCue: '/sim_resetSimsOnly', onAddress: '/sim_on', offAddress: '/sim_off', spreadCues: [],
    },
    cues: [], timing: { passFrames: 180000, passMs: 3_000_000, cycleMs: 3_120_000 }, destinations: [], leds: false,
};

test('follows the show clock while the show runs and the bridge is there', () => {
    assert.deepEqual(routingPlayhead({ state, receivedAt: 0 }, true, 42, true, 500), { index: 130, phase: 'on', mode: 'show', offRemainingMs: 0, pass: 1, range: { start: 0, end: 179999 } });
});

test('OFF has no index and counts down', () => {
    const off = { ...state, phase: 'off' as const, index: null, phaseElapsedMs: 30_000, phaseDurationMs: 120_000 };
    assert.deepEqual(routingPlayhead({ state: off, receivedAt: 0 }, true, 42, true, 1000), { index: null, phase: 'off', mode: 'show', offRemainingMs: 89_000, pass: 1, range: { start: 0, end: 179999 } });
});

test('a dropped bridge falls back to local playback', () => {
    assert.deepEqual(routingPlayhead({ state, receivedAt: 0 }, false, 42, true, 500), { index: 42, phase: 'stopped', mode: 'local', offRemainingMs: 0, pass: 1, range: { start: 0, end: 179999 } });
});

test('no show and no data: no playhead', () => {
    assert.deepEqual(routingPlayhead(null, true, 42, false, 500), { index: null, phase: 'stopped', mode: 'local', offRemainingMs: 0, pass: 1, range: { start: 0, end: 179999 } });
    assert.equal(routingPlayhead(null, true, 42, true, 500).index, 42);
});

test('the show playhead carries pass and range', () => {
    const second = { ...state, pass: 2, config: { ...state.config, startIndex: 100, endIndex: 900 } };
    const p = routingPlayhead({ state: second, receivedAt: 0 }, true, 42, true, 500);
    assert.equal(p.pass, 2);
    assert.deepEqual(p.range, { start: 100, end: 900 });
});

test('local playback is pass 1 over the whole recording', () => {
    const p = routingPlayhead(null, true, 42, true, 500);
    assert.equal(p.pass, 1);
    assert.deepEqual(p.range, { start: 0, end: 179999 });
});
