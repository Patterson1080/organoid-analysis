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
    index: null, spikes, blob: null, ledFrame: null, telemetry: null, dtMs: 16, now: 0,
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
    advanceLive(s, input({ index: 10, ledFrame: { isBurst: false, firings: [{ x: 2, y: 3 }] } }));
    // F:x,y — the cell cyan at full life, a cyan halo at half life
    assert.deepEqual([s.ledColor[3 * 16 + 2], s.ledCells[3 * 16 + 2]], [LED_COLOR.cyan, 1]);
    assert.deepEqual([s.ledColor[3 * 16 + 3], s.ledCells[3 * 16 + 3]], [LED_COLOR.cyan, 0.5]);
    assert.deepEqual(s.ledLines, ['F:2,3']);
    // C:x,y — a disc of radius 3: red centre, purple to distance 2, blue to 3
    advanceLive(s, input({ index: 11, ledFrame: { isBurst: true, firings: [{ x: 8, y: 8 }] } }));
    const at = (x: number, y: number) => [s.ledColor[y * 16 + x], s.ledCells[y * 16 + x]];
    assert.deepEqual(at(8, 8), [LED_COLOR.red, 1]);
    assert.deepEqual(at(9, 8), [LED_COLOR.purple, 1]);
    assert.deepEqual(at(10, 8), [LED_COLOR.purple, 1]);
    assert.deepEqual(at(11, 8), [LED_COLOR.blue, 1]);
    assert.equal(s.ledCells[8 * 16 + 12], 0); // distance 4: untouched
    const burst = { isBurst: true, firings: Array.from({ length: 12 }, (_, i) => ({ x: i, y: 15 - i })) };
    advanceLive(s, input({ index: 12, ledFrame: burst }));
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

test('arm 1 telemetry drives the arpeggio; without it there is none', () => {
    const s = createLiveState(neurons, spikes);
    const t = createTelemetry();
    applyTelemetry(t, '/routing/robot/1/proximity', [50], 1000);
    advanceLive(s, input({ index: 1, patch: patch(), telemetry: t, now: 1000 }));
    assert.equal(s.sound.arm1Cm, 50);
    assert.equal(s.sound.arpMs, 265);
    const quiet = createLiveState(neurons, spikes);
    for (let i = 1; i <= 20; i++) advanceLive(quiet, input({ index: 1, patch: patch(), now: i * 100, dtMs: 100 }));
    assert.equal(quiet.sound.arpMs, null);
    assert.equal(eventsSince(quiet.sound.sim, -Infinity).filter(e => e.kind === 'arp').length, 0);
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

test('a held playhead keeps the last activity', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 1, patch: patch(), now: 0 }));
    for (let i = 1; i <= 100; i++) advanceLive(s, input({ index: null, patch: patch(), now: i * 100, dtMs: 100 }));
    assert.equal(s.sound.heardIndex, 1);
    assert.ok(Math.abs(s.sound.a - 0.45) < 1e-6);
    assert.ok(eventsSince(s.sound.sim, 5000).some(e => e.kind === 'tone'));
});
