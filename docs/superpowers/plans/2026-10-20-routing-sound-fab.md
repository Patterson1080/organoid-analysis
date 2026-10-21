# Routing view: sound from the Max patch, central artifacts as slices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SOUND card's paper approximations with the Max patch's own rules (driven by the patch's data WAVs), and draw both central artifacts — the termite form from its mesh and the clay vessel from its G-code — as rotating slice stacks in the FAB card.

**Architecture:**

- **Pure modules in `src/show/routing/`** (Node-tested, explicit `.ts` imports):
  - `wav.ts`: parse the WAVs;
  - `maxPatch.ts`: the patch's tables and its `PatchData`;
  - `soundEvents.ts`: the seeded event simulation;
  - `slicer.ts`: slice a mesh;
  - `termiteSlices.ts`: the `TSL1` format;
  - `sliceView.ts`: projection, plus the stacks for both objects.
- **`live.ts`** gains a `sound` view per frame.
- **Canvas drawing** goes in two new files, `soundGlyphs.ts` and `artifactGlyphs.ts`, called from `overview.ts` and `details.ts`.
- **A Node script** turns the 868 MB OBJ into `data/termite_slices.bin`.
- **Data files:** the page fetches three new optional ones through the existing `/data/status` mechanism.

**Tech Stack:** React 18 + TypeScript + Vite, Canvas 2D, Node bridges, `node --test` with native type stripping. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-routing-sound-fab-design.md` (parent: `docs/superpowers/specs/2026-10-20-routing-view-design.md`).

## Global Constraints

**Code:**

- No new dependencies. Canvas 2D only.
- Pure modules live in `src/show/routing/`. They use explicit `.ts` import extensions and only erasable TypeScript: no enums, namespaces or parameter properties. Node strips the types.
- `npm test` runs `node --test "server/**/*.test.js" "src/**/*.test.ts"`. Test files are excluded from `tsc`.
- No new type errors. `npx tsc --noEmit` already reports two errors on `main`, and they stay the only ones: `App.tsx` TS6133 and `CircularEventGraph.tsx` TS2322.

**Data:**

- `data/` files are optional and gitignored. The page works without any of them, falling back to today's view.
- The 868 MB OBJ never reaches the page.

**Copy and labels:**

- A value is exact (no mark), `≈`, or `LIVE`.
- Badges: `PATCH RULES` (patch data present), `LIVE` (fresh telemetry), or today's `≈ computed from spikes · the patch is the authority` (fallback).
- Every detail source keeps `ATTRIBUTION` (`facts.ts`).
- Max's random draws are captioned as drawn here: "drawn like Max draws them".
- The FAB arrangement is captioned "schematic · not to scale".
- Termite dimensions are never shown in units.

**Safety:**

- Never connect to `127.0.0.1:8080/8081` and never restart the user's app or bridge. The user's show may be running.
- Visual checks use the scratchpad harness (Task 8) on a free port with `--strictPort`.

**Git:** commit messages are concise, with no attribution lines (user's CLAUDE.md). Work stays on branch `routing-sound-fab`.

## Review Focus

Five input classes the spec implies, each pinned by a test in the task named:

1. **WAVs from another dataset** (length ≠ the playhead's range). Indices past the WAV's end read as "no patch value" and the view falls back for that frame; it doesn't crash or read garbage. *Task 2: `activityAt beyond the data is null`; Task 4: `an index past the patch data falls back`.*
2. **A show range other than 0…179999** (`startIndex > 0` or `endIndex < 179999`). Flags per pass count only the range, so the chord matches what Max hears. *Task 2: `show chord flags count only the show range`.*
3. **A long frame** (a hidden tab resumed) or **an interval that shrinks mid-accumulation**. No backlog flood of events: at most one step's worth of ticks. *Task 3: `a long frame does not flood events` and `a shrinking interval does not replay the backlog`.*
4. **A `TSL1` segment with zero slices** (a tiny object, or a step larger than the object). It parses and draws nothing for that segment. *Task 6: `a segment without slices round-trips`.*
5. **Extreme aspect ratios** for the new detail panels (3000×500 and 320×900). Panels stay inside the story box, never overlap and never go negative. *Task 5: `sound panels tile the story at any aspect`; Task 7: `fab panels tile the story at any aspect`.*

---

### Task 1: Data files and the WAV parser

**Files:**
- Create: `src/show/routing/wav.ts`, `src/show/routing/wav.test.ts`
- Modify: `server/data-files.js` (+ `server/data-files.test.js`), `scripts/show-smoke.mjs:99`

**Interfaces:**
- Produces: `parseWav16(buf: ArrayBuffer): Float32Array`. It reads a RIFF/WAVE file, walks the chunks (odd sizes padded to even), requires `fmt ` with PCM format 1, 1 channel and 16 bits, and returns the `data` samples / 32768. It throws:
  - `Error('not a RIFF/WAVE file')`;
  - `Error('not 16-bit PCM mono')`;
  - `Error('no data chunk')`.
- Produces: three new `DATA_FILES` entries, appended in this order:
  - `{ key: 'activity', name: 'activitylevel.wav', type: 'audio/wav' }`
  - `{ key: 'bursts', name: 'burstflags.wav', type: 'audio/wav' }`
  - `{ key: 'termite', name: 'termite_slices.bin', type: 'application/octet-stream' }`

- [ ] **Step 1: Write the failing tests.** `wav.test.ts` has a builder `wav({ format = 1, channels = 1, bits = 16, samples = [], before })`, where `before` is an extra chunk placed before `data`.
  - `16-bit mono samples come out over 32768`: `[0, 16384, -32768, 32767]` → `[0, 0.5, -1, 32767 / 32768]`.
  - `a padded odd-sized chunk before data is skipped`: `before` is a `LIST` chunk of 3 bytes plus 1 pad byte; samples `[100]` → `[100 / 32768]`.
  - `other formats throw`:
    - bits 8 → `/16-bit PCM mono/`;
    - channels 2 → `/16-bit PCM mono/`;
    - format 3 → `/16-bit PCM mono/`;
    - no data chunk → `/no data chunk/`;
    - `'RIFX'` magic → `/RIFF\/WAVE/`.

  `data-files.test.js`:
  - `status lists every data file` expects `{ neurons: true, spikes: false, firing: false, vessel: true, activity: false, bursts: false, termite: false }`;
  - `status keys keep their order` expects `'neurons,spikes,firing,vessel,activity,bursts,termite'`;
  - new test `the WAVs are served as audio/wav`: `routes.get('/data/activitylevel.wav').type === 'audio/wav'`, and `routes.get('/data/termite_slices.bin').type === 'application/octet-stream'`.

- [ ] **Step 2: Run them to see them fail.** Run: `node --test src/show/routing/wav.test.ts server/data-files.test.js`. Expected: FAIL, with `Cannot find module './wav.ts'` and a deepEqual failure on the status.

- [ ] **Step 3: Implement.**
  - `parseWav16` uses a `DataView`, little-endian.
  - Append the three `DATA_FILES` entries.
  - Update the file's header comment: it now lists five optional files the routing view draws from.
  - Update the smoke expectation at `scripts/show-smoke.mjs:99` to `'{"neurons":true,"spikes":true,"firing":false,"vessel":false,"activity":false,"bursts":false,"termite":false}'`.

- [ ] **Step 4: Run the tests again.** Run: `node --test src/show/routing/wav.test.ts server/data-files.test.js`. Expected: PASS.

- [ ] **Step 5: Link the WAVs locally** (gitignored, for later tasks and the harness):

```bash
ln -s /Users/toka/Professional/Metaesthetica/dev/audio/activitylevel.wav data/activitylevel.wav
ln -s /Users/toka/Professional/Metaesthetica/dev/audio/burstflags.wav data/burstflags.wav
```

- [ ] **Step 6: Commit.**

```bash
git add src/show/routing/wav.ts src/show/routing/wav.test.ts server/data-files.js server/data-files.test.js scripts/show-smoke.mjs
git commit -m "Routing: WAV parser, patch WAV and termite slice data files"
```

---

### Task 2: The patch's rules and `PatchData`

**Files:**
- Create: `src/show/routing/maxPatch.ts`, `src/show/routing/maxPatch.test.ts`
- Modify: `src/show/routing/facts.ts`. `SOUND_FACTS` gains `patchFile: 'SimulacraNaturae_4ch_realtime.maxpat'` and `serialFile: 'SimulacraNaturaeSerialComsCurrents.maxpat'`, and `badge` stays as it is. The paper ranges stay too: the fallback uses them.

**Interfaces:**
- Produces, in `maxPatch.ts`:

```ts
export const PATCH: {
    activityScale: 0.966766;
    toneMs: readonly number[];   // [50,100,200,300,400,600,800,1200,1600,2400,3200,4800]
    kickMs: readonly number[];   // [1200,1600,2400,3200,6400,9600]
    grainMs: readonly number[];  // [6.25,12.5,25,50,100,200]
    grainSourceMs: 400;
    lfoHz: 0.007984;
    kickEchoMs: 1200;
    chords: readonly string[];   // 'A','B','A','B','C','D','C','D','E','F','E','F','G','H','I','J','K'
    notes: readonly (readonly number[])[]; // 17 × 5, the spec's coll notes table, step 1 first
    arpBaseMs: 15; arpSpanMs: 1000; arpOctaves: readonly number[]; // [48,60,72]
};
export const NOTE_NAMES: readonly string[]; // ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B']
export function toneMs(a: number): number | null;      // null = no table entry (Max holds)
export function kickMs(a: number): number | null;
export function grainTickMs(a: number): number | null;
export function grainLenBins(a: number): [number, number] | null; // [bin, 2 × bin]
export function grainChance(a: number, lfo: number): number;      // (1 − lfo)·(100 − ⌈10 + 80√a⌉)/100, ≥ 0
export const grainSpeed: (lenMs: number) => number;               // 400 / lenMs
export function expectedKicks(p?: number, echoes?: number): number; // the decide chain, default 0.5 and 3
export function chordStep(flags: number): number;                 // (1 + flags) mod 18
export function chordOf(step: number): { name: string; notes: readonly number[]; held: boolean };
export function arpIntervalMs(cm: number): number | null;         // cm clamped to 0..100; trunc 0 → null
export interface PatchData {
    activity: Float32Array; // v per index, as the WAV holds it
    flags: Int32Array;      // sorted indices whose burst sample is non-zero
    toneHeldMs: Uint16Array; // per index: toneMs(a), or the last valid value (wrapping from the end); 0 if none
    kickHeldMs: Uint16Array;
}
export function patchData(activity: Float32Array, bursts: Float32Array): PatchData;
export function activityAt(p: PatchData, index: number): number | null; // v, or null outside 0..length−1
export function flagsIn(p: PatchData, start: number, end: number): number; // flags with start ≤ i ≤ end
export function showChordFlags(p: PatchData, pass: number, start: number, end: number, index: number): number;
// (pass − 1)·flagsIn(start, end) + flagsIn(start, index)
```

- Bins are as in the spec: `k = trunc(…)`, then the table entry `k − 1`, or `null` when k is outside the table. Inputs are `a = v / activityScale`.
- **Algorithm the signatures don't fix:** `toneHeldMs` and `kickHeldMs` take two sweeps. The first finds the last valid value of the whole array. The second starts with that value as "previous" and fills in each index's own value or the held one.

- [ ] **Step 1: Write the failing tests** (`maxPatch.test.ts`):
  - **`tone intervals follow √a and hold past the table`:**
    - `toneMs(0) = 4800`, `toneMs(1) = 50`, `toneMs(0.25) = 600`, `toneMs(0.5) = 300`;
    - `toneMs(1.03) = null`.
  - **`kick intervals follow a, 3200 wins outlet 4, silence holds`:**
    - `kickMs(0.1) = 9600`, `kickMs(0.5) = 3200`, `kickMs(0.9) = 1200`;
    - `kickMs(0) = null`, `kickMs(1.03) = null`.
  - **`grains: tick from a^⅛, length from a^¼ with a doubling`:**
    - `grainTickMs(0) = 6.25`, `grainTickMs(1) = 200`, `grainTickMs(0.5) = 100`;
    - `grainLenBins(0)` → `[6.25, 12.5]`, `grainLenBins(1)` → `[200, 400]`, `grainLenBins(0.5)` → `[100, 200]`;
    - `grainSpeed(6.25) = 64`, `grainSpeed(400) = 1`.
  - **`grain chance falls with activity and the LFO`:**
    - `grainChance(0, 0) = 0.9`, `grainChance(1, 0) = 0.1`;
    - `grainChance(0.0625, 0) = 0.7`, `grainChance(0.25, 0.5) = 0.25`;
    - `grainChance(1, 1) = 0`.
  - **`the kick chain plays 0.9375 kicks per tick`:** `expectedKicks() = 0.9375`.
  - **`the chord counter wraps through a held K`:**
    - `chordStep(0) = 1`, `chordStep(1) = 2`, `chordStep(16) = 17`;
    - `chordStep(17) = 0`, `chordStep(18) = 1`, `chordStep(46) = 11`;
    - `chordOf(1)` → `{ name: 'A', notes: [0,0,3,7,8], held: false }`;
    - `chordOf(0)` → `{ name: 'K', notes: [2,7,7,7,11], held: true }`;
    - `chordOf(15).name = 'I'`;
    - `NOTE_NAMES[3] = 'E♭'`.
  - **`arpeggio interval from arm 1's distance`:**
    - `arpIntervalMs(100) = 1015`, `arpIntervalMs(50) = 265`, `arpIntervalMs(10) = 25`;
    - `arpIntervalMs(150) = 1015` (clamped);
    - `arpIntervalMs(0.5) = null`.
  - **`patchData finds flags and holds intervals, wrapping`:** use `activity = [0, 0.5·0.966766, 0, 0]` and `bursts = [0, 1, 0, 0]`.
    - `flags` → `[1]`;
    - `kickHeldMs` → `[3200, 3200, 3200, 3200]`;
    - `toneHeldMs` → `[4800, 300, 4800, 4800]`;
    - a second case with `activity = [0.5·0.966766, 1.0]` gives `toneHeldMs[1] = 300` (held).
  - **`activityAt beyond the data is null`:** `activityAt(p, 4) = null`, `activityAt(p, -1) = null`, `activityAt(p, 1) ≈ 0.4834`.
  - **`show chord flags count only the show range`:** use flags at `[1, 4]` over 6 samples.
    - `showChordFlags(p, 2, 0, 5, 3) = 3`;
    - `showChordFlags(p, 2, 2, 5, 3) = 1`;
    - `flagsIn(p, 2, 5) = 1`.

