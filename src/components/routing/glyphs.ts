// Canvas glyphs for the routing view. Each draws one medium's live state into a layout box;
// the state itself comes from src/show/routing/ (tested there), so these only paint.

import type { Box } from '../../show/routing/layout';
import { fontPx } from '../../show/routing/layout';
import { LED_COLOR } from '../../show/routing/live';
import type { LiveNeuron } from '../../show/routing/live';
import type { Swarm } from '../../show/routing/swarm';
import type { Vessel } from '../../show/routing/vessel';

export type G = CanvasRenderingContext2D;
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const TAU = Math.PI * 2;
export const LINE_H = 1.45; // a lines() row, in font heights

export function text(g: G, s: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left'): void {
    g.font = `${px}px ${MONO}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = 'top';
    g.fillText(s, x, y);
}

/** A word cut into pieces no wider than `w` (a file name in a narrow column), in the current font;
 *  whole when not even a character fits. */
function pieces(g: G, word: string, w: number): string[] {
    if (g.measureText(word).width <= w || g.measureText(word.slice(0, 1)).width > w) return [word];
    const out: string[] = [];
    let cur = '';
    for (const ch of word) {
        if (cur && g.measureText(cur + ch).width > w) {
            out.push(cur);
            cur = ch;
        } else {
            cur += ch;
        }
    }
    return [...out, cur];
}

/** The rows as lines() draws them: each wrapped at spaces to `w` in the font at `px`. */
function wrapped(g: G, rows: [string, string][], w: number, px: number): [string, string][] {
    g.font = `${px}px ${MONO}`;
    const out: [string, string][] = [];
    for (const [s, color] of rows) {
        const whole = s.replace(/^ +/, ''); // the wrap below drops leading spaces too
        if (g.measureText(whole).width <= w) { // most rows fit: one measure, not one per word
            out.push([whole, color]);
            continue;
        }
        let line = '';
        for (const word of s.split(' ').flatMap(word => pieces(g, word, w))) {
            const next = line ? `${line} ${word}` : word;
            if (line && g.measureText(next).width > w) {
                out.push([line, color]);
                line = word;
            } else {
                line = next;
            }
        }
        out.push([line, color]);
    }
    return out;
}

/** Rows of small text from the top of a box, each wrapped at spaces to the box width (the caller clips). */
export function lines(g: G, rows: [string, string][], b: Box, scale: number, base = 9): void {
    const px = fontPx(base, scale);
    let y = b.y;
    for (const [s, color] of wrapped(g, rows, b.w, px)) {
        text(g, s, b.x, y, px, color);
        y += px * LINE_H;
    }
}

/** The height lines() fills with these rows in a box `w` wide. */
export function linesHeight(g: G, rows: [string, string][], w: number, scale: number, base = 9): number {
    const px = fontPx(base, scale);
    return wrapped(g, rows, w, px).length * px * LINE_H;
}

/** lines(), clipped to `clip` (the text box unless given). */
export function clippedLines(g: G, rows: [string, string][], b: Box, scale: number, base = 9, clip: Box = b): void {
    g.save();
    clipTo(g, clip);
    lines(g, rows, b, scale, base);
    g.restore();
}

/** clippedLines() that never loses `last` (a LIVE/SIMULATED badge): when everything doesn't fit, the
 *  rows above give way, whole lines at a time, and `last` follows the ones that still fit. */
export function linesKeepLast(g: G, rows: [string, string][], last: [string, string][], b: Box, scale: number, base = 9): void {
    const all = [...rows, ...last];
    if (linesHeight(g, all, b.w, scale, base) <= b.h) {
        clippedLines(g, all, b, scale, base);
        return;
    }
    const lineH = fontPx(base, scale) * LINE_H, lastH = Math.min(b.h, linesHeight(g, last, b.w, scale, base));
    const rowsH = Math.floor((b.h - lastH) / lineH) * lineH;
    clippedLines(g, rows, { ...b, h: rowsH }, scale, base);
    clippedLines(g, last, { ...b, y: b.y + rowsH, h: lastH }, scale, base);
}

/** `s` cut to `maxW` with an ellipsis, in the font at `px` (which it sets). */
export function fit(g: G, s: string, maxW: number, px: number): string {
    g.font = `${px}px ${MONO}`;
    if (g.measureText(s).width <= maxW) return s;
    let out = s;
    while (out.length > 1 && g.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
    return out.length > 1 ? `${out}…` : '';
}

/** A tag's size around this label; sets the font. */
export function tagSize(g: G, s: string, px: number): { w: number; h: number } {
    g.font = `${px}px ${MONO}`;
    return { w: g.measureText(s).width + px * 0.8, h: px * 1.5 };
}

/** A small label on a black ground, so it reads on top of lines and frames. */
export function tag(g: G, s: string, x: number, y: number, px: number, color: string): Box {
    const { w, h } = tagSize(g, s, px);
    const b = { x: x - w / 2, y: y - h / 2, w, h };
    g.fillStyle = '#000';
    g.fillRect(b.x, b.y, b.w, b.h);
    text(g, s, x, y - px / 2, px, color, 'center');
    return b;
}

export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function frame(g: G, b: Box, color: string): void {
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w) - 1, Math.round(b.h) - 1);
}

export function arrowHead(g: G, x: number, y: number, angle: number, size: number, color: string): void {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - size * Math.cos(angle - 0.4), y - size * Math.sin(angle - 0.4));
    g.lineTo(x - size * Math.cos(angle + 0.4), y - size * Math.sin(angle + 0.4));
    g.fill();
}

export function clipTo(g: G, b: Box): void {
    g.beginPath();
    g.rect(b.x, b.y, b.w, b.h);
    g.clip();
}

/** The largest square centred in a box. */
export function fitSquare(b: Box): Box {
    const s = Math.min(b.w, b.h);
    return { x: b.x + (b.w - s) / 2, y: b.y + (b.h - s) / 2, w: s, h: s };
}

/** Neurons at their recorded positions, lit by `glow` (0..1). */
export function neuronMap(g: G, b: Box, neurons: LiveNeuron[], glow: Float32Array, scale: number, only?: 'backbone'): void {
    const sq = fitSquare(b);
    const dot = Math.max(1.5, 2 * scale);
    for (let i = 0; i < neurons.length; i++) {
        const n = neurons[i];
        if (only === 'backbone' && !n.backbone) continue;
        const px = sq.x + n.x * sq.w, py = sq.y + n.y * sq.h, e = glow[i];
        if (e > 0.06) {
            g.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * e})`;
            g.fillRect(px - dot * 0.75, py - dot * 0.75, dot * 1.5, dot * 1.5);
            g.strokeStyle = `rgba(255,255,255,${0.45 * e})`;
            g.lineWidth = 1;
            g.beginPath();
            g.arc(px, py, dot * 1.2 + (1 - e) * 9 * scale, 0, TAU);
            g.stroke();
        } else {
            g.fillStyle = n.backbone ? '#9a9a9a' : '#4a4a4a';
            g.fillRect(px - dot / 2, py - dot / 2, dot, dot);
        }
    }
}

