// The routing overview: the organoid in the centre, the media the bridge feeds on one side,
// the audio computer's group on the other, and the cables between them.

import type { ShowConfig } from '../../types';
import { formatClock } from '../../show/showMath';
import { cableAngle, cablePoint } from '../../show/routing/cables';
import type { Cable, Point } from '../../show/routing/cables';
import { firingCaption, indexLabel, robotCaption, strikeCaption } from '../../show/routing/captions';
import { ATTRIBUTION, CARD_TITLES, FAB_FACTS, LED_FACTS, SOUND_FACTS, VISUAL_FACTS } from '../../show/routing/facts';
import type { MediumKey, VisualOutput } from '../../show/routing/facts';
import type { Box, RoutingLayout } from '../../show/routing/layout';
import { fontPx, row } from '../../show/routing/layout';
import { armIsLive, firingCount } from '../../show/routing/live';
import type { LiveState } from '../../show/routing/live';
import type { PatchData } from '../../show/routing/maxPatch';
import { pairLayout } from '../../show/routing/sliceView';
import { SWARM_KEYS } from '../../show/routing/swarm';
import type { SwarmKey } from '../../show/routing/swarm';
import type { TermiteSlices } from '../../show/routing/termiteSlices';
import type { Vessel } from '../../show/routing/vessel';
import { LINE_H, MONO, arrowHead, clipTo, fit, frame, ledGrid, lines, linesHeight, linesKeepLast, neuronMap, overlaps, rateLine, strikers, swarmPanel, tag, tagSize, text } from './glyphs';
import type { G } from './glyphs';
import { armPhaseText, armsPanel } from './armGlyphs';
import { activityStrip, chordName, chordStrip, rateText } from './soundGlyphs';
import { grownVessel, stackExtent, termiteFrame, turningTermite, vesselFrame } from './artifactGlyphs';
import type { ArtifactCache } from './artifactGlyphs';

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
    fps: number | null; // the show's /index rate (its config); null in local playback
    showConfig: ShowConfig | null; // the bridge's show config, when it has said
    phase: 'on' | 'off' | 'stopped';
    offRemainingMs: number;
    dim: number;
    hover: MediumKey | null;
    visualOutput: VisualOutput;
    scale: number;
    now: number;
}

const DASH_FLOW_MS = 18; // dash offset per ms on the /index cables, at scale 1
const PULSE_MS = 550;

/** A card's header band and the body below it, split into a glyph area and a text area that holds
 *  `rows` as they wrap (up to 60 % of a stacked card; the glyph keeps the rest). */
function cardParts(g: G, b: Box, scale: number, rows: [string, string][]): { glyph: Box; textBox: Box } {
    const pad = 8 * scale, head = fontPx(11, scale) + 9 * scale;
    const body: Box = { x: b.x + pad, y: b.y + head, w: b.w - 2 * pad, h: b.h - head - pad };
    if (body.w / Math.max(1, body.h) >= 1.9) {
        const gw = body.w * 0.56;
        return { glyph: { x: body.x, y: body.y, w: gw, h: body.h }, textBox: { x: body.x + gw + pad, y: body.y, w: body.w - gw - pad, h: body.h } };
    }
    const textH = Math.min(linesHeight(g, rows, body.w, scale), body.h * 0.6);
    const gh = Math.max(0, body.h - textH - pad / 2);
    return { glyph: { x: body.x, y: body.y, w: body.w, h: gh }, textBox: { x: body.x, y: body.y + gh + pad / 2, w: body.w, h: textH } };
}

function cardHead(g: G, b: Box, key: MediumKey, hover: boolean, scale: number) {
    frame(g, b, hover ? '#888' : '#2c2c2c');
    const pad = 8 * scale, px = fontPx(11, scale);
    const { title, sub } = CARD_TITLES[key];
    text(g, title, b.x + pad, b.y + pad * 0.8, px, '#fff');
    const tw = g.measureText(title).width; // text() left the title's font set
    const subX = b.x + pad + tw + pad, subPx = fontPx(9, scale);
    const room = b.x + b.w - pad * 2 - fontPx(10, scale) - subX; // up to the ⤢ mark
    text(g, fit(g, sub, room, subPx), subX, b.y + pad * 0.8 + (px - subPx) * 0.6, subPx, '#777');
    text(g, '⤢', b.x + b.w - pad, b.y + pad * 0.7, fontPx(10, scale), hover ? '#fff' : '#666', 'right');
}

