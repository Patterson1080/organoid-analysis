import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceLive, createLiveState } from './live.ts';
import type { LiveInput } from './live.ts';
import { parseFiringBlob } from './firingBlob.ts';
import { applyTelemetry, createTelemetry } from './telemetry.ts';
import type { Neuron, SpikeEvent } from '../../types';

const neuron = (id: number, x: number, y: number, backbone: boolean): Neuron => ({ neuron_id: id, x, y, is_backbone: backbone, xy_norm_0: x, xy_norm_1: y });
const neurons = [neuron(1, 0, 0, false), neuron(2, 0.5, 0.5, true), neuron(3, 1, 1, false)];
const spikes: SpikeEvent[] = [{ timestamp_ms: 5, neuron_id: 3 }, { timestamp_ms: 10, neuron_id: 2 }, { timestamp_ms: 95, neuron_id: 1 }];
const input = (over: Partial<LiveInput>): LiveInput => ({ index: null, spikes, blob: null, ledFrame: null, telemetry: null, dtMs: 16, now: 0, ...over });

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
    assert.equal(other.firingSource, 'spikes');
    assert.equal(other.firing[1], 1); // the spike glow stands in
});

test('an LED frame becomes cells and serial lines', () => {
    const s = createLiveState(neurons, spikes);
    advanceLive(s, input({ index: 10, ledFrame: { isBurst: false, firings: [{ x: 2, y: 3 }] } }));
    assert.equal(s.ledCyan[3 * 16 + 2], 1);
    assert.equal(s.ledCells[3 * 16 + 2], 1);
    assert.ok(Math.abs(s.ledCells[3 * 16 + 3] - 0.55) < 1e-6);
    assert.deepEqual(s.ledLines, ['F:2,3']);
    const burst = { isBurst: true, firings: Array.from({ length: 12 }, (_, i) => ({ x: i, y: 15 - i })) };
    advanceLive(s, input({ index: 11, ledFrame: burst }));
    assert.equal(s.ledLines.length, 10);
    assert.ok(s.ledLines.every(l => l.startsWith('C:')));
    assert.equal(s.ledFrames, 2);
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
