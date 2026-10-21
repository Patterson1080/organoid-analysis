import test from 'node:test';
import assert from 'node:assert/strict';
import { LED_COLOR, advanceLive, createLiveState } from './live.ts';
import type { LiveInput } from './live.ts';
import { parseFiringBlob } from './firingBlob.ts';
import { patchData } from './maxPatch.ts';
import { eventsSince } from './soundEvents.ts';
import { applyTelemetry, createTelemetry } from './telemetry.ts';
import type { Neuron, SpikeEvent } from '../../types';

const neuron = (id: number, x: number, y: number, backbone: boolean): Neuron => ({ neuron_id: id, x, y, is_backbone: backbone, xy_norm_0: x, xy_norm_1: y });
const neurons = [neuron(1, 0, 0, false), neuron(2, 0.5, 0.5, true), neuron(3, 1, 1, false)];
const spikes: SpikeEvent[] = [{ timestamp_ms: 5, neuron_id: 3 }, { timestamp_ms: 10, neuron_id: 2 }, { timestamp_ms: 95, neuron_id: 1 }];
const input = (over: Partial<LiveInput>): LiveInput => ({
    index: null, spikes, blob: null, ledFrames: [], telemetry: null, dtMs: 16, now: 0,
    patch: null, mode: 'local', pass: 1, range: { start: 0, end: 179999 }, ...over,
});

function blob(neuronCount: number, frames: number, rows: Record<number, number[]>): ArrayBuffer {
    const buf = new ArrayBuffer(12 + neuronCount * frames * 2);
    const dv = new DataView(buf);
    for (let i = 0; i < 4; i++) dv.setUint8(i, 'TFR1'.charCodeAt(i));
    dv.setUint32(4, neuronCount, true);
    dv.setUint32(8, frames, true);
    for (const [f, values] of Object.entries(rows)) values.forEach((v, n) => dv.setUint16(12 + (Number(f) * neuronCount + n) * 2, v, true));
    return buf;
}

test('a spike lights its neuron, then decays', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 10 }));
    assert.equal(s.spikeGlow[1], 1);
    assert.ok(s.fired.includes(1));
    for (const dtMs of [100, 100, 100, 50]) advanceLive(s, input({ index: 11, dtMs })); // 350 ms in steps under the 100 ms clamp
    assert.ok(Math.abs(s.spikeGlow[1] - Math.exp(-1)) < 1e-3);
});

test('backbone spikes strike their slot', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 10 }));
    assert.equal(s.slotOf[1], 0);
    assert.equal(s.slotOf[0], -1);
    assert.equal(s.strikeGlow[0], 1);
    assert.deepEqual(s.strikeLog.at(-1), { slot: 0, neuronId: 2, t: 10 });
    assert.equal(s.strikeSource, 'computed');
});

test('a backwards jump re-slices from 30 ms before the new index', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 100 }));
    assert.deepEqual(s.fired, [0]); // t 95, not t 5
    advanceLive(s, input({ index: 50 }));
    assert.deepEqual(s.fired, []);
    advanceLive(s, input({ index: 6 }));
    assert.deepEqual(s.fired, [2]); // t 5
});

test('a long gap decays as 100 ms', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 10 }));
    advanceLive(s, input({ index: 11, dtMs: 60_000 }));
    assert.ok(Math.abs(s.spikeGlow[1] - Math.exp(-100 / 350)) < 1e-3);
});

test('the blob drives firing only when it matches', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 10, blob: parseFiringBlob(blob(3, 20, { 10: [0x3c00, 0x3800, 0] })) }));
    assert.equal(s.firingSource, 'blob');
    assert.deepEqual([...s.firing], [1, 0.5, 0]);
    const other = createLiveState(neurons, spikes);
    advanceLive(other, input({ index: 10, blob: parseFiringBlob(blob(131, 20, {})) }));
    assert.equal(other.firingSource, 'mismatch'); // a blob, but for another dataset
    assert.equal(other.firing[1], 1); // the spike glow stands in
    const none = createLiveState(neurons, spikes);
    advanceLive(none, input({ index: 10 }));
    assert.equal(none.firingSource, 'spikes');
});

