// EoC's firing blob (organoid_firing.f16): the normalized firing rate of every neuron at every
// frame, which /index selects a row of. The routing view reads the same file so the Visual card
// shows what EoC sees, not the spikes.
//
// Format: ASCII "TFR1", uint32 LE neuron count, uint32 LE frame count, then half floats,
// frame-major: value (frame f, neuron n) = data[f * neurons + n]. Read through a Uint16Array,
// so on a little-endian host, like every machine the show runs on.

export interface FiringBlob {
    neurons: number;
    frames: number;
    data: Uint16Array;
}

export function parseFiringBlob(buf: ArrayBuffer): FiringBlob {
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
    if (magic !== 'TFR1') throw new Error('not a TFR1 firing blob');
    if (buf.byteLength < 12) throw new Error('firing blob size: header truncated');
    const dv = new DataView(buf);
    const neurons = dv.getUint32(4, true);
    const frames = dv.getUint32(8, true);
    if (buf.byteLength < 12 + 2 * neurons * frames) {
        throw new Error(`firing blob size: ${buf.byteLength} bytes for ${neurons} × ${frames}`);
    }
    return { neurons, frames, data: new Uint16Array(buf, 12, neurons * frames) };
}

/** IEEE 754 binary16 → number. */
export function halfToFloat(h: number): number {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    if (exp === 0) return sign * frac * 2 ** -24; // zero and subnormals
    if (exp === 0x1f) return frac ? NaN : sign * Infinity;
    return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** The row at `index` (floored, clamped to the blob) decoded into `out`. */
export function firingRow(blob: FiringBlob, index: number, out: Float32Array): Float32Array {
    const frame = Math.min(blob.frames - 1, Math.max(0, Math.floor(index)));
    const base = frame * blob.neurons;
    for (let n = 0; n < blob.neurons; n++) out[n] = halfToFloat(blob.data[base + n]);
    return out;
}