- [ ] **Step 2: Run them to see them fail.** Run: `node --test src/show/routing/maxPatch.test.ts`. Expected: FAIL, `Cannot find module './maxPatch.ts'`.

- [ ] **Step 3: Implement `maxPatch.ts`, and add the two file names to `SOUND_FACTS`.** Flag counts use binary search over `flags`.

- [ ] **Step 4: Run the tests again.** Run: `node --test src/show/routing/maxPatch.test.ts`. Expected: PASS (all of the above).

- [ ] **Step 5: Commit.**

```bash
git add src/show/routing/maxPatch.ts src/show/routing/maxPatch.test.ts src/show/routing/facts.ts
git commit -m "Routing: Max patch rules (tones, grains, kick, chords, arpeggio) and PatchData"
```

---

### Task 3: The event simulation

**Files:**
- Create: `src/show/routing/soundEvents.ts`, `src/show/routing/soundEvents.test.ts`

**Interfaces:**
- Consumes: `PATCH`, `grainSpeed` (Task 2).
- Produces:

```ts
export interface SoundEvent {
    kind: 'tone' | 'grain' | 'kick' | 'arp';
    at: number;       // tick time, ms on the caller's clock
    pc: number;       // pitch class 0..11; −1 for kicks
    octave: number;   // arp: 3 | 4 | 5; kick: 1; else 0
    position: number; // 0 unrouted, 1..16 out1..16; kick 17 | 18; arp −1
    speed: number;    // grain playback ×1..×64, else 1
    echo: number;     // kick 0..3, else 0
}
export interface DroneVoice { pc: number; start: number; T: number; position: number }
export interface SoundSim {
    rng: number; toneClock: number; grainClock: number; kickClock: number; arpClock: number; arpStep: number;
    kickDelays: (number | null)[]; // Max's three `delay 1200` objects: pending fire time or null
    drones: DroneVoice[];          // 6
    ring: SoundEvent[]; head: number; count: number;
}
export const EVENT_CAP = 4096;
export const MAX_STEP_MS = 100;
export interface SimInput {
    now: number; dtMs: number;
    notes: readonly number[] | null;   // the current chord's notes; null → tones/grains/drones/arp pick nothing
    toneMs: number | null; kickMs: number | null; grainTickMs: number | null;
    grainChance: number; grainLen: [number, number] | null;
    arpMs: number | null;              // null → no arpeggio
}
export function createSoundSim(seed?: number, now?: number): SoundSim;
export function stepSoundSim(sim: SoundSim, input: SimInput): void;
export function eventsSince(sim: SoundSim, since: number): SoundEvent[]; // oldest first
export function droneLevel(v: DroneVoice, now: number): number;          // (line)²: up T, down T, rest T, +1 s gap
export function schedule(delays: (number | null)[], stage: number, at: number): void; // replaces a pending one
```