test('a held playhead fades the firing like EoC and stops the flow', () => {
    const b = parseFiringBlob(blob(3, 20, { 10: [0x3c00, 0x3800, 0], 11: [0x3800, 0, 0] }));
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 10, blob: b, now: 0 }));
    assert.deepEqual([...s.firing], [1, 0.5, 0]);
    assert.equal(s.moving, true);
    for (let now = 100; now <= 800; now += 100) advanceLive(s, input({ index: 10, blob: b, now, dtMs: 100 }));
    assert.equal(s.moving, false); // paused: nothing is being sent
    assert.deepEqual([...s.firing], [0, 0, 0]); // faded over EoC's 0.5 s
    assert.equal(s.firingSource, 'blob');
    advanceLive(s, input({ index: 11, blob: b, now: 900 }));
    assert.equal(s.moving, true);
    assert.deepEqual([...s.firing], [0.5, 0, 0]);
});

test('local playback keeps every spike of a frame, up to 250 ms; a bigger jump keeps 30 ms', () => {
    const sp: SpikeEvent[] = [{ timestamp_ms: 10, neuron_id: 1 }, { timestamp_ms: 40, neuron_id: 3 }, { timestamp_ms: 500, neuron_id: 1 }, { timestamp_ms: 1030, neuron_id: 2 }];
    const s = createLiveState(neurons, sp);
    advanceLive(s, input({ index: 0, spikes: sp }));
    advanceLive(s, input({ index: 45, spikes: sp })); // a 45 ms frame at 1× playback
    assert.deepEqual(s.fired, [0, 2]);
    advanceLive(s, input({ index: 1045, spikes: sp })); // a scrub forward
    assert.deepEqual(s.fired, [1]); // t 1030 only, not t 500
});

test('fresh sound telemetry stands in for the computed values', () => {
    const t = createTelemetry();
    const s = createLiveState(neurons, spikes);
    applyTelemetry(t, '/routing/sound/burst', [1], 1000);
    applyTelemetry(t, '/routing/sound/tones', [7.5], 1000);
    applyTelemetry(t, '/routing/sound/harmony', [3], 1000);
    advanceLive(s, input({ index: 200, telemetry: t, now: 1000 }));
    assert.equal(s.burst.inBurst, true); // the patch says burst, though the computed rate is 0
    assert.deepEqual(s.soundLive, { tones: 7.5, harmony: 3 });
    applyTelemetry(t, '/routing/sound/burst', [0], 1100);
    advanceLive(s, input({ index: 201, telemetry: t, now: 1100 }));
    assert.deepEqual(s.burst, { inBurst: false, ends: 1 });
    advanceLive(s, input({ index: 202, telemetry: t, now: 5000 }));
    assert.deepEqual(s.soundLive, {}); // stale
});

test('fresh touch telemetry marks its arm', () => {
    const t = createTelemetry();
    const s = createLiveState(neurons, spikes);
    applyTelemetry(t, '/routing/robot/2/touch', [1], 1000);
    advanceLive(s, input({ index: 200, telemetry: t, now: 1000 }));
    assert.deepEqual(s.arms.map(a => a.touch), [false, true, false]);
    advanceLive(s, input({ index: 201, telemetry: t, now: 5000 }));
    assert.deepEqual(s.arms.map(a => a.touch), [false, false, false]);
});

test('telemetry strikes at the same timestamp are each shown once', () => {
    const t = createTelemetry();
    const s = createLiveState(neurons, spikes);
    applyTelemetry(t, '/routing/solenoid', [1], 1000);
    advanceLive(s, input({ index: 200, telemetry: t, now: 1000 }));
    assert.equal(s.strikeGlow[1], 1);
    applyTelemetry(t, '/routing/solenoid', [2], 1000); // same coarse timestamp, after that frame
    advanceLive(s, input({ index: 201, telemetry: t, now: 1001 }));
    assert.equal(s.strikeGlow[2], 1);
    assert.equal(s.strikes, 2);
});

test('an LED frame lights the matrix as DualLED_Currents draws it, and gives its serial lines', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 10, ledFrames: [{ frame: { isBurst: false, firings: [{ x: 2, y: 3 }] }, at: 0 }] }));
    // F:x,y — the cell cyan at full life, a cyan halo at half life
    assert.deepEqual([s.ledColor[3 * 16 + 2], s.ledCells[3 * 16 + 2]], [LED_COLOR.cyan, 1]);
    assert.deepEqual([s.ledColor[3 * 16 + 3], s.ledCells[3 * 16 + 3]], [LED_COLOR.cyan, 0.5]);
    assert.deepEqual(s.ledLines, ['F:2,3']);
    // C:x,y — a disc of radius 3: red centre, purple to distance 2, blue to 3
    advanceLive(s, input({ index: 11, ledFrames: [{ frame: { isBurst: true, firings: [{ x: 8, y: 8 }] }, at: 0 }] }));
    const at = (x: number, y: number) => [s.ledColor[y * 16 + x], s.ledCells[y * 16 + x]];
    assert.deepEqual(at(8, 8), [LED_COLOR.red, 1]);
    assert.deepEqual(at(9, 8), [LED_COLOR.purple, 1]);
    assert.deepEqual(at(10, 8), [LED_COLOR.purple, 1]);
    assert.deepEqual(at(11, 8), [LED_COLOR.blue, 1]);
    assert.equal(s.ledCells[8 * 16 + 12], 0); // distance 4: untouched
    const burst = { isBurst: true, firings: Array.from({ length: 12 }, (_, i) => ({ x: i, y: 15 - i })) };
    advanceLive(s, input({ index: 12, ledFrames: [{ frame: burst, at: 0 }] }));
    assert.equal(s.ledLines.length, 10);
    assert.ok(s.ledLines.every(l => l.startsWith('C:')));
    assert.equal(s.ledFrames, 3);
});

