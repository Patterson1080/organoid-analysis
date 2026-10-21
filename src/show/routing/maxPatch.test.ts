import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NOTE_NAMES, activityAt, arpIntervalMs, chordOf, chordStep, expectedKicks, flagsIn, grainChance, grainLenBins,
    grainSpeed, grainTickMs, kickMs, nextFlag, patchData, showChordFlags, toneMs,
} from './maxPatch.ts';

const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);
const SCALE = 0.966766; // the patch's `scale 0. 0.966766 0. 1.`: a = v / SCALE
const v = (a: number) => a * SCALE;

test('tone intervals follow √a and hold past the table', () => {
    assert.equal(toneMs(0), 4800);
    assert.equal(toneMs(1), 50);
    assert.equal(toneMs(0.25), 600);
    assert.equal(toneMs(0.5), 300);
    assert.equal(toneMs(1.03), null);
});

test('kick intervals follow a, 3200 wins outlet 4, silence holds', () => {
    assert.equal(kickMs(0.1), 9600);
    assert.equal(kickMs(0.5), 3200);
    assert.equal(kickMs(0.9), 1200);
    assert.equal(kickMs(0), null);
    assert.equal(kickMs(1.03), null);
});

test('grains: tick from a^⅛, length from a^¼ with a doubling', () => {
    assert.equal(grainTickMs(0), 6.25);
    assert.equal(grainTickMs(1), 200);
    assert.equal(grainTickMs(0.5), 100);
    assert.deepEqual(grainLenBins(0), [6.25, 12.5]);
    assert.deepEqual(grainLenBins(1), [200, 400]);
    assert.deepEqual(grainLenBins(0.5), [100, 200]);
    assert.equal(grainSpeed(6.25), 64);
    assert.equal(grainSpeed(400), 1);
});

test('grain chance falls with activity and the LFO', () => {
    assert.equal(grainChance(0, 0), 0.9);
    assert.equal(grainChance(1, 0), 0.1);
    assert.equal(grainChance(0.0625, 0), 0.7);
    assert.equal(grainChance(0.25, 0.5), 0.25);
    assert.equal(grainChance(1, 1), 0);
});

test('the kick chain plays 0.9375 kicks per tick', () => {
    assert.equal(expectedKicks(), 0.9375);
});

test('the chord counter wraps through a held K', () => {
    assert.deepEqual([0, 1, 16, 17, 18, 46].map(chordStep), [1, 2, 17, 0, 1, 11]);
    assert.deepEqual(chordOf(1), { name: 'A', notes: [0, 0, 3, 7, 8], held: false });
    assert.deepEqual(chordOf(0), { name: 'K', notes: [2, 7, 7, 7, 11], held: true });
    assert.equal(chordOf(15).name, 'I');
    assert.equal(NOTE_NAMES[3], 'E♭');
});

test("arpeggio interval from arm 1's distance", () => {
    near(arpIntervalMs(100), 1015);
    near(arpIntervalMs(50), 265);
    near(arpIntervalMs(10), 25);
    near(arpIntervalMs(150), 1015);
    assert.equal(arpIntervalMs(0.5), null);
});

test('patchData finds flags and holds intervals, wrapping', () => {
    const p = patchData(new Float32Array([0, v(0.45), 0, 0]), new Float32Array([0, 1, 0, 0]));
    assert.deepEqual(Array.from(p.flags), [1]);
    assert.deepEqual(Array.from(p.kickHeldMs), [3200, 3200, 3200, 3200]);
    assert.deepEqual(Array.from(p.toneHeldMs), [4800, 300, 4800, 4800]);
    const loud = patchData(new Float32Array([v(0.45), 1.0]), new Float32Array(2));
    assert.deepEqual(Array.from(loud.toneHeldMs), [300, 300]);
    assert.deepEqual(Array.from(loud.kickHeldMs), [3200, 3200]);
});

test('activityAt beyond the data is null', () => {
    const p = patchData(new Float32Array([0, v(0.45), 0, 0]), new Float32Array(4));
    assert.equal(activityAt(p, 4), null);
    assert.equal(activityAt(p, -1), null);
    assert.ok(Math.abs((activityAt(p, 1) ?? 0) - v(0.45)) < 1e-6);
});

test('show chord flags count only the show range', () => {
    const p = patchData(new Float32Array(6), new Float32Array([0, 1, 0, 0, 1, 0]));
    assert.equal(flagsIn(p, 2, 5), 1);
    assert.equal(flagsIn(p, 1, 1), 1);
    assert.equal(showChordFlags(p, 2, 0, 5, 3), 3);
    assert.equal(showChordFlags(p, 2, 2, 5, 3), 1);
});

test('the next flag after an index', () => {
    const p = patchData(new Float32Array(6), new Float32Array([0, 1, 0, 0, 1, 0]));
    assert.equal(nextFlag(p, 0), 1);
    assert.equal(nextFlag(p, 1), 4);
    assert.equal(nextFlag(p, 4), null);
    assert.equal(nextFlag(p, 2.7), 4);
});