**Algorithm the signatures don't fix:**

- **Clocks.** Each clock is first capped at one interval (`clock = min(clock, interval)`, so a shrinking interval replays no backlog). Then it adds the clamped dt, `min(dtMs, MAX_STEP_MS)`. While the clock is ≥ the interval it ticks and subtracts; the tick time is `now − clock`, after the subtraction.
- **Order within a step.** Due kick delays fire in time order before new ticks are scheduled.
- **Kick tick.** A 50 % coin; on a pass, a kick (echo 0). Then a 50 % coin calls `schedule(delays, 0, at + 1200)`.
- **Delays.** When pending delay k ≤ now fires, it plays a kick (echo k + 1); if k < 2, a 50 % coin calls `schedule(delays, k + 1, fire + 1200)`.
- **Draws:**
  - tone: `pc = notes[rand 0..4] % 12`, `position = rand 0..16`;
  - grain: on `rand < grainChance`, `len = grainLen[coin]`, `speed = 400 / len`, pc as for a tone, `position = rand 0..16`;
  - arp: `pc = notes[arpStep] % 12` with `arpStep` stepping 0..4, starting at 0; `octave = (48 | 60 | 72) / 12 − 1`;
  - kick: `position = 17 + coin`;
  - drones: when a cycle (3T + 1000 ms) ends, the voice picks `pc`, `T = 5000 + rand·5000` and a position.