test('fresh telemetry strikes replace computed ones', () => {
    const t = createTelemetry();
    applyTelemetry(t, '/routing/solenoid', [4], 1000);
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 10, telemetry: t, now: 1000 }));
    assert.equal(s.strikeSource, 'live');
    assert.equal(s.strikeGlow[4], 1);
    assert.equal(s.strikeGlow[0], 0); // the backbone spike in the slice doesn't strike
});

// The patch's data: a = 0.45 at index 1 (v = a · 0.966766), one burst flag there.
const patch = () => patchData(new Float32Array([0, 0.45 * 0.966766, 0, 0]), new Float32Array([0, 1, 0, 0]));

test('patch values at the playhead', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 1, patch: patch() }));
    assert.equal(s.sound.source, 'patch');
    assert.ok(Math.abs(s.sound.a - 0.45) < 1e-6);
    assert.equal(s.sound.toneMs, 300);
    assert.equal(s.sound.kickMs, 3200);
    assert.equal(s.sound.grainTickMs, 100);
    assert.deepEqual(s.sound.grainLen, [100, 200]);
});

test('without patch data the sound view falls back', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 1 }));
    assert.equal(s.sound.source, 'fallback');
});

test('an index past the patch data falls back', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 10, patch: patch() }));
    assert.equal(s.sound.source, 'fallback');
});

test('the show chord counts flags of earlier passes', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 2, patch: patch(), mode: 'show', pass: 2, range: { start: 0, end: 3 } }));
    assert.equal(s.sound.chordStep, 3); // 1 flag in pass 1 + 1 so far → counter step 3
    assert.equal(s.sound.chordSource, 'computed');
});

test('local playback leaves the chord unknown', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 2, patch: patch() }));
    assert.equal(s.sound.chordStep, null);
    assert.equal(s.sound.chordSource, 'unknown');
});

test('fresh harmony telemetry sets the chord', () => {
    const s = createLiveState(neurons, spikes);
    const t = createTelemetry();
    applyTelemetry(t, '/routing/sound/harmony', [5], 1000);
    advanceLive(s, input({ index: 2, patch: patch(), telemetry: t, now: 1000 }));
    assert.equal(s.sound.chordStep, 5);
    assert.equal(s.sound.chordSource, 'live');
});

test('the arpeggio follows arm 1, simulated or live', () => {
    const quiet = createLiveState(neurons, spikes);
    advanceLive(quiet, input({ index: 1, patch: patch(), now: 1000 }));
    assert.equal(quiet.sound.arm1.live, false);
    assert.equal(typeof quiet.sound.arpMs, 'number'); // the stand-in visitor's distance paces it
    const s = createLiveState(neurons, spikes);
    const t = createTelemetry();
    applyTelemetry(t, '/routing/robot/1/proximity', [50], 1000);
    advanceLive(s, input({ index: 1, patch: patch(), telemetry: t, now: 1000 }));
    assert.deepEqual(s.sound.arm1, { cm: 50, live: true });
    assert.equal(s.sound.arpMs, 265);
});

test('live distance drives the computed angle', () => {
    const s = createLiveState(neurons, spikes);
    const t = createTelemetry();
    applyTelemetry(t, '/routing/robot/1/proximity', [50], 1000);
    advanceLive(s, input({ index: 1, telemetry: t, now: 1000 }));
    assert.equal(s.arms[0].cm, 50);
    assert.deepEqual(s.arms[0].live, { proximity: true, servo: false, touch: false });
    assert.equal(s.arms[0].motion.target, 90);
});

