// The patch's voices played forward in wall-clock time, so the view can draw what Max does with the
// current values: metros at the patch's intervals, its coin flips and random picks drawn here with
// a seeded generator (Max's own draws can't be known). Pure apart from the clock the caller passes.

import { PATCH, grainSpeed } from './maxPatch.ts';

export interface SoundEvent {
    kind: 'tone' | 'grain' | 'kick' | 'arp';
    at: number; // tick time, ms on the caller's clock
    pc: number; // pitch class 0..11; −1 for kicks
    octave: number; // arp: 3 | 4 | 5; kick: 1; else 0
    position: number; // 0 unrouted, 1..16 out1..16; kick 17 (speakers 3–4's centre); arp −1 (its own pair)
    speed: number; // grain playback ×1..×64, else 1
    echo: number; // kick 0..3, else 0
}

export interface DroneVoice {
    pc: number; // −1 until a chord is known
    start: number;
    T: number; // rise, fall and rest each last T
    position: number;
}

export interface SoundSim {
    rng: number;
    toneClock: number;
    grainClock: number;
    kickClock: number;
    arpClock: number;
    arpStep: number;
    kickDelays: (number | null)[]; // Max's three `delay 1200` objects: pending fire time, or null
    drones: DroneVoice[];
    ring: SoundEvent[];
    head: number;
}

export interface SimInput {
    now: number;
    dtMs: number;
    notes: readonly number[] | null; // the current chord; null (not known here) → events tick unpitched
    toneMs: number | null;
    kickMs: number | null;
    grainTickMs: number | null;
    grainChance: number;
    grainLen: [number, number] | null;
    arpMs: number | null; // null → the arpeggiator's metro is off
}

export const EVENT_CAP = 4096;
const MAX_STEP_MS = 100; // a long frame (hidden tab) advances like one slow frame
const DRONES = 6;
const POSITIONS = 17; // `random 17 → gate~ 16`: 0 closes the gate
const DRONE_GAP_MS = 1000; // fzero~ listens for a second before the sine takes the pitch
const ECHO_STAGES = 3;
const CHORD_NOTES = 5; // coll notes holds 5 per chord