- **Random generator.** A mulberry32-style generator whose state is `sim.rng`.

- [ ] **Step 1: Write the failing tests:**
  - **`tone ticks land on the interval cadence`:** toneMs 200, ten steps of dt 100 from now 0. The tone `at` values are `[200, 400, 600, 800, 1000]`, with every `pc` in chord A's pitch classes {0, 3, 7, 8}.
  - **`grain counts follow the chance`:** grainTickMs 10, chance 0.25, grainLen `[25, 50]`, 1000 steps of 100 ms. The grain count is within 2500 ± 150, and each speed is in {16, 8}.
  - **`kicks follow the decide chain`:** kickMs 1600, 16 000 steps of 100 ms (1000 ticks). At 1200, ticks would coincide with the 1200 ms echoes, and Max's order for equal times is unknown.
    - The echo-0 count is within 500 ± 50, echo-1 within 250 ± 40, echo-2 within 125 ± 30, and echo-3 within 62 ± 22.
    - No echo exceeds 3.
    - Every kick position is 17 or 18.
  - **`a pending echo delay is rescheduled, not doubled`:** `schedule(d, 0, 1000)` then `schedule(d, 0, 1500)` leaves `d[0] === 1500`.
  - **`drone levels swell and rest`:** for `{start: 0, T: 5000}`:
    - `droneLevel(·, 2500) = 0.25`, `droneLevel(·, 5000) = 1`;
    - `droneLevel(·, 10000) = 0`, `droneLevel(·, 12000) = 0`.
  - **`no arpeggio without an interval; with one it climbs the chord`:**
    - arpMs null → no `arp` events in 2 s;
    - arpMs 265 for 1000 ms → 3 arp events with pcs `[0, 0, 3]` for notes `[0,0,3,7,8]`, octaves in {3, 4, 5}.
  - **`the ring keeps the newest 4096 events`:** 5000 tone ticks → `count = 4096`, and the oldest kept `at` is the 905th tick's time.
  - **`a long frame does not flood events`:** one step of dt 10 000 with toneMs 50 gives ≤ 2 tones.
  - **`a shrinking interval does not replay the backlog`:** grainTickMs 200 for 150 ms, then 6.25 for one 16 ms step, gives ≤ 3 grain ticks in that step.