test('live servo overrides the angle', () => {
    const s = createLiveState(neurons, spikes);
    const t = createTelemetry();
    applyTelemetry(t, '/routing/robot/1/servo', [30], 1000);
    advanceLive(s, input({ index: 1, telemetry: t, now: 1000 }));
    assert.equal(s.arms[0].servo, 30);
    assert.equal(s.arms[0].live.servo, true);
});

test('touch fades the fibre light in, and out after release', () => {
    const s = createLiveState(neurons, spikes);
    const t = createTelemetry();
    for (let i = 1; i <= 12; i++) {
        applyTelemetry(t, '/routing/robot/1/touch', [1], i * 100);
        advanceLive(s, input({ index: 1, telemetry: t, now: i * 100, dtMs: 100 }));
    }
    assert.ok(s.arms[0].light > 0.95, `${s.arms[0].light}`);
    for (let i = 13; i <= 24; i++) {
        applyTelemetry(t, '/routing/robot/1/touch', [0], i * 100);
        advanceLive(s, input({ index: 1, telemetry: t, now: i * 100, dtMs: 100 }));
    }
    assert.ok(s.arms[0].light < 0.05, `${s.arms[0].light}`);
});

test('no events while the playhead is still; they resume without a burst', () => {
    const s = createLiveState(neurons, spikes);
    let now = 0;
    for (let i = 0; i < 10; i++) advanceLive(s, input({ index: 1 + (i % 2), patch: patch(), now: (now += 100), dtMs: 100 }));
    const held = now;
    for (let i = 0; i < 100; i++) advanceLive(s, input({ index: null, patch: patch(), now: (now += 100), dtMs: 100 }));
    assert.equal(eventsSince(s.sound.sim, held + 1).length, 0);
    const before = eventsSince(s.sound.sim, -Infinity).length;
    advanceLive(s, input({ index: 1, patch: patch(), now: now + 16, dtMs: 16 }));
    assert.ok(eventsSince(s.sound.sim, -Infinity).length - before <= 4, '10 s of backlog would be dozens');
});

test('fresh tone telemetry overrides the patch rate, marked LIVE', () => {
    const s = createLiveState(neurons, spikes);
    const t = createTelemetry();
    applyTelemetry(t, '/routing/sound/tones', [7.5], 1000);
    advanceLive(s, input({ index: 1, patch: patch(), telemetry: t, now: 1000 }));
    assert.deepEqual(s.sound.rates.tones, { perSec: 7.5, live: true });
    assert.equal(s.sound.rates.grains.live, false);
    assert.ok(Math.abs(s.sound.rates.kick.perSec - 0.46875 / 3.2) < 1e-9); // audible kicks at 3200 ms
});

test('a held playhead keeps the last activity, and nothing triggers', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 1, patch: patch(), now: 0 }));
    for (let i = 1; i <= 100; i++) advanceLive(s, input({ index: null, patch: patch(), now: i * 100, dtMs: 100 }));
    assert.equal(s.sound.heardIndex, 1);
    assert.ok(Math.abs(s.sound.a - 0.45) < 1e-6);
    assert.equal(eventsSince(s.sound.sim, 200).length, 0);
});

test('a small step back replays nothing: the show playhead re-anchoring, or falling back to the index sent', () => {
    const sp: SpikeEvent[] = [996, 998, 1000, 1002].map(t => ({ timestamp_ms: t, neuron_id: 2 })); // neuron 2: slot 0
    const s = createLiveState(neurons, sp);
    let now = 0;
    for (const index of [996.9, 998.9, 1000.9, 1000.5, 1000, 1002.5]) advanceLive(s, input({ index, spikes: sp, mode: 'show', now: (now += 33) }));
    assert.equal(s.strikes, 4); // each once: re-slicing each step back would count 10
    assert.deepEqual(s.strikeLog.map(e => e.t), [996, 998, 1000, 1002]);
    assert.equal(s.shownTo, 1002.5);
});

test('after the show stops, the held last index sent is still, and replays nothing', () => {
    const sp: SpikeEvent[] = [{ timestamp_ms: 20590, neuron_id: 2 }];
    const s = createLiveState(neurons, sp);
    advanceLive(s, input({ index: 20600.72, spikes: sp, mode: 'show', now: 0 })); // the last show frame
    const strikes = s.strikes;
    for (let now = 33; now <= 660; now += 33) advanceLive(s, input({ index: 20600, spikes: sp, now })); // local: playbackTimeRef = s.index
    assert.equal(s.strikes, strikes);
    assert.equal(s.moving, false);
});

