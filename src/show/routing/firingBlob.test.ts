import test from 'node:test';
import assert from 'node:assert/strict';
import { firingRow, halfToFloat, parseFiringBlob } from './firingBlob.ts';

function blob(neurons: number, frames: number, values: number[], magic = 'TFR1'): ArrayBuffer {
    const buf = new ArrayBuffer(12 + values.length * 2);
    const dv = new DataView(buf);
    for (let i = 0; i < 4; i++) dv.setUint8(i, magic.charCodeAt(i));
    dv.setUint32(4, neurons, true);
    dv.setUint32(8, frames, true);
    values.forEach((v, i) => dv.setUint16(12 + i * 2, v, true));
    return buf;
}

test('half floats decode', () => {
    assert.equal(halfToFloat(0x3c00), 1);
    assert.equal(halfToFloat(0x3800), 0.5);
    assert.equal(halfToFloat(0x0000), 0);
    assert.equal(halfToFloat(0xc000), -2);
    assert.equal(halfToFloat(0x2e66), 0.0999755859375);
    assert.equal(halfToFloat(0x7c00), Infinity);
    assert.equal(halfToFloat(0x0001), 2 ** -24);
});

test('rows are frame-major and clamped', () => {
    const b = parseFiringBlob(blob(2, 3, [0x3c00, 0, 0, 0x3800, 0x3c00, 0x3c00]));
    assert.equal(b.neurons, 2);
    assert.equal(b.frames, 3);
    const out = new Float32Array(2);
    assert.deepEqual([...firingRow(b, 1, out)], [0, 0.5]);
    assert.deepEqual([...firingRow(b, -5, out)], [1, 0]);
    assert.deepEqual([...firingRow(b, 99, out)], [1, 1]);
    assert.deepEqual([...firingRow(b, 1.7, out)], [0, 0.5]);
});

test('bad files throw', () => {
    assert.throws(() => parseFiringBlob(blob(2, 3, [0, 0, 0, 0, 0, 0], 'TFR0')), /TFR1/);
    assert.throws(() => parseFiringBlob(blob(2, 3, [0, 0, 0])), /size/);
});