- [ ] **Step 2: Run them to see them fail.** Run: `node --test src/show/routing/soundEvents.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `soundEvents.ts`.**

- [ ] **Step 4: Run the tests again.** Run: `node --test src/show/routing/soundEvents.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/show/routing/soundEvents.ts src/show/routing/soundEvents.test.ts
git commit -m "Routing: seeded sound event simulation at the patch's odds"
```

---

### Task 4: Live state, playhead and data wiring

**Files:**
- Modify:
  - `src/show/routing/live.ts` (+ `live.test.ts`)
  - `src/show/routing/playhead.ts` (+ `playhead.test.ts`)
  - `src/components/RoutingView.tsx`
  - `src/components/ShowPanel.tsx`
  - `src/App.tsx` (the data loading at about line 512)

**Interfaces:**
- Consumes: Task 2 (`PatchData` and the rules), Task 3 (`SoundSim`, `stepSoundSim`).
- Produces:

```ts
// playhead.ts — Playhead gains:
pass: number;                              // show: state.pass; local: 1
range: { start: number; end: number };     // show: config start/endIndex; local: 0..179999
// live.ts — LiveInput gains:
patch: PatchData | null; mode: 'show' | 'local'; pass: number; range: { start: number; end: number };
// LiveState gains `sound: SoundView`:
export interface SoundView {
    source: 'patch' | 'fallback';
    heardIndex: number | null;   // last index Max heard; held while the playhead is null
    v: number; a: number;
    toneMs: number | null; kickMs: number | null; held: { tone: boolean; kick: boolean };
    grainTickMs: number | null; grainLen: [number, number] | null; grainChance: number; threshold: number;
    passFlags: number; flagsSoFar: number; nextFlag: number | null; // this pass's flags; next flag index
    chordStep: number | null; chordSource: 'computed' | 'live' | 'unknown';
    arm1Cm: number | null; arpMs: number | null;
    sim: SoundSim;
}
```

**Rules:**

- **Source.** `source = 'patch'` when `patch` is set and `activityAt(heardIndex)` is not null; else `'fallback'`. The fallback keeps today's rate, burst and VISAP fields, unchanged.
- **Held values.** `held.kick` is true when `kickMs(a)` is null, and the value then comes from `kickHeldMs`; tones work the same way.
- **Grain chance.** `grainChance(a, 0.5)`, the LFO at its midpoint.
- **Chord.**
  - LIVE `harmony`, when fresh, gives `chordStep = round(value)` clamped 0..17.
  - Else in show mode, `chordStep(showChordFlags(…))`.
  - Else (local) `null`, with source `'unknown'`.
- **Arm 1.** `arm1Cm` is fresh `telemetry.robot[0].proximity` (cm), else null; `arpMs = arm1Cm === null ? null : arpIntervalMs(arm1Cm)`.
- **Simulation.** The sim steps every frame, even in OFF: notes come from `chordOf(chordStep ?? 1)` when patch data exists, and the intervals from the held values.

- [ ] **Step 1: Write the failing tests.** In `live.test.ts`, the `input()` defaults gain `patch: null, mode: 'local', pass: 1, range: { start: 0, end: 179999 }`. A helper `patch()` wraps Task 2's 4-sample arrays.
  - `patch values at the playhead`: index 1 gives `source 'patch'`, `a ≈ 0.5`, `toneMs 300`, `kickMs 3200`, `grainTickMs 100`, and `grainLen [100, 200]`.
  - `without patch data the sound view falls back`: `source 'fallback'`.
  - `an index past the patch data falls back`: index 10 gives `source 'fallback'`.
  - `the show chord counts flags of earlier passes`: patch flags `[1]`, `mode 'show'`, `pass 2`, range 0..3, index 2. That gives `chordStep(2) = 3`, `chordSource 'computed'`.
  - `local playback leaves the chord unknown`: `chordStep null`, `chordSource 'unknown'`.
  - `fresh harmony telemetry sets the chord`: an applied `/routing/sound/harmony 5` gives `chordStep 5`, `'live'`.
  - `arm 1 telemetry drives the arpeggio`:
    - `/routing/robot/1/proximity 50` → `arpMs 265`;
    - without it → `arpMs null`, and no `arp` events after 2 s.
  - `a held playhead keeps the last activity`: index 1, then index null, gives `heardIndex 1`, `a ≈ 0.5`, and tone events still arriving.

  In `playhead.test.ts`:
  - `the show playhead carries pass and range`: pass 2 with config 100..900 gives `pass 2`, `range {100, 900}`;
  - `local playback is pass 1 over the whole recording`.

- [ ] **Step 2: Run them to see them fail.** Run: `node --test src/show/routing/live.test.ts src/show/routing/playhead.test.ts`. Expected: FAIL; `s.sound` is undefined.

- [ ] **Step 3: Implement.** Changes to `live.ts` and `playhead.ts`:
  - **`live.ts`:**
    - `createLiveState` creates `sound` with `createSoundSim(1)`;
    - `advanceLive` computes the `SoundView` after the existing sound block.
  - **`playhead.ts`:** adds `pass` and `range`.

  Wiring through the components:
  - **`RoutingView`:**
    - passes `patch`, `mode`, `pass` and `range` into `advanceLive`;
    - gains a `patch: PatchData | null` prop, also forwarded in the draw input as `patch`.
  - **`ShowPanel`:** forwards `patch`.
  - **`App`:**
    - when `/data/status` has both `activity` and `bursts`, fetches both WAVs, then `patchData(parseWav16(a), parseWav16(b))`;
    - a failure is `console.warn`, like the vessel;
    - state is `patch`.

- [ ] **Step 4: Run the tests again.** Run: `npm test > .superpowers/sdd/routing-sound-fab/test.log 2>&1; tail -5 .superpowers/sdd/routing-sound-fab/test.log`. Expected: all pass; the count grows by the new tests.

- [ ] **Step 5: Check types.** Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`. Expected: `2`, the pre-existing errors only.

- [ ] **Step 6: Commit.**

```bash
git add src/show/routing/live.ts src/show/routing/live.test.ts src/show/routing/playhead.ts src/show/routing/playhead.test.ts src/components/RoutingView.tsx src/components/ShowPanel.tsx src/App.tsx
git commit -m "Routing: sound view from the patch data, show pass and range, WAV loading"
```

---

### Task 5: SOUND card and detail

**Files:**
- Create:
  - `src/components/routing/soundGlyphs.ts`
  - `src/show/routing/soundLayout.ts` + `soundLayout.test.ts`
- Modify:
  - `src/components/routing/overview.ts` (`drawSound`, plus the robot loop tag)
  - `src/components/routing/details.ts` (`sound()`, plus the `solenoids()` copy and chain)
  - `src/components/routing/overview.ts` (`DrawInput` gains `patch: PatchData | null`)
  - `src/show/routing/facts.ts` (`SOLENOID_FACTS`)