test("a show pass strikes nothing before its first index, whatever the playhead did before it", () => {
    const sp: SpikeEvent[] = [{ timestamp_ms: 990, neuron_id: 2 }, { timestamp_ms: 1001, neuron_id: 2 }];
    const range = { start: 1000, end: 179999 };
    const s = createLiveState(neurons, sp);
    advanceLive(s, input({ index: 1010, spikes: sp, now: 0 })); // local playback just ahead of the show's start
    const before = s.strikes;
    advanceLive(s, input({ index: 1001.5, spikes: sp, mode: 'show', pass: 1, range, now: 33 }));
    assert.equal(s.strikes - before, 1);
    assert.equal(s.strikeLog.at(-1)?.t, 1001);
    const next = createLiveState(neurons, sp);
    advanceLive(next, input({ index: 1000.5, spikes: sp, mode: 'show', pass: 2, range, now: 0 })); // a pass after OFF
    assert.equal(next.strikes, 0); // 990 is the previous pass's tail, never sent in this one
});

test('every queued LED frame is drawn; a backlog older than a slow frame is not', () => {
    const s = createLiveState(neurons, spikes);
    const burst = { isBurst: true, firings: [{ x: 8, y: 8 }] }, trail = { isBurst: false, firings: [{ x: 2, y: 3 }] };
    advanceLive(s, input({ index: 10, now: 1000, ledFrames: [{ frame: burst, at: 975 }, { frame: trail, at: 990 }] }));
    assert.equal(s.ledFrames, 2);
    assert.equal(s.ledColor[8 * 16 + 8], LED_COLOR.red); // the burst between two draws still lands
    assert.deepEqual(s.ledLines, ['F:2,3']);
    assert.equal(s.ledAgeMs, 10);
    const stale = createLiveState(neurons, spikes); // e.g. a new dataset after the last frame was long sent
    advanceLive(stale, input({ index: 10, now: 60_000, ledFrames: [{ frame: burst, at: 1000 }] }));
    assert.equal(stale.ledFrames, 0);
    assert.equal(stale.lastLedFrame, null);
});

test('buffered telemetry strikes are not replayed as new', () => {
    const t = createTelemetry();
    for (let i = 0; i < 64; i++) applyTelemetry(t, '/routing/solenoid', [i % 27], i * 500);
    applyTelemetry(t, '/routing/solenoid', [5], 40_000);
    const s = createLiveState(neurons, spikes); // a new state: the bridge autoload, a reload, an upload
    advanceLive(s, input({ index: 10, telemetry: t, now: 40_010 }));
    assert.equal(s.strikes, 1);
    assert.deepEqual(s.strikeLog.map(e => e.slot), [5]);
});

test("Max's report of a strike just computed here counts once", () => {
    const sp: SpikeEvent[] = [{ timestamp_ms: 100, neuron_id: 2 }];
    const t = createTelemetry();
    const s = createLiveState(neurons, sp);
    advanceLive(s, input({ index: 100, spikes: sp, telemetry: t, now: 5000 })); // no fresh telemetry: computed
    assert.equal(s.strikeSource, 'computed');
    applyTelemetry(t, '/routing/solenoid', [0], 5020); // Max's own report of that strike, a moment later
    advanceLive(s, input({ index: 102, spikes: sp, telemetry: t, now: 5033 }));
    assert.equal(s.strikeSource, 'live');
    assert.equal(s.strikes, 1);
    applyTelemetry(t, '/routing/solenoid', [0], 5300); // the next one is new
    advanceLive(s, input({ index: 120, spikes: sp, telemetry: t, now: 5310 }));
    assert.equal(s.strikes, 2);
});

test("out-of-range arm telemetry is held to the sensor's and the servo's ranges", () => {
    const s = createLiveState(neurons, spikes);
    const t = createTelemetry();
    applyTelemetry(t, '/routing/robot/1/proximity', [-1], 1000);
    applyTelemetry(t, '/routing/robot/1/servo', [250], 1000);
    applyTelemetry(t, '/routing/robot/2/proximity', [400], 1000);
    advanceLive(s, input({ index: 1, telemetry: t, now: 1000 }));
    assert.equal(s.arms[0].cm, 0);
    assert.equal(s.arms[0].servo, 180);
    assert.equal(s.arms[1].cm, 100);
});

test('a state begun in OFF holds the index the bridge sent last: the pass end', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: null, patch: patch(), mode: 'show', range: { start: 0, end: 3 }, now: 1000 }));
    assert.equal(s.sound.heardIndex, 3);
    assert.equal(s.sound.source, 'patch');
});
