import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWav16 } from './wav.ts';

interface WavOptions {
    format?: number;
    channels?: number;
    bits?: number;
    samples?: number[];
    before?: { id: string; bytes: number }; // an extra chunk ahead of 'data'
    magic?: string;
    data?: boolean;
}

/** A little-endian RIFF/WAVE file: 'fmt ', an optional extra chunk (padded to even), then 'data'. */
function wav({ format = 1, channels = 1, bits = 16, samples = [], before, magic = 'RIFF', data = true }: WavOptions): ArrayBuffer {
    const extra = before ? 8 + before.bytes + (before.bytes & 1) : 0;
    const dataBytes = data ? 8 + samples.length * 2 : 0;
    const buf = new ArrayBuffer(12 + 24 + extra + dataBytes);
    const dv = new DataView(buf);
    const ascii = (at: number, s: string) => { for (let i = 0; i < 4; i++) dv.setUint8(at + i, s.charCodeAt(i)); };
    ascii(0, magic);
    dv.setUint32(4, buf.byteLength - 8, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, format, true);
    dv.setUint16(22, channels, true);
    dv.setUint32(24, 1000, true);
    dv.setUint32(28, 1000 * channels * (bits / 8), true);
    dv.setUint16(32, channels * (bits / 8), true);
    dv.setUint16(34, bits, true);
    let at = 36;
    if (before) {
        ascii(at, before.id);
        dv.setUint32(at + 4, before.bytes, true);
        at += extra;
    }
    if (data) {
        ascii(at, 'data');
        dv.setUint32(at + 4, samples.length * 2, true);
        samples.forEach((v, i) => dv.setInt16(at + 8 + i * 2, v, true));
    }
    return buf;
}

test('16-bit mono samples come out over 32768', () => {
    assert.deepEqual(Array.from(parseWav16(wav({ samples: [0, 16384, -32768, 32767] }))), [0, 0.5, -1, Math.fround(32767 / 32768)]);
});

test('a padded odd-sized chunk before data is skipped', () => {
    assert.deepEqual(Array.from(parseWav16(wav({ samples: [100], before: { id: 'LIST', bytes: 3 } }))), [Math.fround(100 / 32768)]);
});

test('other formats throw', () => {
    assert.throws(() => parseWav16(wav({ bits: 8, samples: [1] })), /16-bit PCM mono/);
    assert.throws(() => parseWav16(wav({ channels: 2, samples: [1, 2] })), /16-bit PCM mono/);
    assert.throws(() => parseWav16(wav({ format: 3, samples: [1] })), /16-bit PCM mono/);
    assert.throws(() => parseWav16(wav({ data: false })), /no data chunk/);
    assert.throws(() => parseWav16(wav({ magic: 'RIFX', samples: [1] })), /RIFF\/WAVE/);
});
