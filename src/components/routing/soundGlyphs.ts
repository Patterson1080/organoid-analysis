// SOUND as the patch has it: the activity Max reads over the whole pass with its burst flags, the
// chord its counter is on, the voices it plays (drawn like Max draws them), the rules that pace
// them, and where each sound lands among the speakers.

import { ARM_RULES } from '../../show/routing/arms';
import { pad6 } from '../../show/routing/captions';
import { SOUND_FACTS } from '../../show/routing/facts';
import type { Box } from '../../show/routing/layout';
import { fontPx, row } from '../../show/routing/layout';
import type { Rate, SoundView } from '../../show/routing/live';
import { NOTE_NAMES, PATCH, chordAt, grainSpeed, grainTickMs, kickMs, toneMs } from '../../show/routing/maxPatch';
import type { PatchData } from '../../show/routing/maxPatch';
import { droneLevel, eventsSince } from '../../show/routing/soundEvents';
import { activityEnvelope, soundCaptions } from '../../show/routing/soundLayout';
import { LINE_H, clippedLines, frame, text } from './glyphs';
import type { G } from './glyphs';

const SCORE_WINDOW_MS = 10_000;
const GLOW_MS = 1500;
const GRAIN_GLOW_MS = 400; // grains come by the dozen a second: a brief, dim flicker each
const KICK_DECAY_MS = 6000; // termiteKick: 5 ms attack, 6 s decay
const POSITIONS_PER_PAIR = 8;

type Range = { start: number; end: number };

const envelopes = new WeakMap<PatchData, Map<string, Float32Array>>();

/** The activity envelope for this width and range, computed once. */
function envelope(p: PatchData, columns: number, range: Range): Float32Array {
    let byKey = envelopes.get(p);
    if (!byKey) envelopes.set(p, (byKey = new Map()));
    const key = `${columns}:${range.start}:${range.end}`;
    let e = byKey.get(key);
    if (!e) {
        if (byKey.size > 16) byKey.clear();
        e = activityEnvelope(p.activity, columns, range.start, range.end);
        byKey.set(key, e);
    }
    return e;
}

const noteNames = (notes: readonly number[]) =>
    [...new Set(notes.map(n => n % 12))].sort((a, b) => a - b).map(pc => NOTE_NAMES[pc]).join(' ');

/** Events a second as printed: Max's own figure when it reports one, tagged LIVE. */
export const rateText = (r: Rate, digits = 2) => `${r.perSec.toFixed(digits)}/s${r.live ? ' · LIVE' : ''}`;

/** The pass's activity as Max reads it, the burst flags that step the chord, the index Max last heard. */
export function activityStrip(g: G, b: Box, p: PatchData, range: Range, heard: number | null, s: number): void {
    frame(g, b, '#222');
    const cols = Math.max(1, Math.floor(b.w)), env = envelope(p, cols, range), cw = b.w / cols;
    g.fillStyle = 'rgba(255,255,255,0.3)';
    for (let c = 0; c < env.length; c++) {
        const h = Math.min(1, env[c]) * (b.h - 2);
        if (h > 0.4) g.fillRect(b.x + c * cw, b.y + b.h - 1 - h, Math.max(1, cw), h);
    }
    const span = Math.max(1, range.end - range.start), xAt = (i: number) => b.x + ((i - range.start) / span) * b.w;
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const f of p.flags) if (f >= range.start && f <= range.end) g.fillRect(Math.round(xAt(f)), b.y, 1, Math.max(2, b.h * 0.3));
    if (heard !== null && heard >= range.start && heard <= range.end) {
        g.fillStyle = '#fff';
        g.fillRect(xAt(heard), b.y, Math.max(1, s), b.h);
    }
}

