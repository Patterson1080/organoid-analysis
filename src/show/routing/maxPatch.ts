// The sound patch's own rules, read from dev/audio's SimulacraNaturae_4ch_realtime.maxpat (and the
// arpeggiator in SimulacraNaturaeSerialComsCurrents.maxpat). Max peeks two 1 kHz buffers at each
// /index: the activity level v and the burst flags. Every table below is a `select 1 2 …` whose
// reject outlet is unwired, so a bin outside the table changes nothing: Max keeps the last value.

export const PATCH = {
    activityScale: 0.966766, // scale 0. 0.966766 0. 1. — not clipped, so a can pass 1
    toneMs: [50, 100, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200, 4800],
    kickMs: [1200, 1600, 2400, 3200, 6400, 9600], // outlet 4 also wires 4800; 3200 arrives last
    grainMs: [6.25, 12.5, 25, 50, 100, 200],
    grainSourceMs: 400, // a grain plays the sample's first 400 ms over its length
    lfoHz: 0.007984, // the grain gate's cycle~ (≈125 s)
    kickEchoMs: 1200,
    chords: ['A', 'B', 'A', 'B', 'C', 'D', 'C', 'D', 'E', 'F', 'E', 'F', 'G', 'H', 'I', 'J', 'K'],
    notes: [ // coll notes: semitones from C, step 1 first
        [0, 0, 3, 7, 8], [0, 1, 5, 8, 8], [0, 0, 3, 7, 8], [0, 1, 5, 8, 8], [0, 0, 5, 7, 8], [3, 3, 8, 10, 10],
        [0, 0, 5, 7, 8], [3, 3, 8, 10, 10], [0, 1, 5, 10, 10], [0, 3, 7, 8, 8], [0, 1, 5, 10, 10], [0, 3, 7, 8, 8],
        [0, 0, 5, 5, 8], [1, 1, 1, 5, 8], [2, 6, 6, 6, 9], [0, 3, 7, 7, 7], [2, 7, 7, 7, 11],
    ],
    arpBaseMs: 15,
    arpSpanMs: 1000,
    arpOctaves: [48, 60, 72], // MIDI bases the arpeggiator picks from at random
} as const;

export const NOTE_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

/** `int` → `select 1…n`: the table entry, or null when the bin misses (Max holds). */
function pick(table: readonly number[], x: number): number | null {
    const k = Math.trunc(x);
    return k >= 1 && k <= table.length ? table[k - 1] : null;
}

export const toneMs = (a: number) => pick(PATCH.toneMs, 12 - 11 * Math.sqrt(a));
export const kickMs = (a: number) => pick(PATCH.kickMs, 7 - 6 * a);
export const grainTickMs = (a: number) => pick(PATCH.grainMs, 1 + 5 * a ** (1 / 8));

/** The grain length's bin from a^¼; a coin flip plays it as is or doubled. */
export function grainLenBins(a: number): [number, number] | null {
    const bin = pick(PATCH.grainMs, 1 + 5 * a ** (1 / 4));
    return bin === null ? null : [bin, bin * 2];
}

/** One grain tick's odds: the LFO gate passes when L < random, then `random 100` must reach 10 + 80√a. */
export function grainChance(a: number, lfo: number): number {
    const reach = Math.max(0, 100 - Math.max(0, Math.ceil(10 + 80 * Math.sqrt(a))));
    return ((1 - Math.min(1, Math.max(0, lfo))) * reach) / 100;
}

export const grainSpeed = (lenMs: number) => PATCH.grainSourceMs / lenMs;

/** Kicks per metro tick: `decide` passes half the ticks, then each of the echoes follows with odds p. */
export function expectedKicks(p = 0.5, echoes = 3): number {
    let sum = 0;
    for (let k = 0; k <= echoes; k++) sum += p ** k;
    return p * sum;
}

/** `counter 17` after `flags` burst flags: set to 1 at load, one step per flag, 0 after 17. */
export const chordStep = (flags: number) => (((1 + flags) % 18) + 18) % 18;

/** The chord at a counter step; step 0 has no coll key, so K holds. */
export function chordOf(step: number): { name: string; notes: readonly number[]; held: boolean } {
    const s = ((Math.round(step) % 18) + 18) % 18;
    const k = s === 0 ? 17 : s;
    return { name: PATCH.chords[k - 1], notes: PATCH.notes[k - 1], held: s === 0 };
}

/** Arm 1's distance (cm, the sensor's 0–100) → the arpeggio's note interval; a zero reading stops it. */
export function arpIntervalMs(cm: number): number | null {
    const d = Math.min(100, Math.max(0, cm));
    if (Math.trunc(d) === 0) return null;
    return PATCH.arpBaseMs + PATCH.arpSpanMs * (d / 100) ** 2;
}

export interface PatchData {
    activity: Float32Array; // v per index, as the WAV holds it
    flags: Int32Array; // sorted indices whose burst sample is non-zero
    toneHeldMs: Uint16Array; // the tone interval Max is on at each index (holds wrap from the end)
    kickHeldMs: Uint16Array;
}

/** Each index's interval, or the last valid one before it; the first sweep finds what wraps in. */
function held(activity: Float32Array, rule: (a: number) => number | null): Uint16Array {
    const out = new Uint16Array(activity.length);
    let last = 0;
    for (let i = 0; i < activity.length; i++) last = rule(activity[i] / PATCH.activityScale) ?? last;
    for (let i = 0; i < activity.length; i++) {
        last = rule(activity[i] / PATCH.activityScale) ?? last;
        out[i] = last;
    }
    return out;
}

export function patchData(activity: Float32Array, bursts: Float32Array): PatchData {
    const flags: number[] = [];
    for (let i = 0; i < bursts.length; i++) if (bursts[i] !== 0) flags.push(i);
    return { activity, flags: Int32Array.from(flags), toneHeldMs: held(activity, toneMs), kickHeldMs: held(activity, kickMs) };
}

/** v at the index Max would get (/index is an int), or null outside the data. */
export function activityAt(p: PatchData, index: number): number | null {
    const i = Math.floor(index);
    return i >= 0 && i < p.activity.length ? p.activity[i] : null;
}

/** Flags at indices ≤ i. */
function flagsThrough(p: PatchData, i: number): number {
    let lo = 0;
    let hi = p.flags.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (p.flags[mid] <= i) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** Flags with start ≤ index ≤ end. */
export const flagsIn = (p: PatchData, start: number, end: number) =>
    Math.max(0, flagsThrough(p, Math.floor(end)) - flagsThrough(p, Math.floor(start) - 1));

/** Flags Max has counted by this index of this pass, if it loaded just before pass 1. */
export const showChordFlags = (p: PatchData, pass: number, start: number, end: number, index: number) =>
    Math.max(0, pass - 1) * flagsIn(p, start, end) + flagsIn(p, start, index);
