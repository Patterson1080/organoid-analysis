import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_CAP, createSoundSim, droneLevel, eventsSince, schedule, stepSoundSim } from './soundEvents.ts';
import type { SimInput, SoundEvent } from './soundEvents.ts';

const CHORD_A = [0, 0, 3, 7, 8];
const base = (over: Partial<SimInput>): SimInput => ({
    now: 0, dtMs: 100, notes: CHORD_A, toneMs: null, kickMs: null, grainTickMs: null, grainChance: 0, grainLen: null, arpMs: null, ...over,
});

/** Steps of 100 ms from now = 100, then every event the sim kept. */
function run(steps: number, over: Partial<SimInput>, seed = 1): SoundEvent[] {
    const sim = createSoundSim(seed, 0);
    for (let i = 1; i <= steps; i++) stepSoundSim(sim, base({ ...over, now: i * 100, dtMs: 100 }));
    return eventsSince(sim, -Infinity);
}

test('tone ticks land on the interval cadence', () => {
    const tones = run(10, { toneMs: 200 }).filter(e => e.kind === 'tone');
    assert.deepEqual(tones.map(e => e.at), [200, 400, 600, 800, 1000]);
    assert.ok(tones.every(e => [0, 3, 7, 8].includes(e.pc)));
    assert.ok(tones.every(e => e.position >= 0 && e.position <= 16));
});

test('grain counts follow the chance', () => {
    const grains = run(1000, { grainTickMs: 10, grainChance: 0.25, grainLen: [25, 50] }).filter(e => e.kind === 'grain');
    assert.ok(Math.abs(grains.length - 2500) <= 150, `${grains.length} grains`);
    assert.ok(grains.every(e => e.speed === 16 || e.speed === 8));
});

test('kicks follow the decide chain', () => {
    const kicks = run(16000, { kickMs: 1600 }).filter(e => e.kind === 'kick');
    const byEcho = [0, 1, 2, 3].map(k => kicks.filter(e => e.echo === k).length);
    assert.ok(Math.abs(byEcho[0] - 500) <= 50, `echo 0: ${byEcho[0]}`);
    assert.ok(Math.abs(byEcho[1] - 250) <= 40, `echo 1: ${byEcho[1]}`);
    assert.ok(Math.abs(byEcho[2] - 125) <= 30, `echo 2: ${byEcho[2]}`);
    assert.ok(Math.abs(byEcho[3] - 62) <= 22, `echo 3: ${byEcho[3]}`);
    assert.ok(kicks.every(e => e.echo <= 3 && (e.position === 17 || e.position === 18)));
});

test('a pending echo delay is rescheduled, not doubled', () => {
    const delays: (number | null)[] = [null, null, null];
    schedule(delays, 0, 1000);
    schedule(delays, 0, 1500);
    assert.deepEqual(delays, [1500, null, null]);
});

test('drone levels swell and rest', () => {
    const voice = { pc: 0, start: 0, T: 5000, position: 1 };
    assert.equal(droneLevel(voice, 2500), 0.25);
    assert.equal(droneLevel(voice, 5000), 1);
    assert.equal(droneLevel(voice, 10000), 0);
    assert.equal(droneLevel(voice, 12000), 0);
});

test('no arpeggio without an interval; with one it climbs the chord', () => {
    assert.equal(run(20, { arpMs: null }).filter(e => e.kind === 'arp').length, 0);
    const arp = run(10, { arpMs: 265 }).filter(e => e.kind === 'arp');
    assert.deepEqual(arp.map(e => e.at), [265, 530, 795]);
    assert.deepEqual(arp.map(e => e.pc), [0, 0, 3]);
    assert.ok(arp.every(e => [3, 4, 5].includes(e.octave)));
});

test('the ring keeps the newest 4096 events', () => {
    const sim = createSoundSim(1, 0);
    for (let i = 1; i <= 2500; i++) stepSoundSim(sim, base({ now: i * 100, toneMs: 50 }));
    const kept = eventsSince(sim, -Infinity);
    assert.equal(kept.length, EVENT_CAP);
    assert.equal(kept[0].at, 905 * 50);
    assert.equal(kept.at(-1)?.at, 5000 * 50);
});

test('a long frame does not flood events', () => {
    const sim = createSoundSim(1, 0);
    stepSoundSim(sim, base({ now: 10000, dtMs: 10000, toneMs: 50 }));
    assert.ok(eventsSince(sim, -Infinity).length <= 2);
});

test('a shrinking interval does not replay the backlog', () => {
    const sim = createSoundSim(1, 0);
    stepSoundSim(sim, base({ now: 150, dtMs: 150, grainTickMs: 200, grainChance: 1, grainLen: [25, 50] }));
    stepSoundSim(sim, base({ now: 166, dtMs: 16, grainTickMs: 6.25, grainChance: 1, grainLen: [25, 50] }));
    assert.ok(eventsSince(sim, -Infinity).filter(e => e.kind === 'grain').length <= 3);
});
