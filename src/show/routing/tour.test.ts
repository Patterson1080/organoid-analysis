import test from 'node:test';
import assert from 'node:assert/strict';
import { createTour, setTourEnabled, tourCurrent, tourInteract, tourPaused, tourProgress, tourTick } from './tour.ts';

test('dwell walks the stops and wraps', () => {
    let s = createTour(0);
    s = tourTick(s, 19_999);
    assert.equal(tourCurrent(s), 'overview');
    s = tourTick(s, 20_000);
    assert.equal(tourCurrent(s), 'visual');
    s = tourTick(s, 40_000);
    assert.equal(tourCurrent(s), 'sound');
    s = tourTick(s, 140_000);
    assert.equal(tourCurrent(s), 'overview');
});

test('interaction pauses for 60 s, then restarts at the overview', () => {
    const s = tourInteract(tourTick(createTour(0), 25_000), 30_000);
    assert.equal(tourPaused(s, 89_999), true);
    const resumed = tourTick(s, 90_000);
    assert.equal(tourPaused(resumed, 90_000), false);
    assert.equal(tourCurrent(resumed), 'overview');
    assert.equal(resumed.stopStartedAt, 90_000);
});

test('interaction while paused extends the pause', () => {
    const s = tourInteract(tourInteract(createTour(0), 30_000), 80_000);
    assert.equal(tourPaused(s, 139_999), true);
    assert.equal(tourPaused(s, 140_000), false);
});

test('a disabled tour never moves', () => {
    const s = createTour(0, false);
    assert.equal(tourCurrent(tourTick(s, 500_000)), 'overview');
    const on = setTourEnabled(tourTick(s, 500_000), true, 500_000);
    assert.equal(on.stopStartedAt, 500_000);
    assert.equal(tourCurrent(tourTick(on, 520_000)), 'visual');
});

test('progress', () => {
    assert.equal(tourProgress(createTour(0), 10_000), 0.5);
    assert.equal(tourProgress(tourInteract(createTour(0), 5_000), 10_000), 0);
});
