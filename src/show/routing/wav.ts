// The Max patch's data buffers (activitylevel.wav, burstflags.wav): 16-bit PCM mono at 1 kHz, one
// sample per /index. Max's peek~ reads them as sample / 32768, so this returns the same values.

/** The samples of a 16-bit PCM mono RIFF/WAVE file, over 32768. */
export function parseWav16(buf: ArrayBuffer): Float32Array {
    const dv = new DataView(buf);
    const id = (at: number) => String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
    if (buf.byteLength < 12 || id(0) !== 'RIFF' || id(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
    let pcm16Mono = false;
    for (let at = 12; at + 8 <= buf.byteLength;) {
        const chunk = id(at), size = dv.getUint32(at + 4, true), body = at + 8;
        if (chunk === 'fmt ') {
            pcm16Mono = dv.getUint16(body, true) === 1 && dv.getUint16(body + 2, true) === 1 && dv.getUint16(body + 14, true) === 16;
        } else if (chunk === 'data') {
            if (!pcm16Mono) break;
            const n = Math.min(size, buf.byteLength - body) >> 1;
            const out = new Float32Array(n);
            for (let i = 0; i < n; i++) out[i] = dv.getInt16(body + i * 2, true) / 32768;
            return out;
        }
        at = body + size + (size & 1); // chunks are padded to an even size
    }
    throw new Error(pcm16Mono ? 'no data chunk' : 'not 16-bit PCM mono');
}
