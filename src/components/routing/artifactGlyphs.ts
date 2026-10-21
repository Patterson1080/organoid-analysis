// FAB as the two artifacts were made: stacks of print layers turning slowly, the termite form's PLA
// slices and the clay vessel's G-code spiral, drawn into offscreen canvases a few times a second;
// and the installation as the parent spec describes it, as a schematic.

import type { Box } from '../../show/routing/layout';
import { fontPx } from '../../show/routing/layout';
import { depthAlpha, sliceStride, termiteStack, vesselStack } from '../../show/routing/sliceView';
import type { StackSlice } from '../../show/routing/sliceView';
import type { TermiteSlices } from '../../show/routing/termiteSlices';
import type { Vessel } from '../../show/routing/vessel';
import { frame, lines, text } from './glyphs';
import type { G } from './glyphs';

export const TURN_MS = 48_000;
const ELEV = (14 * Math.PI) / 180;
const RENDER_MS = 100; // at most ten renders a second; the turn moves 0.75° between them
export const TERMITE_RGB = '214,208,255';
export const CLAY_RGB = '222,178,140';

/** How a stack sits: its footprint radius around (cx, cz) and its height range. */
export interface StackFrame {
    cx: number;
    cz: number;
    r: number;
    yMin: number;
    yMax: number;
}

export interface StackStyle {
    yaw: number;
    rgb: string;
    lineWidth: number;
    currentIndex?: number; // drawn white
    faintFrom?: number; // later layers, not grown yet at this index
    dottedFrom?: number; // above where the print stopped
}

const stacks = new WeakMap<object, Map<number, StackSlice[]>>();

/** A stack built once per object (and explode distance). */
function memo(key: object, explode: number, build: () => StackSlice[]): StackSlice[] {
    let byExplode = stacks.get(key);
    if (!byExplode) stacks.set(key, (byExplode = new Map()));
    let s = byExplode.get(explode);
    if (!s) byExplode.set(explode, (s = build()));
    return s;
}

export const termiteLayers = (t: TermiteSlices, explode: number) => memo(t, explode, () => termiteStack(t, explode));
export const vesselLayers = (v: Vessel) => memo(v, 0, () => vesselStack(v));

export function termiteFrame(t: TermiteSlices, explode: number): StackFrame {
    const b = t.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const r = Math.max(b.maxX - cx, b.maxZ - cz);
    return { cx, cz, r, yMin: b.minY, yMax: b.maxY + Math.max(0, t.segments.length - 1) * explode };
}

export const vesselFrame = (v: Vessel): StackFrame => ({ cx: 0, cz: 0, r: v.maxRadius, yMin: 0, yMax: (v.layers.length + 1) * v.layerMm });

/** One stroke per polyline, turned and raised, brighter in front; fitted and centred in the box.
 *  Returns where a height on the axis lands on screen, for labels. */
export function drawStack(g: G, b: Box, stack: StackSlice[], f: StackFrame, st: StackStyle): (y: number) => number {
    const cosE = Math.cos(ELEV), sinE = Math.sin(ELEV), c = Math.cos(st.yaw), sn = Math.sin(st.yaw);
    const r = f.r || 1, tall = (f.yMax - f.yMin) * cosE + 2 * r * sinE;
    const k = Math.min(b.w / (2 * r), b.h / (tall || 1));
    const cx = b.x + b.w / 2, bottom = b.y + b.h - (b.h - tall * k) / 2, low = f.yMin * cosE - r * sinE;
    const stride = sliceStride(stack.length, tall * k);
    g.lineJoin = 'round';
    for (let i = 0; i < stack.length; i++) {
        const current = i === st.currentIndex;
        if (i % stride !== 0 && !current) continue;
        const slice = stack[i], faint = st.faintFrom !== undefined && i >= st.faintFrom;
        g.setLineDash(st.dottedFrom !== undefined && i >= st.dottedFrom && !current ? [1.5, 3] : []);
        g.lineWidth = current ? st.lineWidth * 2 : st.lineWidth;
        for (const line of slice.lines) {
            const n = line.length / 2;
            let depth = 0;
            g.beginPath();
            for (let p = 0; p < n; p++) {
                const x = line[p * 2] - f.cx, z = line[p * 2 + 1] - f.cz;
                const rx = x * c - z * sn, rz = x * sn + z * c;
                depth += rz;
                const X = cx + rx * k, Y = bottom - (slice.y * cosE - rz * sinE - low) * k;
                if (p) g.lineTo(X, Y);
                else g.moveTo(X, Y);
            }
            const a = depthAlpha(depth / Math.max(1, n), r) * (faint ? 0.16 : 0.8);
            g.strokeStyle = current ? '#fff' : `rgba(${st.rgb},${a.toFixed(3)})`;
            g.stroke();
        }
    }
    g.setLineDash([]);
    return y => bottom - (y * cosE - low) * k;
}

export interface ArtifactCache {
    entries: Map<string, { canvas: HTMLCanvasElement; at: number; sig: string }>;
}
export const createArtifactCache = (): ArtifactCache => ({ entries: new Map() });

/** Render into this key's offscreen canvas when it's 100 ms old or its signature changed, then blit. */
export function cachedDraw(g: G, cache: ArtifactCache, key: string, b: Box, now: number, sig: string, render: (cg: G, local: Box) => void): void {
    if (b.w < 2 || b.h < 2) return;
    const dpr = g.getTransform().a || 1, w = Math.ceil(b.w * dpr), h = Math.ceil(b.h * dpr);
    let e = cache.entries.get(key);
    if (!e) cache.entries.set(key, (e = { canvas: document.createElement('canvas'), at: -Infinity, sig: '' }));
    if (now - e.at >= RENDER_MS || e.sig !== sig || e.canvas.width !== w || e.canvas.height !== h) {
        if (e.canvas.width !== w || e.canvas.height !== h) {
            e.canvas.width = w;
            e.canvas.height = h;
        }
        const cg = e.canvas.getContext('2d');
        if (!cg) return;
        cg.setTransform(dpr, 0, 0, dpr, 0, 0);
        cg.clearRect(0, 0, b.w, b.h);
        render(cg, { x: 0, y: 0, w: b.w, h: b.h });
        e.at = now;
        e.sig = sig;
    }
    g.drawImage(e.canvas, b.x, b.y, b.w, b.h);
}

