// The routing overview: the organoid in the centre, the media the bridge feeds on one side,
// the audio computer's group on the other, and the spokes between them.

import { formatClock } from '../../show/showMath';
import { firingCaption, pad6 } from '../../show/routing/captions';
import { ATTRIBUTION, CARD_TITLES, LED_FACTS, ROBOT_FACTS, SOUND_FACTS, VESSEL_FACTS, VISUAL_FACTS } from '../../show/routing/facts';
import type { MediumKey, VisualOutput } from '../../show/routing/facts';
import type { Box, RoutingLayout } from '../../show/routing/layout';
import { fontPx } from '../../show/routing/layout';
import type { LiveState } from '../../show/routing/live';
import type { PatchData } from '../../show/routing/maxPatch';
import type { TermiteSlices } from '../../show/routing/termiteSlices';
import { printedLayers } from '../../show/routing/vessel';
import type { Vessel } from '../../show/routing/vessel';
import { MONO, arrowHead, clipTo, frame, hangingArms, ledGrid, lines, neuronMap, overlaps, rateLine, strikers, swarmPanel, tag, text } from './glyphs';
import type { G } from './glyphs';
import { activityStrip, chordName, chordStrip, rateText } from './soundGlyphs';
import { CLAY_RGB, TERMITE_RGB, TURN_MS, cachedDraw, drawStack, termiteFrame, termiteLayers, vesselFrame, vesselLayers } from './artifactGlyphs';
import type { ArtifactCache } from './artifactGlyphs';

export type SwarmKey = 'physarum' | 'boids' | 'termites';

export interface DrawInput {
    live: LiveState;
    swarms: Record<SwarmKey, HTMLCanvasElement>;
    vessel: Vessel | null;
    vesselLayer: number;
    patch: PatchData | null;
    range: { start: number; end: number }; // the indices a pass covers
    termite: TermiteSlices | null;
    artifacts: ArtifactCache;
    index: number | null;
    mode: 'show' | 'local';
    phase: 'on' | 'off' | 'stopped';
    offRemainingMs: number;
    dim: number;
    hover: MediumKey | null;
    visualOutput: VisualOutput;
    scale: number;
    now: number;
}

const DASH_FLOW_MS = 18; // dash offset per ms on the /index spokes
const PULSE_MS = 550;

export const firingCount = (live: LiveState) => {
    let n = 0;
    for (let i = 0; i < live.firing.length; i++) if (live.firing[i] >= VISUAL_FACTS.threshold) n++;
    return n;
};


/** A card's header band and the body below it, split into a glyph area and a text area. */
export function cardParts(b: Box, scale: number, textRows: number): { glyph: Box; textBox: Box } {
    const pad = 8 * scale, head = fontPx(11, scale) + 9 * scale;
    const body: Box = { x: b.x + pad, y: b.y + head, w: b.w - 2 * pad, h: b.h - head - pad };
    const textH = textRows * fontPx(9, scale) * 1.45;
    if (body.w / Math.max(1, body.h) >= 1.9) {
        const gw = body.w * 0.56;
        return { glyph: { x: body.x, y: body.y, w: gw, h: body.h }, textBox: { x: body.x + gw + pad, y: body.y, w: body.w - gw - pad, h: body.h } };
    }
    const gh = Math.max(0, body.h - textH - pad / 2);
    return { glyph: { x: body.x, y: body.y, w: body.w, h: gh }, textBox: { x: body.x, y: body.y + gh + pad / 2, w: body.w, h: textH } };
}

/** Split a box into `n` equal boxes side by side with `gap` between them. */
export function row(b: Box, n: number, gap: number): Box[] {
    const w = (b.w - gap * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => ({ x: b.x + i * (w + gap), y: b.y, w, h: b.h }));
}

function cardHead(g: G, b: Box, key: MediumKey, hover: boolean, scale: number) {
    frame(g, b, hover ? '#888' : '#2c2c2c');
    const pad = 8 * scale, px = fontPx(11, scale);
    const { title, sub } = CARD_TITLES[key];
    text(g, title, b.x + pad, b.y + pad * 0.8, px, '#fff');
    const tw = g.measureText(title).width; // text() left the title's font set
    const subX = b.x + pad + tw + pad, subPx = fontPx(9, scale);
    g.font = `${subPx}px ${MONO}`;
    const room = b.x + b.w - pad * 2 - fontPx(10, scale) - subX; // up to the ⤢ mark
    text(g, fit(g, sub, room), subX, b.y + pad * 0.8 + (px - subPx) * 0.6, subPx, '#777');
    text(g, '⤢', b.x + b.w - pad, b.y + pad * 0.7, fontPx(10, scale), hover ? '#fff' : '#444', 'right');
}