/** How a cable is drawn: its colour and width (at scale 1), its dots if it has them, the halo that
 *  keeps it readable on black, and the dash offset of a stream while it flows. */
interface Lead {
    color: string;
    width: number;
    dash?: number[];
    halo: number;
    flow?: number;
}

type CableKind = 'stream' | 'event' | 'offline';

/** /index streams flow only while the playhead advances (nothing is sent otherwise); the serial link
 *  pulses per frame; the artifacts were made before the show, so their link is dotted and still.
 *  The hovered card's cable is lit. */
function lead(kind: CableKind, lit: boolean, flow: number | undefined): Lead {
    if (kind === 'stream') return { color: lit ? '#eee' : '#8c8c8c', width: 1.6, halo: lit ? 0.14 : 0.07, flow };
    if (kind === 'event') return { color: lit ? '#eee' : '#707070', width: 1.6, halo: lit ? 0.14 : 0.05 };
    return { color: lit ? '#bbb' : '#5c5c5c', width: 1.3, dash: [1.5, 4.5], halo: lit ? 0.1 : 0 };
}

function trace(g: G, c: Cable) {
    g.beginPath();
    g.moveTo(c.p0[0], c.p0[1]);
    g.bezierCurveTo(c.p1[0], c.p1[1], c.p2[0], c.p2[1], c.p3[0], c.p3[1]);
}

/** A cable as a patch lead: halo, lead, the stream's running dashes, and an arrowhead into the card. */
function drawCable(g: G, c: Cable, l: Lead, s: number) {
    g.save();
    g.lineCap = 'round';
    if (l.halo > 0) {
        g.strokeStyle = `rgba(255,255,255,${l.halo})`;
        g.lineWidth = 7 * s;
        trace(g, c);
        g.stroke();
    }
    g.strokeStyle = l.color;
    g.lineWidth = l.width * s;
    g.setLineDash(l.dash ? l.dash.map(d => d * s) : []);
    trace(g, c);
    g.stroke();
    if (l.flow !== undefined) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2 * s;
        g.setLineDash([3 * s, 11 * s]);
        g.lineDashOffset = l.flow * s;
        trace(g, c);
        g.stroke();
    }
    g.restore();
    arrowHead(g, c.p3[0], c.p3[1], cableAngle(c, 1), 6 * s, l.color);
}

/** Where a cable leaves the organoid: a jack on the rim. */
function jack(g: G, c: Cable, color: string, s: number) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(c.p0[0], c.p0[1], 2.4 * s, 0, Math.PI * 2);
    g.fill();
}

/** A protocol tag beside a cable, drawn after the cards so the cable stays in view: off its middle,
 *  or further along it on either side, else just inside the rim where it leaves; clear of every card
 *  and every tag already placed, which it joins. */
function cableTag(g: G, c: Cable, label: string, avoid: Box[], scale: number, color = '#888') {
    const px = fontPx(8, scale), { w, h } = tagSize(g, label, px);
    const box = ([x, y]: Point): Box => ({ x: x - w / 2, y: y - h / 2, w, h });
    const path = Array.from({ length: 25 }, (_, i) => cablePoint(c, i / 24));
    const clear = (p: Point) => {
        const b = box(p);
        return !avoid.some(o => overlaps(b, o)) && !path.some(([x, y]) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h);
    };
    // The tag's centre, just far enough off `at` in direction `a` that the box clears the point.
    const off = (at: Point, a: number): Point => {
        const d = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2 + 3 * scale;
        return [at[0] + Math.cos(a) * d, at[1] + Math.sin(a) * d];
    };
    const beside = [0.5, 0.35, 0.65, 0.25, 0.75].flatMap(t => [1, -1].map(side => off(cablePoint(c, t), cableAngle(c, t) + (side * Math.PI) / 2)));
    const spot = [...beside, off(c.p0, cableAngle(c, 0) + Math.PI)].find(clear) ?? cablePoint(c, 0.5);
    avoid.push(tag(g, label, spot[0], spot[1], px, color));
}