**Interfaces:**
- Consumes: `LiveState.sound` (Task 4), `PatchData` / `PATCH` / `NOTE_NAMES` / `chordOf` (Task 2), `eventsSince` / `droneLevel` (Task 3).
- Produces (pure, in `soundLayout.ts`):

```ts
export function soundPanels(story: Box): { score: Box; rules: Box; harmony: Box; output: Box };
// landscape (w/h ≥ 1.1): left 62 % = score (top 55 %) + rules; right 38 % = harmony (top 45 %) + output
// portrait: four rows: score 34 %, rules 22 %, harmony 20 %, output 24 %; gaps 10·typeScale
export function activityEnvelope(activity: Float32Array, columns: number, start: number, end: number): Float32Array;
// per column, the max of v over its share of [start, end]
export const SOLENOID_FACTS: { file: 'backboneSpikes.txt'; board: 'Daisy Seed'; baud: 9600; releaseMs: 32 } // in facts.ts
```

- `soundGlyphs.ts` (canvas only):
  - `activityStrip(g, b, envelope, flags, range, index, s)`
  - `chordStrip(g, b, step, s)`
  - `score(g, b, sim, now, notes, s)`
  - `stepChart(g, b, table, binOf, a, label, s)`
  - `speakers(g, b, sim, now, arp, s)`

**Content:** exactly as in the spec's "SOUND card", "SOUND detail" and "SOLENOIDS copy" sections.

- **Card:** the activity strip with flags and playhead, the chord strip, and the big chord letter with note names. Its 3 text lines are:
  - `Max reads activity + burst flags at /index`;
  - `chord E · tones 0.4/s · grains 31/s · kick 1/9.6 s`;
  - the badge.
- **Detail:** the score (10 s window), rules, harmony and output panels. The chain is `/index` → `peek~ activity · flags` → `a = v / 0.9668` → `tones · grains · kick · drones` → `speakers 3–6 · arp 1–2`. Captions name both patch files.
- **Chord text:** "≈ · if Max loaded before pass 1" in the show, "LIVE" with telemetry. In local playback: "the chord steps on burst flags Max receives; local playback skips most indices".
- **Arpeggio lane without telemetry:** "waiting for arm 1 · no arm, no arpeggio".
- **OFF caption:** "Max plays on at the last values".
- **Fallback:** today's card and detail, plus the line "link activitylevel.wav + burstflags.wav into data/ for the patch's own values".
- **Envelope cache:** cache it per `(patch, columns, range)`, for example in a `WeakMap` keyed on the patch, so it isn't recomputed every frame.

- [ ] **Step 1: Write the failing tests** (`soundLayout.test.ts`):
  - **`sound panels tile the story at any aspect`.** Story boxes `{0,0,1600,700}`, `{0,0,2960,420}` and `{0,0,300,860}`. For each:
    - the four boxes lie inside the story;
    - no two overlap (`overlaps` logic re-implemented in the test);
    - every `w` and `h` is > 0.
  - **`activity envelope keeps each column's peak`.** `[0, 1, 0, 0.5]` gives:
    - with 2 columns over 0..3: `[1, 0.5]`;
    - with 1 column over 2..3: `[0.5]`.

- [ ] **Step 2: Run them to see them fail.** Run: `node --test src/show/routing/soundLayout.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `soundLayout.ts`, then the glyphs and the card and detail drawing.**

- [ ] **Step 4: Run the tests and check types.** Run: `node --test src/show/routing/soundLayout.test.ts && npx tsc --noEmit 2>&1 | grep -c "error TS"`. Expected: PASS, then `2`.

- [ ] **Step 5: Commit.**

```bash
git add src/show/routing/soundLayout.ts src/show/routing/soundLayout.test.ts src/components/routing/soundGlyphs.ts src/components/routing/overview.ts src/components/routing/details.ts src/show/routing/facts.ts
git commit -m "Routing: SOUND card and detail from the patch (score, rules, harmony, speakers); solenoid chain"
```

---

### Task 6: Slicer, `TSL1`, and the termite asset

**Files:**
- Create:
  - `src/show/routing/slicer.ts` + `slicer.test.ts`
  - `src/show/routing/termiteSlices.ts` + `termiteSlices.test.ts`
  - `scripts/termite-slices.mjs`

**Interfaces:**
- Produces:

```ts
// slicer.ts
export interface Mesh { V: Float32Array; F: Uint32Array } // xyz per vertex; 3 vertex indices per face
export function sliceHeights(yMin: number, yMax: number, step: number): number[]; // yMin + (s + ½)·step < yMax
export function sliceMesh(mesh: Mesh, faceStart: number, faceEnd: number, heights: number[]): { y: number; lines: Float32Array[] }[];
// one entry per height inside the faces' y-range (empty lines allowed); chained via sorted vertex-pair edge keys
export function rdp(pts: Float32Array, tol: number): Float32Array; // x,z pairs; keeps both ends; a closed run (first = last) measures distance to the first point
// termiteSlices.ts
export interface TermiteSegment { yMin: number; yMax: number; slices: { y: number; lines: Float32Array[] }[] }
export interface TermiteSlices { step: number; bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }; segments: TermiteSegment[] }
export function encodeTermiteSlices(t: TermiteSlices): ArrayBuffer; // TSL1 as in the spec
export function parseTermiteSlices(buf: ArrayBuffer): TermiteSlices; // throws 'not a TSL1 file' | 'truncated TSL1' | 'no segments'
```

- **Script.** `scripts/termite-slices.mjs <obj> [out] [step] [tol]`:
  1. reads the OBJ line by line, tracking each `o` object's face range;
  2. orders the objects bottom to top by min Y;
  3. slices each one on `sliceHeights(globalMinY, globalMaxY, step)`;
  4. simplifies with `rdp`;
  5. encodes;
  6. prints segments, slices, polylines, points and bytes.

  It imports the `.ts` modules directly (Node strips the types), as `server/show-data.js` does with `ledFrame.ts`.

- [ ] **Step 1: Write the failing tests.**

  `slicer.test.ts`:
  - **`slice heights sit mid-step`:** `sliceHeights(0, 10, 4)` → `[2, 6]`.
  - **`a tetrahedron cut in the middle gives one closed contour`:**
    - a tetrahedron with apex y 1 and base y 0 (4 faces), cut at y 0.5;
    - one polyline of 4 points, first equal to last (closed), all at the half-size base.
  - **`a triangle touching the plane at a vertex gives no segment`:** a triangle with ys 0, 1, 1 at height 0 gives `lines.length = 0`.
  - **`two triangles sharing an edge chain into one polyline`:** a quad split in two, cut through both triangles, gives one polyline of 3 points.
  - **`rdp keeps corners and drops collinear points`:**
    - an L of 5 points with collinear middles → 3 points;
    - a closed square of 9 points → 5 points.

  `termiteSlices.test.ts`:
  - **`TSL1 round-trips within the quantization`:** 2 segments, 3 slices; every point is within (bounds span / 65535) of the original, and the segment ranges are exact.
  - **`a segment without slices round-trips`:** `slices: []` comes back as `[]`.
  - **`bad files throw`:** `'XSL1'` → `/not a TSL1 file/`; truncated by 3 bytes → `/truncated TSL1/`; 0 segments → `/no segments/`.

- [ ] **Step 2: Run them to see them fail.** Run: `node --test src/show/routing/slicer.test.ts src/show/routing/termiteSlices.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `slicer.ts`, `termiteSlices.ts` and the script.**