/** Where a spoke from the centre meets a card: the card's nearest point. */
function anchor(b: Box, cx: number, cy: number): [number, number] {
    return [Math.min(Math.max(cx, b.x), b.x + b.w), Math.min(Math.max(cy, b.y), b.y + b.h)];
}

/** A spoke from the organoid to a card. `/index` streams flow as moving dashes only while the
 *  playhead advances, since nothing is sent otherwise. */
function spoke(g: G, l: RoutingLayout, b: Box, kind: 'stream' | 'event' | 'offline', now: number, flowing = true): { sx: number; sy: number; ax: number; ay: number } {
    const { cx, cy, r } = l.centre;
    const [ax, ay] = anchor(b, cx, cy);
    const a = Math.atan2(ay - cy, ax - cx);
    const sx = cx + Math.cos(a) * (r + 3), sy = cy + Math.sin(a) * (r + 3);
    g.lineWidth = 1;
    if (kind === 'stream') {
        g.strokeStyle = '#9a9a9a';
        g.setLineDash([2, 5]);
        g.lineDashOffset = flowing ? -now / DASH_FLOW_MS : 0;
    } else {
        g.strokeStyle = kind === 'offline' ? '#333' : '#3a3a3a';
        g.setLineDash(kind === 'offline' ? [1, 4] : []);
    }
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(ax, ay);
    g.stroke();
    g.setLineDash([]);
    return { sx, sy, ax, ay };
}

type Segment = { sx: number; sy: number; ax: number; ay: number };

/** A protocol tag on a spoke, drawn after the cards: at the middle of the spoke, or slid toward
 *  (and just inside) the circle until it clears every card and every tag already placed, which
 *  it joins. */
function spokeTag(g: G, s: Segment, label: string, avoid: Box[], scale: number, color = '#888') {
    const px = fontPx(8, scale);
    g.font = `${px}px ${MONO}`;
    const w = g.measureText(label).width + px * 0.8, h = px * 1.5;
    const at = (t: number) => ({ x: s.sx + (s.ax - s.sx) * t, y: s.sy + (s.ay - s.sy) * t });
    const clear = (p: { x: number; y: number }) => !avoid.some(c => overlaps({ x: p.x - w / 2, y: p.y - h / 2, w, h }, c));
    const spot = [0.5, 0.3, 0.1, -0.15, -0.35, -0.55].map(at).find(clear) ?? at(-0.35);
    avoid.push(tag(g, label, spot.x, spot.y, px, color));
}