/** An LED frame travelling the serial cable, `t` of the way to the card. */
function pulse(g: G, c: Cable, t: number, s: number) {
    if (t < 0 || t > 1) return;
    const [x, y] = cablePoint(c, t);
    g.fillStyle = `rgba(255,255,255,${0.2 * (1 - t)})`;
    g.beginPath();
    g.arc(x, y, 6 * s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(255,255,255,${1 - t * 0.6})`;
    g.beginPath();
    g.arc(x, y, 2.4 * s, 0, Math.PI * 2);
    g.fill();
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
    else text(g, 'load data/ or upload CSVs', cx, cy - fontPx(9, s), fontPx(9, s), '#777', 'center');
    let y = cy + r * 0.5;
    if (v.phase === 'off') {
        g.save();
        g.globalAlpha = 1; // the countdown stays bright while the rest dims
        text(g, `■ OFF · ON IN ${formatClock(v.offRemainingMs)}`, cx, y, fontPx(12, s), '#fff', 'center');
        g.restore();
    } else {
        text(g, indexLabel(v.index), cx, y, fontPx(13, s), '#fff', 'center');
    }
    y += fontPx(13, s) * 1.35;
    text(g, v.mode === 'show' ? `show clock · ${v.fps}/s` : 'local playback', cx, y, fontPx(8, s), '#777', 'center');
    y += fontPx(8, s) * 1.5;
    // The attribution shows whole and clear of the outline: on two lines when the circle is narrower
    // than it at that height, each on a black ground where it still crosses.
    const apx = fontPx(8, s), cut = ATTRIBUTION.lastIndexOf(' · ');
    const chord = (at: number) => 2 * Math.sqrt(Math.max(0, r * r - (at - cy) ** 2)) - 16 * s;
    g.font = `${apx}px ${MONO}`;
    const parts = g.measureText(ATTRIBUTION).width <= chord(y + apx) || cut < 0 ? [ATTRIBUTION] : [ATTRIBUTION.slice(0, cut), ATTRIBUTION.slice(cut + 3)];
    parts.forEach((part, i) => {
        const py = y + i * apx * LINE_H, w = g.measureText(part).width + 6 * s;
        g.fillStyle = '#000';
        g.fillRect(cx - w / 2, py - 1, w, apx + 2);
        text(g, part, cx, py, apx, '#888', 'center');
    });
}

function drawVisual(g: G, b: Box, v: DrawInput) {
    const s = v.scale, px = fontPx(8, s), labelH = px * 1.4;
    const speeds = SWARM_KEYS.map(k => `×${VISUAL_FACTS.swarms[k].speedMul}`).join(' / ');
    const rows: [string, string][] = [
        [firingCaption(v.live.firingSource, v.live.neurons.length, firingCount(v.live)), '#bbb'],
        [`firing → speed ${speeds} · deposit`, '#888'],
        ['termite firing → Dispersal → others flee', '#888'],
    ];
    const { glyph, textBox } = cardParts(g, b, s, rows);
    row(glyph, 3, 6 * s).forEach((cell, i) => {
        swarmPanel(g, { ...cell, h: cell.h - labelH }, v.swarms[SWARM_KEYS[i]]);
        const sw = VISUAL_FACTS.swarms[SWARM_KEYS[i]], full = `${sw.label} ${sw.agents}`;
        const label = fit(g, full, cell.w, px) === full ? full : fit(g, sw.label, cell.w, px); // a narrow cell drops the count first
        text(g, label, cell.x + cell.w / 2, cell.y + cell.h - labelH + 2 * s, px, '#bbb', 'center');
    });
    lines(g, rows, textBox, s);
}

function drawLed(g: G, b: Box, v: DrawInput) {
    const s = v.scale, live = v.live, last = live.ledLines.slice(0, 2).join('  ') || '—';
    const rows: [string, string][] = [[`F:x,y / C:x,y @${LED_FACTS.baud}`, '#aaa'], [`trail ${LED_FACTS.trail} · burst >${LED_FACTS.burstOver}`, '#777'], [last, '#777']];
    const { glyph, textBox } = cardParts(g, b, s, rows);
    row(glyph, 2, 6 * s).forEach(cell => ledGrid(g, cell, live.ledCells, live.ledColor, live.ledAgeMs > LED_FACTS.idleMs));
    lines(g, rows, textBox, s);
}

function drawFab(g: G, b: Box, v: DrawInput) {
    const s = v.scale, { termite, vessel } = v, px = fontPx(8, s);
    const rows: [string, string][] = [
        [termite ? `termite form · PLA · ${termite.segments.length} printed segments` : 'termite form · link termite_slices.bin', '#bbb'],
        [vessel ? `clay vessel beside it · layer ${v.vesselLayer + 1} / ${vessel.layers.length} ≈` : 'vessel · link vessel.gcode', '#888'],
        ['side by side, to scale · made before the show', '#777'],
    ];
    const { glyph, textBox } = cardParts(g, b, s, rows);
    if (!termite && !vessel) {
        lines(g, [['no artifact data (data/)', '#777'], ['same recording → growth → print', '#777']], { ...glyph, y: glyph.y + glyph.h / 3 }, s);
        return;
    }
    // The two pieces as installed: side by side at one scale, turning; the vessel grown to the playhead.
    const tf = termite ? termiteFrame(termite, 0) : null, vf = vessel ? vesselFrame(vessel) : null;
    const mmPerUnit = termite ? FAB_FACTS.termite.heightMm / (termite.bounds.maxY - termite.bounds.minY) : 1;
    const te = tf ? stackExtent(tf) : null, ve = vf ? stackExtent(vf) : null;
    const pair = pairLayout({ ...glyph, h: glyph.h - px * 1.6 }, te && { w: te.w * mmPerUnit, h: te.h * mmPerUnit }, ve, 10 * s);
    if (termite && pair.termite) {
        turningTermite(g, v.artifacts, 'card-termite', pair.termite, termite, v.now, 0.7);
        text(g, `≈ ${FAB_FACTS.termite.heightMm / 10} cm`, pair.termite.x + pair.termite.w / 2, glyph.y + glyph.h - px * 1.3, px, '#999', 'center');
    }
    if (vessel && pair.vessel) {
        grownVessel(g, v.artifacts, 'card-vessel', pair.vessel, vessel, v.vesselLayer, v.now, 0.7);
        text(g, `${Math.round(vessel.heightMm)} mm`, pair.vessel.x + pair.vessel.w / 2, glyph.y + glyph.h - px * 1.3, px, '#999', 'center');
    }
    lines(g, rows, textBox, s);
}

// The cards that carry a LIVE / SIMULATED / ≈ badge keep it in view whatever else has to give.

function drawSound(g: G, b: Box, v: DrawInput) {
    const s = v.scale, live = v.live, sv = live.sound, patch = sv.source === 'patch' ? v.patch : null;
    const r = sv.rates, telemetry = sv.chordSource === 'live' || r.tones.live || r.grains.live || r.kick.live;
    const rows: [string, string][] = patch ? [
        ['Max reads activity + burst flags at /index', '#bbb'],
        [`tones ${rateText(r.tones, 1)} · grains ${rateText(r.grains, 0)} · kick ${rateText(r.kick)}`, '#888'],
    ] : [
        [v.patch ? 'no patch data at this /index: ≈ from spikes' : 'patch data not linked: ≈ from spikes', '#bbb'],
        [`rate ${Math.round(live.rate)}/100 ms · ${live.burst.inBurst ? 'BURST' : 'quiet'} · ends ${live.burst.ends}`, '#888'],
    ];
    const badge: [string, string] = patch
        ? [telemetry ? 'LIVE · from the patch' : `PATCH RULES${sv.chordSource === 'computed' ? ' · chord ≈' : ''}`, telemetry ? '#fff' : '#777']
        : [live.rateSource === 'live' ? 'LIVE · from the patch' : SOUND_FACTS.badge, live.rateSource === 'live' ? '#fff' : '#777'];
    const { glyph, textBox } = cardParts(g, b, s, [...rows, badge]);
    if (patch) {
        // The pass's activity and flags over the chord strip; the chord, large, at the right.
        const nameW = Math.min(glyph.w * 0.3, 74 * s), left: Box = { ...glyph, w: glyph.w - nameW - 8 * s };
        activityStrip(g, { ...left, h: left.h * 0.6 }, patch, v.range, sv.heardIndex, s);
        chordStrip(g, { ...left, y: left.y + left.h * 0.68, h: left.h * 0.32 }, sv.chordStep, s);
        chordName(g, { x: left.x + left.w + 8 * s, y: glyph.y, w: nameW, h: glyph.h }, sv, s);
    } else {
        rateLine(g, { ...glyph, y: glyph.y + glyph.h * 0.15, h: glyph.h * 0.7 }, live.rateHistory, live.rateHead, live.peak);
    }
    linesKeepLast(g, rows, [badge], textBox, s);
}

function drawSolenoids(g: G, b: Box, v: DrawInput) {
    const s = v.scale, live = v.live;
    const rows: [string, string][] = [[`${live.backboneSlots.length} backbone of ${live.neurons.length || '—'}`, '#aaa'], ['Max → Daisy Seed · <27 bits>', '#777']];
    const badge = strikeCaption(live.strikeSource, v.mode, live.strikes);
    const { glyph, textBox } = cardParts(g, b, s, [...rows, badge]);
    strikers(g, glyph, live.strikeGlow);
    linesKeepLast(g, rows, [badge], textBox, s);
}

function drawRobot(g: G, b: Box, v: DrawInput) {
    const s = v.scale, live = v.live;
    const rows: [string, string][] = [
        ['visitor → ultrasonic 0–100 cm → servo 0–180°', '#aaa'],
        [live.arms.map(armPhaseText).join(' · '), '#888'],
        ['arm 1 → Max: the arpeggio\'s pace', '#bbb'],
    ];
    const badge = robotCaption(live.arms.some(armIsLive));
    const { glyph, textBox } = cardParts(g, b, s, [...rows, badge]);
    armsPanel(g, glyph, live.arms, s, { cone: true, labels: false });
    linesKeepLast(g, rows, [badge], textBox, s);
}

export function drawOverview(g: G, l: RoutingLayout, v: DrawInput): void {
    const { cards, audioFrame } = l, s = v.scale, live = v.live;
    g.save();
    g.globalAlpha = v.dim;

    // The audio computer: sound, solenoids and the robot's sensors meet in one Max patch.
    // Its label stays clear of the cables, which come in on the left in portrait.
    frame(g, audioFrame, '#1c1c1c');
    const across = l.orientation === 'landscape';
    text(g, 'AUDIO COMPUTER · Max/MSP', across ? audioFrame.x + 8 * s : audioFrame.x + audioFrame.w - 8 * s, audioFrame.y + 3 * s, fontPx(9, s), '#888', across ? 'left' : 'right');

    // Cables out of the organoid; their tags go on after the cards.
    const flow = live.moving && v.phase !== 'off' ? -v.now / DASH_FLOW_MS : undefined;
    const routes: [keyof RoutingLayout['cables'], CableKind][] = [['visual', 'stream'], ['sound', 'stream'], ['led', 'event'], ['fab', 'offline']];
    for (const [key, kind] of routes) {
        const lit = v.hover === key, look = lead(kind, lit, flow);
        drawCable(g, l.cables[key], look, s);
        jack(g, l.cables[key], look.color, s);
    }
    if (live.lastLedFrame) pulse(g, l.cables.led, live.ledAgeMs / PULSE_MS, s);

    // Max → solenoids: a short lead between the two cards, lit by the strikes.
    const so = cards.sound, rb = cards.robot;
    const stacked = l.orientation === 'landscape';
    let strike = 0;
    for (const e of live.strikeGlow) strike = Math.max(strike, e);
    drawCable(g, l.strikes, { color: `rgba(255,255,255,${0.3 + 0.7 * strike})`, width: 1.6, halo: 0.16 * strike }, s);

    // The robot's sensors back into Max, around the outside of the audio computer's frame.
    const margin = 6 * s;
    const loop: [number, number][] = stacked
        ? [[rb.x + rb.w, rb.y + rb.h * 0.5], [audioFrame.x + audioFrame.w + margin, rb.y + rb.h * 0.5], [audioFrame.x + audioFrame.w + margin, so.y + so.h * 0.5], [so.x + so.w, so.y + so.h * 0.5]]
        : [[rb.x + rb.w * 0.5, rb.y + rb.h], [rb.x + rb.w * 0.5, audioFrame.y + audioFrame.h + margin], [so.x + so.w * 0.5, audioFrame.y + audioFrame.h + margin], [so.x + so.w * 0.5, so.y + so.h]];
    g.strokeStyle = '#bdbdbd';
    g.setLineDash([4 * s, 4 * s]);
    g.lineDashOffset = -v.now / 30; // flowing from the robot into Max, as the arrow points
    g.beginPath();
    loop.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.setLineDash([]);
    g.lineDashOffset = 0;

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
    cableTag(g, l.cables.visual, `OSC :${VISUAL_FACTS.port}`, boxes, s);
    cableTag(g, l.cables.sound, 'OSC', boxes, s);
    cableTag(g, l.cables.led, 'SERIAL', boxes, s);
    cableTag(g, l.cables.fab, 'before the show', boxes, s, '#777');
    cableTag(g, l.strikes, 'strikes', boxes, s);
    const px = fontPx(8, s);
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