export interface SwarmStyle {
    fade: number; // per frame at 60 fps
    dim: string; // agents whose neuron isn't firing
}

/** One frame of a swarm onto its own square canvas: trails fade, agents land; firing ones white. */
export function paintSwarm(canvas: HTMLCanvasElement, s: Swarm, firing: Float32Array, threshold: number, style: SwarmStyle, frames: number): void {
    const g = canvas.getContext('2d');
    if (!g) return;
    const size = canvas.width;
    g.fillStyle = `rgba(0,0,0,${1 - Math.pow(1 - style.fade, frames)})`;
    g.fillRect(0, 0, size, size);
    const dot = Math.max(1, size / 280);
    const n = s.nh.length;
    g.fillStyle = style.dim;
    for (let i = 0; i < s.count; i++) if (!(firing[i % n] >= threshold)) g.fillRect(s.x[i] * size, s.y[i] * size, dot, dot);
    // Firing agents in three brightness bands of their neuron's value (graded like EoC's trails).
    const bands: [number, number, string][] = [[threshold, 0.3, 'rgba(255,255,255,0.55)'], [0.3, 0.6, 'rgba(255,255,255,0.8)'], [0.6, Infinity, '#fff']];
    for (const [lo, hi, color] of bands) {
        g.fillStyle = color;
        for (let i = 0; i < s.count; i++) {
            const v = firing[i % n];
            if (v >= lo && v < hi) g.fillRect(s.x[i] * size - dot * 0.4, s.y[i] * size - dot * 0.4, dot * 1.8, dot * 1.8);
        }
    }
}