/** `s` cut to `maxW` with an ellipsis, in the current font. */
function fit(g: G, s: string, maxW: number): string {
    if (g.measureText(s).width <= maxW) return s;
    let out = s;
    while (out.length > 1 && g.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
    return out.length > 1 ? `${out}…` : '';
}

function pulse(g: G, s: { sx: number; sy: number; ax: number; ay: number }, t: number, scale: number) {
    if (t < 0 || t > 1) return;
    const d = 3 * scale;
    g.fillStyle = `rgba(255,255,255,${1 - t * 0.6})`;
    g.fillRect(s.sx + (s.ax - s.sx) * t - d / 2, s.sy + (s.ay - s.sy) * t - d / 2, d, d);
}

function drawCentre(g: G, l: RoutingLayout, v: DrawInput) {
    const { cx, cy, r } = l.centre, s = v.scale, live = v.live;
    g.strokeStyle = '#333';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    text(g, `ORGANOID · ${live.neurons.length || '—'} NEURONS`, cx, cy - r * 0.84, fontPx(9, s), '#888', 'center');
    const map: Box = { x: cx - r * 0.5, y: cy - r * 0.62, w: r, h: r };
    if (live.neurons.length) neuronMap(g, map, live.neurons, live.spikeGlow, s);
    else text(g, 'load data/ or upload CSVs', cx, cy - fontPx(9, s), fontPx(9, s), '#666', 'center');
    let y = cy + r * 0.5;
    if (v.phase === 'off') {
        g.save();
        g.globalAlpha = 1; // the countdown stays bright while the rest dims
        text(g, `■ OFF · ON IN ${formatClock(v.offRemainingMs)}`, cx, y, fontPx(12, s), '#fff', 'center');
        g.restore();
    } else {
        text(g, `/index ${v.index === null ? '——————' : pad6(v.index)}`, cx, y, fontPx(13, s), '#fff', 'center');
    }
    y += fontPx(13, s) * 1.35;
    text(g, v.mode === 'show' ? `show clock · ${VISUAL_FACTS.fps}/s` : 'local playback', cx, y, fontPx(8, s), '#777', 'center');
    y += fontPx(8, s) * 1.5;
    text(g, ATTRIBUTION, cx, y, fontPx(8, s), '#5a5a5a', 'center');
}

function drawVisual(g: G, b: Box, v: DrawInput) {
    const s = v.scale, { glyph, textBox } = cardParts(b, s, 3);
    const keys: SwarmKey[] = ['physarum', 'boids', 'termites'];
    row(glyph, 3, 6 * s).forEach((cell, i) => {
        const labelH = fontPx(8, s) * 1.4;
        swarmPanel(g, { ...cell, h: cell.h - labelH }, v.swarms[keys[i]]);
        const sw = VISUAL_FACTS.swarms[keys[i]];
        text(g, `${sw.label} ${sw.agents}`, cell.x + cell.w / 2, cell.y + cell.h - labelH + 2 * s, fontPx(8, s), '#bbb', 'center');
    });
    const firingLine: [string, string] = [firingCaption(v.live.firingSource, v.live.neurons.length, firingCount(v.live)), '#bbb'];
    lines(g, [firingLine, ['firing → speed ×2 / ×1.5 / ×2 · deposit', '#888'], ['termite firing → Dispersal → others flee', '#888']], textBox, s);
}

function drawLed(g: G, b: Box, v: DrawInput) {
    const s = v.scale, live = v.live, { glyph, textBox } = cardParts(b, s, 3);
    row(glyph, 2, 6 * s).forEach(cell => ledGrid(g, cell, live.ledCells, live.ledColor, live.ledAgeMs > LED_FACTS.idleMs));
    const last = live.ledLines.slice(0, 2).join('  ') || '—';
    lines(g, [[`F:x,y / C:x,y @${LED_FACTS.baud}`, '#aaa'], [`trail ${LED_FACTS.trail} · burst >${LED_FACTS.burstOver}`, '#777'], [last, '#555']], textBox, s);
}

function drawFab(g: G, b: Box, v: DrawInput) {
    const s = v.scale, { glyph, textBox } = cardParts(b, s, 3), { termite, vessel } = v;
    if (!termite && !vessel) {
        lines(g, [['no artifact data (data/)', '#777'], ['same recording → growth → print', '#555']], { ...glyph, y: glyph.y + glyph.h / 3 }, s);
        return;
    }
    // Both artifacts as their print layers, turning: the termite form, and the vessel grown to the playhead.
    const yaw = (v.now / TURN_MS) * Math.PI * 2, [left, right] = row(glyph, 2, 8 * s);
    if (termite) cachedDraw(g, v.artifacts, 'card-termite', left, v.now, '', (cg, box) => {
        drawStack(cg, box, termiteLayers(termite, 0), termiteFrame(termite, 0), { yaw, rgb: TERMITE_RGB, lineWidth: 0.7 });
    });
    else lines(g, [['termite form: link termite_slices.bin into data/', '#666']], { ...left, y: left.y + left.h / 3 }, s);
    if (vessel) {
        const printed = printedLayers(vessel, VESSEL_FACTS.printedMm);
        cachedDraw(g, v.artifacts, 'card-vessel', right, v.now, String(v.vesselLayer), (cg, box) => {
            drawStack(cg, box, vesselLayers(vessel), vesselFrame(vessel), {
                yaw, rgb: CLAY_RGB, lineWidth: 0.7, currentIndex: v.vesselLayer, faintFrom: v.vesselLayer + 1,
                dottedFrom: printed < vessel.layers.length ? printed : undefined,
            });
        });
    } else {
        lines(g, [['vessel: link vessel.gcode into data/', '#666']], { ...right, y: right.y + right.h / 3 }, s);
    }
    lines(g, [
        [termite ? `termite form · PLA · ${termite.segments.length} segments` : 'termite form · not linked', '#bbb'],
        [vessel ? `vessel · clay · layer ${v.vesselLayer + 1} / ${vessel.layers.length} ≈` : 'vessel · not linked', '#888'],
        ['both made before the show', '#555'],
    ], textBox, s);
}

function drawSound(g: G, b: Box, v: DrawInput) {
    const s = v.scale, live = v.live, sv = live.sound, { glyph, textBox } = cardParts(b, s, 3);
    if (sv.source === 'patch' && v.patch) {
        // The pass's activity and flags over the chord strip; the chord, large, at the right.
        const nameW = Math.min(glyph.w * 0.3, 74 * s), left: Box = { ...glyph, w: glyph.w - nameW - 8 * s };
        activityStrip(g, { ...left, h: left.h * 0.6 }, v.patch, v.range, sv.heardIndex, s);
        chordStrip(g, { ...left, y: left.y + left.h * 0.68, h: left.h * 0.32 }, sv.chordStep, s);
        chordName(g, { x: left.x + left.w + 8 * s, y: glyph.y, w: nameW, h: glyph.h }, sv, s);
        const r = sv.rates, telemetry = sv.chordSource === 'live' || r.tones.live || r.grains.live || r.kick.live;
        lines(g, [
            ['Max reads activity + burst flags at /index', '#bbb'],
            [`tones ${rateText(r.tones, 1)} · grains ${rateText(r.grains, 0)} · kick ${rateText(r.kick)}`, '#888'],
            [telemetry ? 'LIVE · from the patch' : `PATCH RULES${sv.chordSource === 'computed' ? ' · chord ≈' : ''}`, telemetry ? '#fff' : '#777'],
        ], textBox, s);
        return;
    }
    rateLine(g, { ...glyph, y: glyph.y + glyph.h * 0.15, h: glyph.h * 0.7 }, live.rateHistory, live.rateHead, live.peak);
    lines(g, [
        ['patch data not linked: ≈ from spikes', '#bbb'],
        [`rate ${Math.round(live.rate)}/100 ms · ${live.burst.inBurst ? 'BURST' : 'quiet'} · ends ${live.burst.ends}`, '#888'],
        [live.rateSource === 'live' ? 'LIVE · from the patch' : SOUND_FACTS.badge, live.rateSource === 'live' ? '#fff' : '#555'],
    ], textBox, s);
}

function drawSolenoids(g: G, b: Box, v: DrawInput) {
    const s = v.scale, live = v.live, { glyph, textBox } = cardParts(b, s, 3);
    strikers(g, glyph, live.strikeGlow);
    lines(g, [
        [`${live.backboneSlots.length} backbone of ${live.neurons.length || '—'}`, '#aaa'],
        ['Max → Daisy Seed · <27 bits>', '#777'],
        [live.strikeSource === 'live' ? `LIVE · ${live.strikes} strikes` : `≈ computed · ${live.strikes} strikes`, live.strikeSource === 'live' ? '#fff' : '#555'],
    ], textBox, s);
}

function drawRobot(g: G, b: Box, v: DrawInput) {
    const s = v.scale, live = v.live, { glyph, textBox } = cardParts(b, s, 4);
    hangingArms(g, glyph, live.arms, s);
    const anyLive = live.arms.some(a => a.live);
    lines(g, [
        [`VISITORS (proximity, touch) → ${ROBOT_FACTS.sensor} → ${ROBOT_FACTS.servo} 0–180°`, '#aaa'],
        [`${live.arms.map(a => `${a.proximity.toFixed(1)} m${a.touch ? ' · touch' : ''}`).join(' · ')}`, '#777'],
        ['→ serial → Max → sound', '#bbb'],
        [anyLive ? 'LIVE · from the audio computer' : ROBOT_FACTS.badge, anyLive ? '#fff' : '#555'],
    ], textBox, s);
}

export function drawOverview(g: G, l: RoutingLayout, v: DrawInput): void {
    const { cards, audioFrame } = l, s = v.scale, live = v.live;
    g.save();
    g.globalAlpha = v.dim;

    // The audio computer: sound, solenoids and the robot's sensors meet in one Max patch.
    frame(g, audioFrame, '#1c1c1c');
    text(g, 'AUDIO COMPUTER · Max/MSP', audioFrame.x + 8 * s, audioFrame.y + 3 * s, fontPx(9, s), '#888');

    // Spokes from the bridge; their tags go on after the cards.
    const flowing = live.moving && v.phase !== 'off';
    const toVisual = spoke(g, l, cards.visual, 'stream', v.now, flowing);
    const toSound = spoke(g, l, cards.sound, 'stream', v.now, flowing);
    const toLed = spoke(g, l, cards.led, 'event', v.now);
    if (live.lastLedFrame) pulse(g, toLed, live.ledAgeMs / PULSE_MS, s);
    const toFab = spoke(g, l, cards.fab, 'offline', v.now);

    // Max → solenoids: one line, lit by the strikes.
    const so = cards.sound, sn = cards.solenoids, rb = cards.robot;
    const stacked = l.orientation === 'landscape';
    const link: Segment = stacked
        ? { sx: so.x + so.w * 0.2, sy: so.y + so.h, ax: so.x + so.w * 0.2, ay: sn.y }
        : { sx: so.x + so.w, sy: so.y + so.h * 0.3, ax: sn.x, ay: so.y + so.h * 0.3 };
    let strike = 0;
    for (const e of live.strikeGlow) strike = Math.max(strike, e);
    g.strokeStyle = `rgba(255,255,255,${0.15 + 0.85 * strike})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(link.sx, link.sy);
    g.lineTo(link.ax, link.ay);
    g.stroke();

    // The robot's sensors back into Max, around the outside of the audio computer's frame.
    const margin = 6 * s;
    const loop: [number, number][] = stacked
        ? [[rb.x + rb.w, rb.y + rb.h * 0.5], [audioFrame.x + audioFrame.w + margin, rb.y + rb.h * 0.5], [audioFrame.x + audioFrame.w + margin, so.y + so.h * 0.5], [so.x + so.w, so.y + so.h * 0.5]]
        : [[rb.x + rb.w * 0.5, rb.y + rb.h], [rb.x + rb.w * 0.5, audioFrame.y + audioFrame.h + margin], [so.x + so.w * 0.5, audioFrame.y + audioFrame.h + margin], [so.x + so.w * 0.5, so.y + so.h]];
    g.strokeStyle = '#bdbdbd';
    g.setLineDash([4 * s, 4 * s]);
    g.lineDashOffset = v.now / 30;
    g.beginPath();
    loop.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.setLineDash([]);

    drawCentre(g, l, v);

    const draws: Record<MediumKey, (g: G, b: Box, v: DrawInput) => void> = {
        visual: drawVisual, led: drawLed, fab: drawFab, sound: drawSound, solenoids: drawSolenoids, robot: drawRobot,
    };
    for (const key of Object.keys(draws) as MediumKey[]) {
        const b = cards[key];
        g.save();
        clipTo(g, b);
        g.fillStyle = '#000';
        g.fillRect(b.x, b.y, b.w, b.h);
        cardHead(g, b, key, v.hover === key, s);
        draws[key](g, b, v);
        g.restore();
    }

    // Tags on top of everything: the protocols, and the two links inside the audio computer.
    const boxes: Box[] = Object.values(cards); // tags join it as they're placed
    spokeTag(g, toVisual, `OSC :${VISUAL_FACTS.port}`, boxes, s);
    spokeTag(g, toSound, 'OSC', boxes, s);
    spokeTag(g, toLed, 'SERIAL', boxes, s);
    spokeTag(g, toFab, 'before the show', boxes, s, '#666');
    const px = fontPx(8, s);
    tag(g, 'strikes', (link.sx + link.ax) / 2, (link.sy + link.ay) / 2, px, '#888');
    const [end, corner] = [loop[3], loop[2]];
    arrowHead(g, end[0] + (stacked ? 1 : 0), end[1] + (stacked ? 0 : 1), stacked ? Math.PI : -Math.PI / 2, 6 * s, '#bdbdbd');
    if (stacked) {
        // along the right margin, reading upward
        g.save();
        g.translate(corner[0], (loop[1][1] + corner[1]) / 2);
        g.rotate(-Math.PI / 2);
        tag(g, 'arm 1 → arpeggio', 0, 0, px, '#888');
        g.restore();
    } else {
        tag(g, 'arm 1 → arpeggio', (loop[1][0] + corner[0]) / 2, corner[1], px, '#888');
    }
    g.restore();
}