/** The counter's 17 steps, the current one lit; step 0 holds K. */
export function chordStrip(g: G, b: Box, step: number | null, s: number): void {
    const n = PATCH.chords.length, w = b.w / n, lit = step === null ? -1 : step === 0 ? n : step;
    const px = fontPx(9, s), letters = w >= px * 0.9 && b.h >= px;
    for (let k = 1; k <= n; k++) {
        const c: Box = { x: b.x + (k - 1) * w, y: b.y, w: Math.max(1, w - Math.min(2, w * 0.12)), h: b.h };
        if (k === lit) {
            g.fillStyle = step === 0 ? 'rgba(255,255,255,0.55)' : '#fff';
            g.fillRect(c.x, c.y, c.w, c.h);
        } else {
            frame(g, c, '#2a2a2a');
        }
        if (letters) text(g, PATCH.chords[k - 1], c.x + c.w / 2, c.y + (c.h - px) / 2, px, k === lit ? '#000' : '#777', 'center');
    }
}

/** The chord letter, large, with its notes. */
export function chordName(g: G, b: Box, sv: SoundView, s: number): void {
    const c = chordAt(sv.chordStep);
    const big = Math.max(fontPx(9, s), Math.min(fontPx(30, s), b.h * 0.5)), small = fontPx(8, s);
    text(g, c ? c.name : '?', b.x + b.w / 2, b.y, big, c ? '#fff' : '#555', 'center');
    clippedLines(g, [[c ? noteNames(c.notes) : 'chord unknown here', c ? '#bbb' : '#666']], { ...b, y: b.y + big * 1.1, h: b.h }, s, 8, { ...b, y: b.y + big * 1.05, h: b.h - big * 1.05 });
    if (sv.chordSource !== 'unknown') text(g, sv.chordSource === 'live' ? 'LIVE' : '≈', b.x + b.w, b.y, small, sv.chordSource === 'live' ? '#fff' : '#777', 'right');
}

function dot(g: G, x: number, y: number, r: number, alpha: number, hollow: boolean) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    if (hollow) {
        g.strokeStyle = `rgba(255,255,255,${0.5 * alpha})`;
        g.lineWidth = 1;
        g.stroke();
    } else {
        g.fillStyle = `rgba(255,255,255,${alpha})`;
        g.fill();
    }
}

/** The last ten seconds as Max plays them: grains above, the twelve pitch classes (the chord's
 *  rows lit) with tones, arpeggio notes and drones, the kick below. */
export function score(g: G, b: Box, sv: SoundView, now: number, s: number): void {
    frame(g, b, '#1e1e1e');
    const px = fontPx(8, s), labelW = 44 * s;
    const lane: Box = { x: b.x + labelW, y: b.y + 4 * s, w: Math.max(1, b.w - labelW - 6 * s), h: Math.max(1, b.h - 8 * s) };
    const grainBand: Box = { ...lane, h: lane.h * 0.16 };
    const staff: Box = { ...lane, y: lane.y + lane.h * 0.19, h: lane.h * 0.62 };
    const kickBand: Box = { ...lane, y: lane.y + lane.h * 0.84, h: lane.h * 0.16 };
    const rowH = staff.h / 12, rowY = (pc: number) => staff.y + staff.h - (pc + 0.5) * rowH, mid = staff.y + staff.h / 2;
    const xAt = (t: number) => lane.x + lane.w * (1 - (now - t) / SCORE_WINDOW_MS);
    const chord = chordAt(sv.chordStep);
    const inChord = new Set(chord ? chord.notes.map(n => n % 12) : []);

    const rowPx = Math.max(7, Math.min(px, rowH * 0.95));
    for (let pc = 0; pc < 12; pc++) {
        const y = rowY(pc), on = inChord.has(pc);
        if (on) {
            g.fillStyle = 'rgba(255,255,255,0.07)';
            g.fillRect(lane.x, y - rowH / 2, lane.w, rowH);
        }
        const stagger = pc % 2 ? 0 : 18 * s; // neighbouring rows alternate columns
        if (on || rowH >= px) text(g, NOTE_NAMES[pc], lane.x - 4 * s - stagger, y - rowPx / 2, rowPx, on ? '#ccc' : '#444', 'right');
    }
    text(g, 'grains', b.x + 4 * s, grainBand.y, px, '#777');
    text(g, 'kick', b.x + 4 * s, kickBand.y + kickBand.h - px * 2.2, px, '#777');
    text(g, 'C1/D♭1', b.x + 4 * s, kickBand.y + kickBand.h - px, px, '#555');

    for (const v of sv.sim.drones) {
        const level = sv.playing ? droneLevel(v, now) : 0; // the room is silent while /index is still
        if (v.pc < 0 || level < 0.01) continue;
        g.fillStyle = `rgba(255,255,255,${0.06 + 0.3 * level})`;
        const h = Math.max(1, rowH * 0.5 * level);
        g.fillRect(lane.x, rowY(v.pc) - h / 2, lane.w, h);
    }

    for (const e of eventsSince(sv.sim, now - SCORE_WINDOW_MS)) {
        const x = xAt(e.at), fade = 1 - 0.75 * Math.min(1, (now - e.at) / SCORE_WINDOW_MS);
        if (e.kind === 'tone') dot(g, x, e.pc < 0 ? mid : rowY(e.pc), 2.6 * s, fade, e.pc < 0);
        else if (e.kind === 'arp') dot(g, x, e.pc < 0 ? mid : rowY(e.pc), 1.6 * s, fade * (0.35 + 0.2 * (e.octave - 2)), e.pc < 0);
        else if (e.kind === 'grain') {
            g.fillStyle = `rgba(255,255,255,${0.55 * fade})`;
            g.fillRect(x, grainBand.y + grainBand.h * (1 - Math.log2(e.speed) / 6) - s, 1.5 * s, 1.5 * s);
        } else if (e.position !== 0) { // a gated kick makes no sound
            const ring = Math.max(0, 1 - (now - e.at) / KICK_DECAY_MS), h = kickBand.h * (e.echo === 0 ? 1 : 0.6);
            g.fillStyle = `rgba(255,255,255,${0.15 + 0.7 * ring})`;
            g.fillRect(x - s, kickBand.y + kickBand.h - h, 2 * s, h);
        }
    }
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(lane.x + lane.w - 1, lane.y, 1, lane.h);
}