/** One slice seen from above, fitted to the box. */
export function planView(g: G, b: Box, slice: StackSlice, f: StackFrame, rgb: string): void {
    frame(g, b, '#2a2a2a');
    const k = Math.min(b.w, b.h) / (2 * (f.r || 1)) * 0.92, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    g.strokeStyle = `rgb(${rgb})`;
    g.lineWidth = 1;
    for (const line of slice.lines) {
        g.beginPath();
        for (let p = 0; p < line.length; p += 2) {
            const X = cx + (line[p] - f.cx) * k, Y = cy + (line[p + 1] - f.cz) * k;
            if (p) g.lineTo(X, Y);
            else g.moveTo(X, Y);
        }
        g.stroke();
    }
}

/** The installation as the parent spec states it, nothing more: the laser-cut frame holding the vessel,
 *  the termite form and the two LED matrices, fibres carrying the matrices' light into the glassware. */
export function schematic(g: G, b: Box, ledShare: number, s: number): void {
    if (b.w < 40 || b.h < 40) return;
    const px = fontPx(8, s);
    const f: Box = { x: b.x + b.w * 0.12, y: b.y + px * 1.8, w: b.w * 0.76, h: b.h - px * 4.2 };
    frame(g, f, '#777');
    text(g, 'laser-cut frame', f.x, b.y, px, '#999');
    // the two matrices along the top bar
    const m = Math.min(f.w * 0.16, f.h * 0.12), my = f.y + 4 * s, mx = [f.x + f.w * 0.3 - m / 2, f.x + f.w * 0.7 - m / 2];
    for (const x of mx) {
        g.fillStyle = `rgba(0,255,255,${0.15 + 0.6 * ledShare})`;
        g.fillRect(x, my, m, m);
        frame(g, { x, y: my, w: m, h: m }, '#aaa');
    }
    text(g, 'LED', f.x + f.w / 2, my + (m - px) / 2, px, '#999', 'center');
    // fibres down to three flasks with plants
    const flaskY = f.y + f.h * 0.42, flaskW = f.w * 0.14, flaskH = f.h * 0.16;
    const flasks = [0.2, 0.5, 0.8].map(t => f.x + f.w * t);
    g.strokeStyle = `rgba(0,255,255,${0.2 + 0.7 * ledShare})`;
    g.lineWidth = 1;
    flasks.forEach((fx, i) => {
        for (const from of mx) {
            g.beginPath();
            g.moveTo(from + m / 2, my + m);
            g.bezierCurveTo(from + m / 2, flaskY - f.h * 0.15, fx, flaskY - f.h * 0.2 + i * 2, fx, flaskY);
            g.stroke();
        }
    });
    g.strokeStyle = '#999';
    for (const fx of flasks) {
        g.beginPath(); // a flask: neck, then the cone
        g.moveTo(fx - flaskW * 0.12, flaskY);
        g.lineTo(fx - flaskW * 0.12, flaskY + flaskH * 0.35);
        g.lineTo(fx - flaskW / 2, flaskY + flaskH);
        g.lineTo(fx + flaskW / 2, flaskY + flaskH);
        g.lineTo(fx + flaskW * 0.12, flaskY + flaskH * 0.35);
        g.lineTo(fx + flaskW * 0.12, flaskY);
        g.stroke();
        g.strokeStyle = '#6a8';
        g.beginPath(); // a sprig
        g.moveTo(fx, flaskY + flaskH * 0.9);
        g.quadraticCurveTo(fx - flaskW * 0.3, flaskY + flaskH * 0.5, fx - flaskW * 0.1, flaskY + flaskH * 0.2);
        g.stroke();
        g.strokeStyle = '#999';
    }
    // the two artifacts on the floor of the frame
    const floor = f.y + f.h - px * 1.7, art = f.h * 0.28;
    const vx = f.x + f.w * 0.3, tx = f.x + f.w * 0.68;
    g.strokeStyle = `rgb(${CLAY_RGB})`;
    g.beginPath(); // the vessel: wider at the top
    g.moveTo(vx - art * 0.22, floor);
    g.lineTo(vx - art * 0.34, floor - art * 0.75);
    g.moveTo(vx + art * 0.22, floor);
    g.lineTo(vx + art * 0.34, floor - art * 0.75);
    g.moveTo(vx - art * 0.22, floor);
    g.lineTo(vx + art * 0.22, floor);
    g.stroke();
    g.strokeStyle = `rgb(${TERMITE_RGB})`;
    g.beginPath(); // the termite form: a tall column of four parts
    for (let k = 0; k < 4; k++) {
        const y0 = floor - (art * k) / 4, y1 = floor - (art * (k + 1)) / 4 + 1;
        g.rect(tx - art * 0.13, y1, art * 0.26, y0 - y1 - 1);
    }
    g.stroke();
    text(g, 'vessel', vx, floor + 2 * s, px, '#999', 'center');
    text(g, 'termite form', tx, floor + 2 * s, px, '#999', 'center');
    lines(g, [['schematic · not to scale · fibres glow with the lit LED pixels', '#666']], { x: b.x, y: b.y + b.h - px * 1.5, w: b.w, h: px * 1.5 }, s, 8);
}