/** mulberry32, its state kept in the sim. */
function rand(sim: SoundSim): number {
    sim.rng = (sim.rng + 0x6d2b79f5) | 0;
    let t = Math.imul(sim.rng ^ (sim.rng >>> 15), 1 | sim.rng);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (sim: SoundSim, n: number) => Math.floor(rand(sim) * n);

/** A note of the chord, as a pitch class; −1 when the chord isn't known here. */
const pickPc = (sim: SoundSim, notes: readonly number[] | null) => (notes ? notes[randInt(sim, notes.length)] % 12 : -1);

function newDroneCycle(sim: SoundSim, v: DroneVoice, start: number, notes: readonly number[] | null) {
    v.start = start;
    v.T = 5000 + rand(sim) * 5000;
    v.pc = pickPc(sim, notes);
    v.position = randInt(sim, POSITIONS);
}

export function createSoundSim(seed = 1, now = 0): SoundSim {
    const sim: SoundSim = {
        rng: seed | 0, toneClock: 0, grainClock: 0, kickClock: 0, arpClock: 0, arpStep: 0,
        kickDelays: [null, null, null], drones: [], ring: [], head: 0,
    };
    for (let i = 0; i < DRONES; i++) {
        const v: DroneVoice = { pc: -1, start: now, T: 5000, position: 0 };
        newDroneCycle(sim, v, now, null);
        v.start = now - rand(sim) * (3 * v.T + DRONE_GAP_MS); // voices start out of phase
        sim.drones.push(v);
    }
    return sim;
}

/** A `delay` object takes the newest time: scheduling a pending one reschedules it. */
export function schedule(delays: (number | null)[], stage: number, at: number): void {
    delays[stage] = at;
}

/** The envelope Max's line~ draws, squared: up over T, down over T, silent for T, then a gap. */
export function droneLevel(v: DroneVoice, now: number): number {
    const t = now - v.start;
    if (t < 0 || t >= 2 * v.T) return 0;
    const x = t < v.T ? t / v.T : 1 - (t - v.T) / v.T;
    return x * x;
}

/** Until the ring fills, head is its length, so this appends. */
function push(sim: SoundSim, e: SoundEvent) {
    sim.ring[sim.head] = e;
    sim.head = (sim.head + 1) % EVENT_CAP;
}

const event = (kind: SoundEvent['kind'], at: number, over: Partial<SoundEvent>): SoundEvent =>
    ({ kind, at, pc: -1, octave: 0, position: 0, speed: 1, echo: 0, ...over });

/** A metro over one step: capped at one interval first (a shrinking interval replays nothing), then
 *  every whole interval in the clock is a tick at its own time. Returns the clock left over. */
function metro(clock: number, interval: number | null, dt: number, now: number, ticks: number[]): number {
    if (interval === null || !(interval > 0)) return clock;
    let c = Math.min(clock, interval) + dt;
    while (c >= interval) {
        c -= interval;
        ticks.push(now - c);
    }
    return c;
}

/** termiteKick's `random 2 → gate~ 2`: 0 closes the gate (silent), 1 sends it to out17. */
function kick(sim: SoundSim, at: number, echo: number) {
    push(sim, event('kick', at, { octave: 1, position: randInt(sim, 2) === 0 ? 0 : 17, echo }));
}

/** Kick ticks and due echo delays, in time order; a delay due at a tick's time fires first. */
function stepKicks(sim: SoundSim, ticks: number[], now: number) {
    let next = 0;
    for (;;) {
        let stage = -1;
        for (let k = 0; k < ECHO_STAGES; k++) {
            const due = sim.kickDelays[k];
            if (due !== null && due <= now && (stage < 0 || due < (sim.kickDelays[stage] as number))) stage = k;
        }
        const delayAt = stage >= 0 ? (sim.kickDelays[stage] as number) : Infinity;
        const tickAt = next < ticks.length ? ticks[next] : Infinity;
        if (delayAt === Infinity && tickAt === Infinity) return;
        if (delayAt <= tickAt) {
            sim.kickDelays[stage] = null;
            kick(sim, delayAt, stage + 1);
            if (stage + 1 < ECHO_STAGES && rand(sim) < 0.5) schedule(sim.kickDelays, stage + 1, delayAt + PATCH.kickEchoMs);
        } else {
            next++;
            if (rand(sim) < 0.5) {
                kick(sim, tickAt, 0);
                if (rand(sim) < 0.5) schedule(sim.kickDelays, 0, tickAt + PATCH.kickEchoMs);
            }
        }
    }
}

export function stepSoundSim(sim: SoundSim, input: SimInput): void {
    const { now, notes } = input;
    const dt = Math.min(input.dtMs, MAX_STEP_MS);

    const tones: number[] = [];
    sim.toneClock = metro(sim.toneClock, input.toneMs, dt, now, tones);
    for (const at of tones) push(sim, event('tone', at, { pc: pickPc(sim, notes), position: randInt(sim, POSITIONS) }));

    const grains: number[] = [];
    sim.grainClock = metro(sim.grainClock, input.grainTickMs, dt, now, grains);
    const len = input.grainLen;
    if (len) {
        for (const at of grains) {
            if (rand(sim) >= input.grainChance) continue;
            const lenMs = len[randInt(sim, 2)];
            push(sim, event('grain', at, { pc: pickPc(sim, notes), position: randInt(sim, POSITIONS), speed: grainSpeed(lenMs) }));
        }
    }

    const kicks: number[] = [];
    sim.kickClock = metro(sim.kickClock, input.kickMs, dt, now, kicks);
    stepKicks(sim, kicks, now);

    const arps: number[] = [];
    sim.arpClock = metro(sim.arpClock, input.arpMs, dt, now, arps);
    for (const at of arps) {
        const octave = PATCH.arpOctaves[randInt(sim, PATCH.arpOctaves.length)] / 12 - 1;
        push(sim, event('arp', at, { pc: notes ? notes[sim.arpStep] % 12 : -1, octave, position: -1 }));
        sim.arpStep = (sim.arpStep + 1) % CHORD_NOTES; // counter 0 4 steps whether or not the chord is known
    }

    for (const v of sim.drones) {
        if (now >= v.start + 3 * v.T + DRONE_GAP_MS) newDroneCycle(sim, v, now, notes);
        else if (v.pc < 0 && notes) v.pc = pickPc(sim, notes);
    }
}

/** Events at or after `since`, oldest first. */
export function eventsSince(sim: SoundSim, since: number): SoundEvent[] {
    const out: SoundEvent[] = [];
    const first = sim.ring.length < EVENT_CAP ? 0 : sim.head;
    for (let i = 0; i < sim.ring.length; i++) {
        const e = sim.ring[(first + i) % EVENT_CAP];
        if (e.at >= since) out.push(e);
    }
    return out;
}