/** An interval table against its driver (0..1 across), log time up the side, the current value marked. */
function stepChart(g: G, b: Box, fn: (x: number) => number | null, x: number, [lo, hi]: [number, number], s: number): void {
    frame(g, b, '#1e1e1e');
    const y = (ms: number) => b.y + b.h - 2 - ((Math.log(ms) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (b.h - 4);
    g.strokeStyle = '#777';
    g.lineWidth = 1;
    g.beginPath();
    let pen = false;
    for (let px = 0; px <= b.w; px++) {
        const v = fn(px / b.w);
        if (v === null) {
            pen = false;
            continue;
        }
        if (pen) g.lineTo(b.x + px, y(v));
        else g.moveTo(b.x + px, y(v));
        pen = true;
    }
    g.stroke();
    const cx = b.x + Math.min(1, Math.max(0, x)) * b.w, v = fn(Math.min(1, Math.max(0, x)));
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(cx, b.y, 1, b.h);
    if (v !== null) dot(g, cx, y(v), 3 * s, 1, false);
}

/** The three tables that pace the voices, each with where Max is on it now. */
export function rules(g: G, b: Box, sv: SoundView, s: number): void {
    const px = fontPx(8, s), capH = px * LINE_H * 3, foot = px * LINE_H * 2 + px * 0.3, gap = 10 * s;
    const ms = (v: number | null) => (v === null ? '—' : `${v} ms`);
    const charts: [(x: number) => number | null, number, [number, number], [string, string][]][] = [
        [x => toneMs(x * x), Math.sqrt(sv.a), [PATCH.toneMs[0], PATCH.toneMs[11]], [
            ['TONES · √a → 12 steps', '#ddd'],
            [`${ms(sv.toneMs)}${sv.held.tone ? ' (held)' : ''} · ${rateText(sv.rates.tones)}`, '#aaa'],
            ['a note of the chord', '#666'],
        ]],
        [x => grainTickMs(x ** 8), sv.a ** (1 / 8), [PATCH.grainMs[0], PATCH.grainMs[5]], [
            ['GRAINS · a^⅛ → tick', '#ddd'],
            [`${ms(sv.grainTickMs)} · ${Math.round(sv.grainChance * 100)} % · ${rateText(sv.rates.grains, 0)}`, '#aaa'],
            [sv.grainLen ? `${sv.grainLen[0]}|${sv.grainLen[1]} ms, ×${grainSpeed(sv.grainLen[0])}|×${grainSpeed(sv.grainLen[1])}` : '—', '#666'],
        ]],
        [x => kickMs(x), sv.a, [PATCH.kickMs[0], PATCH.kickMs[5]], [
            ['KICK · a → 6 steps', '#ddd'],
            [`${ms(sv.kickMs)}${sv.held.kick ? ' (held)' : ''} · ${rateText(sv.rates.kick)}`, '#aaa'],
            ['half gated silent', '#666'],
        ]],
    ];
    const cells = row({ ...b, h: b.h - foot }, charts.length, gap);
    charts.forEach(([fn, x, range, caption], i) => {
        const cell = cells[i];
        stepChart(g, { ...cell, h: Math.max(8, cell.h - capH - 4 * s) }, fn, x, range, s);
        clippedLines(g, caption, { ...cell, y: cell.y + cell.h - capH, h: capH }, s, 8);
    });
    clippedLines(g, [['grain chance ×(1 − LFO): a 125 s swell of unknown phase, drawn at its midpoint', '#555']], { ...b, y: b.y + b.h - foot + px * 0.3, h: foot }, s, 8, { ...b, y: b.y + b.h - foot, h: foot });
}


/** The counter, the chord it's on, and the flags that move it. */
export function harmony(g: G, b: Box, sv: SoundView, index: number | null, mode: 'show' | 'local', fps: number | null, s: number): void {
    const px = fontPx(9, s);
    text(g, 'HARMONY · counter 17', b.x, b.y, px, '#ddd');
    const strip: Box = { x: b.x, y: b.y + px * 1.8, w: b.w, h: Math.min(b.h * 0.3, px * 3) };
    chordStrip(g, strip, sv.chordStep, s);
    const c = chordAt(sv.chordStep);
    const ahead = sv.nextFlag !== null && index !== null && fps ? (sv.nextFlag - index) / fps : null;
    const where = mode === 'show'
        ? `flag ${sv.flagsSoFar} / ${sv.passFlags} this pass${sv.nextFlag !== null ? ` · next ${pad6(sv.nextFlag)}${ahead !== null && ahead >= 0 ? ` in ≈ ${Math.round(ahead)} s` : ''}` : ''}`
        : `${sv.passFlags} flags a pass`;
    const source: [string, string] = sv.chordSource === 'live' ? ['LIVE · the counter from Max', '#fff']
        : sv.chordSource === 'computed' ? ['≈ · counted from pass 1, if Max loaded before it', '#888']
        : ['the chord steps on the burst flags Max receives; local playback skips most indices', '#888'];
    const below: Box = { x: b.x, y: strip.y + strip.h + px * 0.8, w: b.w, h: b.y + b.h - (strip.y + strip.h + px * 0.8) };
    clippedLines(g, [
        [c ? `chord ${c.name}${c.held ? ' (held)' : ''} · ${noteNames(c.notes)}` : 'chord unknown here', c ? '#fff' : '#777'],
        ['one step per burst flag', '#888'],
        [where, '#aaa'],
        source,
        ['C minor, Phrygian inflections · distorted guitar, a sample per note', '#666'],
    ], below, s);
}

/** Where each sound lands: 16 positions over speakers 3–4 and 5–6, kicks at a pair's centre, the
 *  arpeggio on 1–2. */
export function speakers(g: G, b: Box, sv: SoundView, now: number, s: number): void {
    const px = fontPx(8, s);
    const glow = new Float32Array(19);
    let arpGlow = 0, unrouted = 0;
    for (const e of eventsSince(sv.sim, now - SCORE_WINDOW_MS)) {
        if (e.position === 0) unrouted++;
        const k = e.kind === 'grain' ? 0.45 * (1 - (now - e.at) / GRAIN_GLOW_MS) : 1 - (now - e.at) / GLOW_MS;
        if (k <= 0) continue;
        if (e.kind === 'arp') arpGlow = Math.max(arpGlow, k);
        else if (e.position > 0) glow[e.position] = Math.max(glow[e.position], k);
    }
    if (sv.playing) for (const v of sv.sim.drones) if (v.position > 0) glow[v.position] = Math.max(glow[v.position], droneLevel(v, now) * 0.35);

    text(g, 'OUTPUT · 16 positions → speakers 3–6', b.x, b.y, fontPx(9, s), '#ddd');
    const top = b.y + px * 2.2, rowH = Math.min((b.h - px * 6) / 3, 34 * s), spk = Math.min(rowH, 22 * s);
    const pairs: [string, string, number, number | null][] = [['3', '4', 1, 17], ['5', '6', 9, null]]; // out18 never gets a kick
    pairs.forEach(([l, r, first, kickPos], k) => {
        const y = top + k * (rowH + 6 * s), inner: Box = { x: b.x + spk + 6 * s, y, w: b.w - 2 * (spk + 6 * s), h: rowH };
        for (const [label, x] of [[l, b.x], [r, b.x + b.w - spk]] as [string, number][]) {
            frame(g, { x, y: y + (rowH - spk) / 2, w: spk, h: spk }, '#888');
            text(g, label, x + spk / 2, y + (rowH - px) / 2, px, '#ccc', 'center');
        }
        const cw = inner.w / POSITIONS_PER_PAIR;
        for (let p = 0; p < POSITIONS_PER_PAIR; p++) {
            const c: Box = { x: inner.x + p * cw + 1, y: inner.y, w: cw - 2, h: inner.h };
            const a = glow[first + p];
            if (a > 0) {
                g.fillStyle = `rgba(255,255,255,${0.85 * a})`;
                g.fillRect(c.x, c.y, c.w, c.h);
            }
            frame(g, c, '#2a2a2a');
        }
        if (kickPos === null) return;
        const kick = glow[kickPos], cx = inner.x + inner.w / 2;
        g.strokeStyle = `rgba(255,255,255,${0.25 + 0.75 * kick})`;
        g.lineWidth = Math.max(1, 2 * s * (0.5 + kick));
        g.beginPath();
        g.arc(cx, y + rowH / 2, Math.max(2, rowH * 0.32), 0, Math.PI * 2);
        g.stroke();
    });
    const y3 = top + 2 * (rowH + 6 * s);
    frame(g, { x: b.x, y: y3, w: spk * 2 + 4 * s, h: rowH }, arpGlow > 0 ? '#fff' : '#555');
    if (arpGlow > 0) {
        g.fillStyle = `rgba(255,255,255,${0.7 * arpGlow})`;
        g.fillRect(b.x + 1, y3 + 1, spk * 2 + 4 * s - 2, rowH - 2);
    }
    text(g, '1–2', b.x + spk + 2 * s, y3 + (rowH - px) / 2, px, arpGlow > 0.5 ? '#000' : '#ccc', 'center');
    const tag = sv.arm1.live ? 'LIVE' : 'SIMULATED', color = sv.arm1.live ? '#fff' : '#aaa';
    const arpText: [string, string][] = [
        [`arpeggio · arm 1 at ${Math.round(sv.arm1.cm)} cm${sv.arm1.cm >= ARM_RULES.rangeCm ? ' (nobody)' : ''}`, color],
        [`${sv.arpMs === null ? 'stopped' : `a note every ${Math.round(sv.arpMs)} ms`} · ${tag}`, color],
    ];
    const after: Box = { x: b.x + spk * 2 + 12 * s, y: y3 + (rowH - px * LINE_H * 2) / 2, w: b.w - spk * 2 - 12 * s, h: rowH };
    clippedLines(g, arpText, after, s, 8);
    const foot: Box = { x: b.x, y: y3 + rowH + px * 0.8, w: b.w, h: b.y + b.h - (y3 + rowH + px * 0.8) };
    clippedLines(g, [
        [soundCaptions(true).output, '#777'],
        [`${unrouted} unrouted in 10 s (gate 0)`, '#777'],
        ['arm 1: a note every 15 + 1000·(d/100)² ms, up the chord, C3–C5', '#666'],
        [`patch ${SOUND_FACTS.patchFile}`, '#555'],
        [`arm 1 ${SOUND_FACTS.serialFile}`, '#555'],
    ], foot, s, 8);
}