- [ ] **Step 4: Run the tests again.** Run: `node --test src/show/routing/slicer.test.ts src/show/routing/termiteSlices.test.ts`. Expected: PASS.

- [ ] **Step 5: Make the asset.** Run: `node scripts/termite-slices.mjs /Users/toka/Professional/Metaesthetica/dev/termites/Final_Scaled_Artifact.obj data/termite_slices.bin 2 0.25`. Expected:
  - it prints `4 segments`;
  - roughly 285 slices in total;
  - a file under 1.5 MB;
  - a runtime under 60 s.

  Then run `node -e` to parse it back with `parseTermiteSlices` and print the segment yMin values: they rise bottom to top.

- [ ] **Step 6: Commit.** The asset stays local: `data/` is gitignored.

```bash
git add src/show/routing/slicer.ts src/show/routing/slicer.test.ts src/show/routing/termiteSlices.ts src/show/routing/termiteSlices.test.ts scripts/termite-slices.mjs
git commit -m "Routing: mesh slicer, TSL1 slice format, termite slice script"
```

---

### Task 7: FAB card and detail

**Files:**
- Create:
  - `src/show/routing/sliceView.ts` + `sliceView.test.ts`
  - `src/components/routing/artifactGlyphs.ts`
- Modify:
  - `src/components/routing/overview.ts` (`drawFab`, `DrawInput` gains `termite: TermiteSlices | null` and `artifacts: ArtifactCache`)
  - `src/components/routing/details.ts` (`fab()`)
  - `src/components/RoutingView.tsx`, `src/components/ShowPanel.tsx`, `src/App.tsx` (fetch `termite_slices.bin`, `parseTermiteSlices`, prop `termite`)
  - `src/show/routing/facts.ts`: `FAB_FACTS` with `{ termite: { material: 'PLA', segments: 4, lattice: '100³', source: 'SIGGRAPH 2026' } }`

**Interfaces:**
- Consumes: `TermiteSlices` (Task 6), `Vessel` / `layerForIndex` / `printedLayers` (existing).
- Produces (pure, in `sliceView.ts`):

```ts
export interface StackSlice { y: number; lines: Float32Array[]; segment: number } // segment −1 for the vessel
export function vesselStack(v: Vessel): StackSlice[];               // one closed loop per layer, y = (layer + 1)·layerMm
export function termiteStack(t: TermiteSlices, explode: number): StackSlice[]; // segment k shifted up by k·explode
export function project(x: number, y: number, z: number, yaw: number, elev: number): [sx: number, sy: number, depth: number];
// orthographic: rx = x cos − z sin; rz = x sin + z cos; sy = y cos(elev) − rz sin(elev); depth = rz cos(elev) + y sin(elev)
export function sliceStride(slices: number, spanPx: number, minGapPx?: number): number; // ≥ 1, keeps ≥ minGapPx (3)
export function depthAlpha(depth: number, radius: number): number;  // 0.25 back … 1 front, clamped
export function fabPanels(story: Box): { form: Box; vessel: Box; schematic: Box };
```

- **`artifactGlyphs.ts`** (canvas):
  - `drawStack(g, box, stack, { yaw, elev, color, current?, faintAbove?, dottedAbove? })` takes one stroke per polyline, with alpha from `depthAlpha` at the polyline's mean depth.
  - `ArtifactCache` holds offscreen canvases re-rendered at most every 100 ms per (box, view) key; `createArtifactCache()`.
  - `schematic(g, box, ledShare, s)`: the frame rectangle, small vessel and form glyphs, two LED squares, and fibres to flask outlines. The fibres' glow is `ledShare`, the share of lit LED cells from `live.ledCells`.
  - `printSweep(...)` draws the highlighted slice and the top-view inset.

**Content:** as in the spec's "FAB card" and "FAB detail" sections.

