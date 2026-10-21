// Geometry for the SOUND detail: its four panels, and the activity curve reduced to one peak per
// pixel column so the whole pass can be drawn every frame.

import type { Box } from './layout.ts';
import { typeScale } from './layout.ts';

const LANDSCAPE = 1.1;
const PORTRAIT_SHARES = [0.34, 0.22, 0.2, 0.24]; // score, rules, harmony, output

/** Landscape: score over rules on the left (62 %), harmony over output on the right. Portrait: four rows. */
export function soundPanels(story: Box): { score: Box; rules: Box; harmony: Box; output: Box } {
    const g = 10 * typeScale(story.w, story.h);
    const pos = (n: number) => Math.max(1, n);
    if (story.w / story.h >= LANDSCAPE) {
        const lw = pos((story.w - g) * 0.62), rw = pos(story.w - g - lw);
        const sh = pos((story.h - g) * 0.55), hh = pos((story.h - g) * 0.45);
        const right = story.x + lw + g;
        return {
            score: { x: story.x, y: story.y, w: lw, h: sh },
            rules: { x: story.x, y: story.y + sh + g, w: lw, h: pos(story.h - sh - g) },
            harmony: { x: right, y: story.y, w: rw, h: hh },
            output: { x: right, y: story.y + hh + g, w: rw, h: pos(story.h - hh - g) },
        };
    }
    const usable = story.h - 3 * g;
    let y = story.y;
    const [score, rules, harmony, output] = PORTRAIT_SHARES.map(f => {
        const b = { x: story.x, y, w: story.w, h: pos(usable * f) };
        y += b.h + g;
        return b;
    });
    return { score, rules, harmony, output };
}

/** The VOICES and OUTPUT captions: whatever the playhead does, the picks shown are drawn here. */
export function soundCaptions(moving: boolean): { voices: string; output: string } {
    return {
        voices: `${moving ? 'the last 10 s' : 'Max plays on at the last values'} · drawn like Max draws them`,
        output: 'positions drawn like Max draws them',
    };
}

/** The peak of each column's share of [start, end]. */
export function activityEnvelope(activity: Float32Array, columns: number, start: number, end: number): Float32Array {
    const out = new Float32Array(Math.max(0, Math.floor(columns)));
    const lo = Math.max(0, Math.floor(start)), hi = Math.min(activity.length - 1, Math.floor(end));
    if (hi < lo) return out;
    const span = hi - lo + 1;
    for (let c = 0; c < out.length; c++) {
        const a = lo + Math.floor((c * span) / out.length);
        const b = Math.min(hi + 1, Math.max(a + 1, lo + Math.floor(((c + 1) * span) / out.length)));
        let peak = 0;
        for (let i = a; i < b; i++) if (activity[i] > peak) peak = activity[i];
        out[c] = peak;
    }
    return out;
}