export function swarmPanel(g: G, b: Box, canvas: HTMLCanvasElement): void {
    const sq = fitSquare(b);
    g.drawImage(canvas, sq.x, sq.y, sq.w, sq.h);
    frame(g, sq, '#262626');
}

/** The population rate over the last ~6 s, square-root scaled against the recording's peak. */
export function rateLine(g: G, b: Box, history: Float32Array, head: number, peak: number): void {
    g.strokeStyle = '#bdbdbd';
    g.lineWidth = 1;
    g.beginPath();
    const n = history.length;
    for (let i = 0; i < n; i++) {
        const v = history[(head + i) % n];
        const x = b.x + (i / (n - 1)) * b.w, y = b.y + b.h - Math.sqrt(Math.min(1, v / peak)) * b.h;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
}

/** The 27 strikers, in rows of 9 (or columns of 9 in a tall box), flashing per strike. */
export function strikers(g: G, b: Box, glow: Float32Array): void {
    const tall = b.h > b.w * 1.2;
    const cols = tall ? 3 : 9, rows = Math.ceil(glow.length / cols);
    const cw = b.w / cols, rh = b.h / rows, r = Math.max(2, Math.min(cw, rh) * 0.32);
    for (let k = 0; k < glow.length; k++) {
        const cx = b.x + ((k % cols) + 0.5) * cw, cy = b.y + (Math.floor(k / cols) + 0.5) * rh, e = glow[k];
        g.strokeStyle = e > 0.05 ? `rgba(255,255,255,${0.4 + 0.6 * e})` : '#444';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, cy, r, 0, TAU);
        g.stroke();
        if (e > 0.05) {
            g.fillStyle = `rgba(255,255,255,${e})`;
            g.beginPath();
            g.arc(cx, cy, r * 0.6 * e, 0, TAU);
            g.fill();
        }
    }
}

// DualLED_Currents.ino's palette.
const LED_RGB: Record<number, string> = {
    [LED_COLOR.cyan]: '50,255,255', [LED_COLOR.red]: '255,50,50', [LED_COLOR.purple]: '255,50,255', [LED_COLOR.blue]: '50,50,255',
};

/** A 16 × 16 matrix as the sketch lights it: a white baseline (dimmer while frames arrive,
 *  brighter when idle), each pixel's color blended over it by its remaining life. */
export function ledGrid(g: G, b: Box, cells: Float32Array, colors: Uint8Array, idle: boolean): void {
    const sq = fitSquare(b);
    const c = sq.w / 16;
    g.fillStyle = '#050505';
    g.fillRect(sq.x, sq.y, sq.w, sq.h);
    g.fillStyle = idle ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 256; i++) g.fillRect(sq.x + (i % 16) * c + c * 0.15, sq.y + Math.floor(i / 16) * c + c * 0.15, c * 0.7, c * 0.7);
    for (let i = 0; i < 256; i++) {
        const v = cells[i];
        if (v < 0.03 || !LED_RGB[colors[i]]) continue;
        g.fillStyle = `rgba(${LED_RGB[colors[i]]},${Math.min(1, v)})`;
        g.fillRect(sq.x + (i % 16) * c + c * 0.1, sq.y + Math.floor(i / 16) * c + c * 0.1, c * 0.8, c * 0.8);
    }
    frame(g, sq, '#262626');
}

/** The current layer's real contour from above, over the ones grown before it. */
export function vesselTop(g: G, b: Box, v: Vessel, layer: number, depth: number): void {
    const sq = fitSquare(b);
    const sc = (sq.w / 2 / v.maxRadius) * 0.95, cx = sq.x + sq.w / 2, cy = sq.y + sq.h / 2;
    for (let d = depth; d >= 0; d--) {
        const j = layer - d;
        if (j < 0) continue;
        const p = v.layers[j].pts;
        g.strokeStyle = d === 0 ? '#fff' : `rgba(255,255,255,${0.03 + 0.22 * (1 - d / depth)})`;
        g.lineWidth = d === 0 ? 1.5 : 1;
        g.beginPath();
        for (let i = 0; i < p.length; i += 2) {
            const x = cx + p[i] * sc, y = cy + p[i + 1] * sc;
            if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.closePath();
        g.stroke();
    }
}