- **Turn rate:** one turn per 48 s; elevation 14°.
- **Termite views:** "turning" ↔ "4 print segments" every 12 s, cross-faded over 1 s.
- **Sweep:** about 2 s per 10 slices, through segments 1 → 4.
- **Vessel:** layer ≈ index as today.
- **Captions:**
  - `termite form · PLA · 4 segments · made before the show`;
  - `vessel · clay · layer N / M ≈`;
  - `schematic · not to scale`;
  - the pipeline line from the spec.
- **Missing files:** with one missing, a one-line `link … into data/` note.

- [ ] **Step 1: Write the failing tests** (`sliceView.test.ts`):
  - **`a point on the axis projects to the centre line`:** `project(0, 5, 0, 1.2, 0.2)[0] = 0`.
  - **`a quarter turn moves +x into depth`:** `project(1, 0, 0, Math.PI / 2, 0)` gives `[0, ·, 1]` within 1e-9.
  - **`the front gets the higher alpha`:** `depthAlpha(10, 10) = 1`, `depthAlpha(-10, 10) = 0.25`, `depthAlpha(0, 10)` is in (0.25, 1).
  - **`the stride keeps slices 3 px apart`:** `sliceStride(285, 300) = 3`, `sliceStride(285, 2000) = 1`, `sliceStride(0, 100) = 1`.
  - **`the vessel becomes one loop per layer`:** a 2-layer `Vessel` gives 2 slices at y = layerMm and 2·layerMm, segment −1.
  - **`segments explode upward in order`:** `termiteStack(t, 10)` puts the first slice of segment index 2 (0-based) at its y + 20.
  - **`fab panels tile the story at any aspect`:** the same three story boxes as Task 5 give `form`, `vessel` and `schematic` inside the story, with no overlaps and positive sizes.

- [ ] **Step 2: Run them to see them fail.** Run: `node --test src/show/routing/sliceView.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `sliceView.ts`, then `artifactGlyphs.ts`, then the card and detail and the data wiring.**

- [ ] **Step 4: Run the tests and check types.** Run: `npm test > .superpowers/sdd/routing-sound-fab/test.log 2>&1; tail -5 .superpowers/sdd/routing-sound-fab/test.log; npx tsc --noEmit 2>&1 | grep -c "error TS"`. Expected: all pass; `2`.

- [ ] **Step 5: Commit.**

```bash
git add src/show/routing/sliceView.ts src/show/routing/sliceView.test.ts src/components/routing/artifactGlyphs.ts src/components/routing/overview.ts src/components/routing/details.ts src/components/RoutingView.tsx src/components/ShowPanel.tsx src/App.tsx src/show/routing/facts.ts
git commit -m "Routing: FAB card and detail as turning slice stacks (termite form, vessel), schematic"
```

---

### Task 8: Harness check, docs

**Files:**
- Modify: `README.md` ("Routing view" section), `docs/ARCHITECTURE.md` ("Routing view" section), and the spec (an "Amendments" section if anything changed in the build)
- Scratchpad only, not committed: `…/scratchpad/harness/` (`vite.harness.config.mjs`, `index.html`, `main.ts`)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Build the harness.**
  - **Server:** a Vite config with `root` = the repo and `server.port` = a free port (5199) with `strictPort`.
  - **Middleware:** serves `/harness/*` from the scratchpad and `/data/*` from the repo's `data/`.
  - **Page:** imports `drawOverview` / `drawDetail` / `detailLayout` / `routingLayout`, `createLiveState` / `advanceLive`, and the parsers. It loads the real data files with `fetch('/data/…')` and runs a local playhead at show speed (60 indices/s) and at the default speed.
  - **Controls:** query parameters choose the view (`overview`, `sound`, `fab`), the size and the mode (`show` with pass 2, or `local`).
  - **Isolation:** it imports no WebSocket code.

- [ ] **Step 2: Look at it.** Open, with Playwright, only `http://localhost:5199/harness/index.html?...`:
  - Sizes: 1920×1080 and 1080×1920.
  - Views: overview, SOUND detail, FAB detail.
  - Modes: show mode at an index inside a burst (for example 2900, just before the first flag), and local mode.
  - Expected:
    - 0 console errors;
    - the sound score shows events;
    - the chord strip lights a step in show mode and none in local;
    - the FAB form turns between screenshots;
    - text doesn't overlap its boxes.

  Fix what's wrong, then commit with "Routing: harness fixes".

- [ ] **Step 3: Update the docs.**
  - **README "Routing view":** the three new optional data files, with the `ln -s` lines for the WAVs and the `node scripts/termite-slices.mjs …` command.
  - **ARCHITECTURE "Routing view":**
    - the new modules in the **Rules** list;
    - the sound view;
    - the slice renderer and its cache;
    - the data inputs list.

- [ ] **Step 4: Run the full checks.** Run: `npm test > .superpowers/sdd/routing-sound-fab/test.log 2>&1; tail -5 .superpowers/sdd/routing-sound-fab/test.log; npx tsc --noEmit 2>&1 | grep -c "error TS"`. Expected: all pass; `2`.

- [ ] **Step 5: Commit.**

```bash
git add README.md docs/ARCHITECTURE.md docs/superpowers/specs/2026-10-20-routing-sound-fab-design.md
git commit -m "Docs: routing sound from the patch, fab slices"
```

## Unresolved questions

- Termite OBJ units?
- Were all 4 segments printed, bottom to top?
- Which clay piece is `single-object-436666.gcode`? How does it pair with the termite form in this show?
- Is arm 1 on serial with the serial patch open in this show?
- Does anything fade the sound in OFF (`r cueAudio`)?
- Is `backboneSpikes.txt` the 27 backbone columns?
- Should Max send `/routing/sound/harmony` (counter 0–17)?
