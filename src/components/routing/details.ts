// One medium full size: its source, its story drawn large, the signal chain with live values,
// and a rail of all six media to step between them.

import { ARM_RULES, servoTarget } from '../../show/routing/arms';
import { firingCaption, indexLabel, pad6, passCaption, robotCaption, sourceCaption, strikeCaption } from '../../show/routing/captions';
import { ATTRIBUTION, CARD_TITLES, FAB_FACTS, LED_FACTS, MEDIA, ROBOT_FACTS, SOLENOID_FACTS, SOUND_FACTS, VESSEL_FACTS, VISUAL_FACTS, VISUAL_OUTPUT_CHAINS } from '../../show/routing/facts';
import type { MediumKey } from '../../show/routing/facts';
import type { Box, DetailLayout } from '../../show/routing/layout';
import { fontPx, isLandscape, row } from '../../show/routing/layout';
import { armIsLive, firingCount, rate } from '../../show/routing/live';
import type { PatchData } from '../../show/routing/maxPatch';
import { fabPanels } from '../../show/routing/sliceView';
import { paperMappings } from '../../show/routing/soundFeatures';
import { soundCaptions, soundPanels } from '../../show/routing/soundLayout';
import { SWARM_KEYS } from '../../show/routing/swarm';
import { printedLayers } from '../../show/routing/vessel';
import { LINE_H, MONO, arrowHead, clipTo, clippedLines, fitSquare, frame, ledGrid, lines, linesHeight, neuronMap, rateLine, strikers, swarmPanel, text, vesselTop } from './glyphs';
import type { G } from './glyphs';
import { armRuleChart, armsPanel } from './armGlyphs';
import type { DrawInput } from './overview';
import { activityStrip, harmony, rateText, rules, score, speakers } from './soundGlyphs';
import { TERMITE_RGB, TURN_MS, cachedDraw, drawStack, grownVessel, planView, schematic, termiteFrame, termiteLayers, turningTermite } from './artifactGlyphs';

const CLOSE_LABEL = '× ROUTING';

/** The `× ROUTING` target at the header's right end. */
export function closeBox(l: DetailLayout): Box {
    const w = 110 * l.scale;
    return { x: l.header.x + l.header.w - w, y: l.header.y, w, h: l.header.h };
}

/** Boxes in a row joined by arrows: [title, live value] each. */
function chain(g: G, b: Box, items: [string, string][], s: number) {
    const gap = 14 * s, h = Math.min(b.h, 46 * s);
    const cells = row({ x: b.x, y: b.y + (b.h - h) / 2, w: b.w, h }, items.length, gap);
    cells.forEach((c, i) => {
        frame(g, c, '#333');
        clippedLines(g, [[items[i][0], '#e6e6e6'], [items[i][1], '#888']], { x: c.x + 6 * s, y: c.y + 6 * s, w: c.w - 12 * s, h: c.h - 12 * s }, s, 9, c);
        if (i < cells.length - 1) {
            const y = c.y + c.h / 2, x0 = c.x + c.w + 2, x1 = c.x + c.w + gap - 2;
            g.strokeStyle = '#666';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(x0, y);
            g.lineTo(x1, y);
            g.stroke();
            arrowHead(g, x1, y, 0, 5 * s, '#666');
        }
    });
}

function header(g: G, l: DetailLayout, key: MediumKey) {
    const s = l.scale, { title, sub } = CARD_TITLES[key];
    text(g, `${title} · ${sub}`, l.header.x, l.header.y + 4 * s, fontPx(13, s), '#fff');
    const c = closeBox(l);
    text(g, CLOSE_LABEL, c.x + c.w, c.y + 4 * s, fontPx(11, s), '#bbb', 'right');
}

/** The organoid as this medium hears it, with the playhead under it. */
function source(g: G, b: Box, v: DrawInput, only?: 'backbone', heardAs?: string) {
    const s = v.scale, px = fontPx(10, s);
    const heard = heardAs ?? (only ? `${v.live.backboneSlots.length} backbone neurons of ${v.live.neurons.length}` : `${v.live.neurons.length} neurons · spikes`);
    const caption = sourceCaption(v.phase, v.index, heard), captionH = linesHeight(g, caption, b.w, s, 10); // as wrapped: the attribution shows whole
    const map = { ...b, h: Math.max(0, b.h - captionH - px * 0.6) };
    frame(g, fitSquare(map), '#1e1e1e');
    if (v.live.neurons.length) neuronMap(g, map, v.live.neurons, v.live.spikeGlow, s, only);
    lines(g, caption, { x: b.x, y: map.y + map.h + px * 0.6, w: b.w, h: captionH }, s, 10);
}

/** The story area above the chain. */
const storyTop = (l: DetailLayout): Box => ({ ...l.story, h: l.story.h - l.chain.h - 10 * l.scale });

function visual(g: G, l: DetailLayout, v: DrawInput) {
    const s = l.scale, st = storyTop(l), px = fontPx(9, s);
    const panelsH = st.h * 0.58;
    row({ ...st, h: panelsH }, 3, 12 * s).forEach((cell, i) => {
        const facts = VISUAL_FACTS.swarms[SWARM_KEYS[i]];
        const labelH = px * 4.4;
        swarmPanel(g, { ...cell, h: cell.h - labelH }, v.swarms[SWARM_KEYS[i]]);
        clippedLines(g, [
            [`${facts.label} · ${facts.agents} · ${facts.types} type${facts.types > 1 ? 's' : ''}`, '#e6e6e6'],
            [`firing → speed ×${facts.speedMul}`, '#999'],
            [`deposit ${facts.deposit}`, '#777'],
        ], { x: cell.x, y: cell.y + cell.h - labelH + 4 * s, w: cell.w, h: labelH }, s, 9, { ...cell, y: cell.y + cell.h - labelH, h: labelH });
    });
    // Spikes over the rate EoC actually reads, neuron by neuron.
    const strip: Box = { x: st.x, y: st.y + panelsH + 8 * s, w: st.w, h: st.h * 0.13 };
    const live = v.live, n = Math.max(1, live.neurons.length), cw = strip.w / n;
    frame(g, strip, '#222');
    for (let i = 0; i < live.neurons.length; i++) {
        const f = Math.min(1, live.firing[i]), x = strip.x + i * cw;
        if (f > 0) {
            g.fillStyle = f >= VISUAL_FACTS.threshold ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)';
            g.fillRect(x, strip.y + strip.h * (1 - f), Math.max(1, cw - 0.5), strip.h * f);
        }
        if (live.spikeGlow[i] > 0.06) {
            g.fillStyle = `rgba(0,255,255,${live.spikeGlow[i]})`;
            g.fillRect(x, strip.y + 1, Math.max(1, cw - 0.5), 3 * s);
        }
    }
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(strip.x, strip.y + strip.h * (1 - VISUAL_FACTS.threshold), strip.w, 1);
    const below: Box = { x: st.x, y: strip.y + strip.h + 6 * s, w: st.w, h: st.y + st.h - (strip.y + strip.h + 6 * s) };
    clippedLines(g, [
        [live.firingSource === 'blob' ? `spikes (cyan) vs the normalized rate EoC reads (bars) · line = ${VISUAL_FACTS.threshold}` : `${firingCaption(live.firingSource, live.neurons.length, 0)} (data/${VISUAL_FACTS.blob})`, '#999'],
        [v.showConfig ? passCaption(v.showConfig) : 'pass  /sim_resetSimsOnly → /sim_on 5 → T ×5 · P ×10 → /sim_off 5 → 2 min dark, sims paused', '#777'],
        ['one pass = one day: the diurnal sun sweeps the temperature field once per /index pass', '#777'],
        [`out  ${VISUAL_OUTPUT_CHAINS[v.visualOutput].join(' → ')}`, '#bbb'],
        [VISUAL_FACTS.drawnNote, '#555'],
    ], below, s);
    chain(g, l.chain, [
        [indexLabel(v.index), v.fps === null ? 'OSC int · one a frame' : `OSC int · ${v.fps}/s`],
        ['OSCMapping', `UDP :${VISUAL_FACTS.port}`],
        ['NeuronFiringSource', `${VISUAL_FACTS.blob} row`],
        [`≥ ${VISUAL_FACTS.threshold} = firing`, `${firingCount(live)} now · ${VISUAL_FACTS.fadeS} s fade`],
        ['agent i → i % 131', 'speed × · deposit'],
    ], s);
}

function bar(g: G, b: Box, t: number, label: string, s: number) {
    const px = fontPx(9, s);
    text(g, label, b.x, b.y, px, '#aaa');
    const track = { x: b.x, y: b.y + px * 1.5, w: b.w, h: Math.max(3, 4 * s) };
    g.fillStyle = '#1c1c1c';
    g.fillRect(track.x, track.y, track.w, track.h);
    g.fillStyle = '#fff';
    g.fillRect(track.x, track.y, track.w * Math.min(1, Math.max(0, t)), track.h);
}

/** The patch at the playhead: the voices as they play, the rules that pace them, the chord, the speakers. */
function soundFromPatch(g: G, l: DetailLayout, v: DrawInput, patch: PatchData) {
    const s = l.scale, sv = v.live.sound, p = soundPanels(storyTop(l)), px = fontPx(9, s);
    text(g, `VOICES · ${soundCaptions(v.live.moving).voices}`, p.score.x, p.score.y, px, '#ddd');
    const strip: Box = { x: p.score.x, y: p.score.y + px * 1.6, w: p.score.w, h: Math.max(8, p.score.h * 0.14) };
    activityStrip(g, strip, patch, v.range, sv.heardIndex, s);
    const below = strip.y + strip.h + 6 * s;
    score(g, { ...p.score, y: below, h: Math.max(8, p.score.y + p.score.h - below) }, sv, v.now, s);
    rules(g, p.rules, sv, s);
    harmony(g, p.harmony, sv, v.index, v.mode, v.fps, s);
    speakers(g, p.output, sv, v.now, s);
    chain(g, l.chain, [
        [indexLabel(v.index), 'OSC → audio computer'],
        ['peek~ activity · flags', `v ${sv.v.toFixed(3)} · flag ${sv.flagsSoFar}`],
        ['a = v / 0.9668', sv.a.toFixed(3)],
        ['tones · grains · kick', `${rateText(sv.rates.tones, 1)} · ${rateText(sv.rates.grains, 0)} · ${rateText(sv.rates.kick)}`],
        ['speakers 3–6', 'arpeggio 1–2'],
    ], s);
}

function sound(g: G, l: DetailLayout, v: DrawInput) {
    if (v.live.sound.source === 'patch' && v.patch) return soundFromPatch(g, l, v, v.patch);
    const s = l.scale, st = storyTop(l), live = v.live;
    const graph: Box = { ...st, h: st.h * 0.34 };
    frame(g, graph, '#222');
    rateLine(g, { x: graph.x + 4, y: graph.y + 6 * s, w: graph.w - 8, h: graph.h - 12 * s }, live.rateHistory, live.rateHead, live.peak);
    text(g, live.burst.inBurst ? 'BURST' : 'quiet', graph.x + graph.w - 6 * s, graph.y + 4 * s, fontPx(10, s), live.burst.inBurst ? '#fff' : '#666', 'right');
    const norm = live.rate / live.peak, m = paperMappings(norm);
    const cols = row({ x: st.x, y: graph.y + graph.h + 12 * s, w: st.w, h: fontPx(9, s) * 3 }, 4, 16 * s);
    const span = (r: [number, number], value: number) => (value - r[0]) / (r[1] - r[0]); // where in its published range
    // The patch's own values when it reports them (LIVE), else the paper mappings of the rate.
    const sl = live.soundLive, tones = rate(sl.tones, m.toneDensity), grains = rate(sl.grains, m.grainDensity), kick = rate(sl.kick, m.kickDensity);
    bar(g, cols[0], span(SOUND_FACTS.tone, tones.perSec), `tones √ ${rateText(tones)}`, s);
    bar(g, cols[1], span(SOUND_FACTS.grains, grains.perSec), `grains ⁶√⁻¹ ${rateText(grains, 1)}`, s);
    bar(g, cols[2], span(SOUND_FACTS.grainMs, m.grainMs), `grain ${m.grainMs.toFixed(0)} ms`, s);
    bar(g, cols[3], span(SOUND_FACTS.kick, kick.perSec), `kick ${kick.perSec.toFixed(2)}/s · ${SOUND_FACTS.kickPitch}${kick.live ? ' · LIVE' : ''}`, s);
    const textBox: Box = { x: st.x, y: cols[0].y + cols[0].h + 10 * s, w: st.w, h: st.y + st.h - (cols[0].y + cols[0].h + 10 * s) };
    clippedLines(g, [
        [v.patch // linked, but nothing to read at this index (none heard yet, or past the data)
            ? `${live.sound.heardIndex === null ? 'no /index heard yet' : `no patch data at ${indexLabel(live.sound.heardIndex)}`}: ≈ from spikes until there is (${SOUND_FACTS.patchFile})`
            : `link activitylevel.wav + burstflags.wav (dev/audio) into data/ for the patch's own values (${SOUND_FACTS.patchFile})`, '#bbb'],
        [`ranges: ${SOUND_FACTS.rangesSource} · rate normalized to this recording's peak (${live.peak}/100 ms)`, '#777'],
        [`${SOUND_FACTS.descriptionSource}: population firing rate → synthesis density and spatialization; burst endpoints → harmonic transitions`, '#999'],
        [`${SOUND_FACTS.harmony} · distorted electric guitar · ${SOUND_FACTS.channels} ch · a reverb per channel${sl.harmony !== undefined ? ` · harmonic step ${sl.harmony} (LIVE)` : ''}`, '#999'],
        ['← robot sensors over serial  ·  → 27 solenoids', '#bbb'],
        [live.rateSource === 'live' ? 'LIVE · rate from the patch' : SOUND_FACTS.badge, live.rateSource === 'live' ? '#fff' : '#555'],
    ], textBox, s);
    chain(g, l.chain, [
        [indexLabel(v.index), 'OSC → audio computer'],
        ['Max/MSP', 'reads activity + flag WAVs'],
        ['population rate ≈', `${Math.round(live.rate)}/100 ms`],
        ['burst ends', `${live.burst.ends} transitions`],
        [`${SOUND_FACTS.channels} ch`, SOUND_FACTS.harmony],
    ], s);
}

function solenoids(g: G, l: DetailLayout, v: DrawInput) {
    const s = l.scale, st = storyTop(l), live = v.live;
    const grid: Box = { ...st, h: st.h * 0.55 };
    strikers(g, grid, live.strikeGlow);
    const logBox: Box = { x: st.x, y: grid.y + grid.h + 10 * s, w: st.w, h: st.y + st.h - (grid.y + grid.h + 10 * s) };
    const log = live.strikeLog.slice().reverse().map(e => [`slot ${String(e.slot).padStart(2, '0')} · neuron ${e.neuronId} · t ${pad6(e.t)}`, '#999'] as [string, string]);
    clippedLines(g, [
        ['one solenoid per backbone neuron, in the ceramic vessels and suspended glassware', '#bbb'],
        [`Max sends line index + 1 of ${SOLENOID_FACTS.file} as <27 digits> to the ${SOLENOID_FACTS.board}; all off ${SOLENOID_FACTS.releaseMs} ms after the last line`, '#999'],
        strikeCaption(live.strikeSource, v.mode, live.strikes),
        ...log,
    ], logBox, s);
    chain(g, l.chain, [
        [indexLabel(v.index), 'OSC → audio computer'],
        [SOLENOID_FACTS.file, `line index + 1 · ${live.backboneSlots.length} of ${live.neurons.length}`],
        ['<27 digits>', `${SOLENOID_FACTS.baud} baud`],
        [SOLENOID_FACTS.board, `all off after ${SOLENOID_FACTS.releaseMs} ms`],
        ['strike', `${live.strikes} so far`],
    ], s);
}

function led(g: G, l: DetailLayout, v: DrawInput) {
    const s = l.scale, st = storyTop(l), live = v.live;
    const grids: Box = { ...st, w: st.w * 0.68 };
    row(grids, 2, 14 * s).forEach(cell => ledGrid(g, cell, live.ledCells, live.ledColor, live.ledAgeMs > LED_FACTS.idleMs));
    const side: Box = { x: st.x + st.w * 0.7, y: st.y, w: st.w * 0.3, h: st.h };
    const age = live.lastLedFrame ? `last frame ${Math.round(live.ledAgeMs)} ms ago` : 'no frame yet';
    clippedLines(g, [
        ['serial lines', '#888'],
        ...(live.ledLines.length ? live.ledLines : ['—']).map(line => [line, '#ddd'] as [string, string]),
        ['', '#000'],
        [age, '#777'],
        [`${LED_FACTS.idleMs / 1000} s without frames → white idle shimmer`, '#555'],
        ['two matrices in laser-cut frames; fibers carry the light into the glassware with the plants', '#777'],
    ], side, s);
    chain(g, l.chain, [
        ['ledStep', `trail ${LED_FACTS.trail} · burst >${LED_FACTS.burstOver}`],
        ['SERIAL_SYNC', 'WebSocket :8081'],
        [`F: / C: ≤${LED_FACTS.perFrameCap}`, `${live.ledFrames} frames`],
        [`USB ${LED_FACTS.baud}`, 'Arduino'],
        ['2 × 16×16', '→ fiber optics'],
    ], s);
}

function robot(g: G, l: DetailLayout, v: DrawInput) {
    const s = l.scale, st = storyTop(l), live = v.live, px = fontPx(9, s);
    const landscape = isLandscape(st.w, st.h);
    const armsBox: Box = landscape ? { ...st, w: st.w * 0.56 } : { ...st, h: st.h * 0.55 };
    armsPanel(g, armsBox, live.arms, s, { cone: true, labels: true });
    const side: Box = landscape
        ? { x: st.x + st.w * 0.6, y: st.y, w: st.w * 0.4, h: st.h }
        : { x: st.x, y: st.y + st.h * 0.58, w: st.w, h: st.h * 0.42 };
    text(g, 'THE RULE · distance → angle, past a 10° deadband', side.x, side.y, px, '#ddd');
    const chart: Box = { x: side.x, y: side.y + px * 1.8, w: side.w, h: Math.min(side.h * 0.42, side.w * 0.6) };
    armRuleChart(g, chart, live.arms, s);
    const below: Box = { x: side.x, y: chart.y + chart.h + px, w: side.w, h: side.y + side.h - (chart.y + chart.h + px) };
    clippedLines(g, [
        ...live.arms.map((a, k): [string, string] => {
            // Each value says where it came from: the distance (and the target and phase it drives), and the servo.
            const from = a.live.proximity === a.live.servo ? (a.live.proximity ? 'LIVE' : 'sim') : a.live.proximity ? 'cm LIVE · servo sim' : 'cm sim · servo LIVE';
            return [`arm ${k + 1} · ${Math.round(a.cm)} cm → ${servoTarget(a.cm)}° · servo ${Math.round(a.servo)}° · ${a.motion.phase}${a.touch ? ' · touched' : ''} · ${from}`, armIsLive(a) ? '#fff' : '#999'];
        }),
        [`${ROBOT_FACTS.sketch}: ramps at 200°/s, settles 100 ms, then ignores the sensor for 2 s; serial to Max`, '#888'],
        [`${ROBOT_FACTS.rebuild}: the same rules, touch-lit fibres, OSC to Max (9100) and here (3333, arms 1–3)`, '#777'],
        ['hung upside down: the tendon curls the spine, gravity swings it back', '#777'],
        [`┄ ${ROBOT_FACTS.dormant}`, '#555'],
        robotCaption(live.arms.some(armIsLive)),
    ], below, s);
    chain(g, l.chain, [
        ['visitor', 'within 1 m'],
        ['ultrasonic', '0–100 cm · at the tip'],
        ['map → servo', '10° deadband · 2 s rest'],
        ['tendon → spine', 'hung upside down'],
        ['serial · OSC', 'arm 1 → arpeggio'],
    ], s);
}

function robotSource(g: G, b: Box, v: DrawInput) {
    const s = v.scale, px = fontPx(9, s);
    text(g, 'VISITORS', b.x, b.y, fontPx(10, s), '#fff');
    const bars = row({ x: b.x, y: b.y + fontPx(10, s) * 2, w: b.w, h: Math.min(b.h * 0.6, 180 * s) }, v.live.arms.length, 10 * s);
    v.live.arms.forEach((a, k) => {
        const c = bars[k], fill = Math.max(0, Math.min(1, 1 - a.cm / ARM_RULES.rangeCm));
        frame(g, c, '#222');
        g.fillStyle = a.live.proximity ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)';
        g.fillRect(c.x + 2, c.y + c.h * (1 - fill), c.w - 4, c.h * fill);
        if (fill === 0) text(g, 'nobody', c.x + c.w / 2, c.y + c.h - px * 1.4, fontPx(8, s), '#555', 'center');
        text(g, `${k + 1} · ${Math.round(a.cm)} cm`, c.x + c.w / 2, c.y + c.h + 4 * s, px, a.live.proximity ? '#fff' : '#888', 'center');
    });
    text(g, 'closer = taller · 100 cm = nobody', b.x, bars[0].y + bars[0].h + px * 2.2, fontPx(8, s), '#555');
    lines(g, [[ATTRIBUTION, '#5a5a5a']], { x: b.x, y: b.y + b.h - fontPx(10, s) * 3, w: b.w, h: fontPx(10, s) * 3 }, s, 10);
}

const VIEW_MS = 12_000; // the termite form alternates: turning, then its four print segments
const FADE_MS = 1000;
const SWEEP_MS = 200; // a print-preview slice every 200 ms

/** 1 while the turning view shows, 0 during the segments view, with a fade between. */
function turningShare(now: number): number {
    const t = now % (2 * VIEW_MS);
    if (t < VIEW_MS - FADE_MS) return 1;
    if (t < VIEW_MS) return 1 - (t - (VIEW_MS - FADE_MS)) / FADE_MS;
    if (t < 2 * VIEW_MS - FADE_MS) return 0;
    return (t - (2 * VIEW_MS - FADE_MS)) / FADE_MS;
}

/** The share of LED pixels lit now: the schematic's fibres carry their light. */
function ledShare(cells: Float32Array): number {
    let lit = 0;
    for (const c of cells) if (c > 0.05) lit++;
    return lit / Math.max(1, cells.length);
}

/** The termite form: turning, then exploded into its print segments with a print preview sweeping up. */
function termitePanel(g: G, b: Box, v: DrawInput, s: number) {
    const px = fontPx(9, s), capH = px * LINE_H * 4, t = v.termite;
    text(g, `TERMITE FORM · ${FAB_FACTS.termite.material}`, b.x, b.y, px, '#ddd');
    const area: Box = { x: b.x, y: b.y + px * 1.8, w: b.w, h: Math.max(8, b.h - px * 1.8 - capH - 6 * s) };
    if (!t) {
        lines(g, [['link termite_slices.bin into data/ (node scripts/termite-slices.mjs <mesh.obj>)', '#777']], { ...area, y: area.y + area.h / 3 }, s, 9);
        return;
    }
    const turning = turningShare(v.now);
    if (turning > 0) {
        g.save();
        g.globalAlpha *= turning;
        turningTermite(g, v.artifacts, 'fab-turning', area, t, v.now, 0.8);
        g.restore();
    }
    const explode = (t.bounds.maxY - t.bounds.minY) * 0.06, stack = termiteLayers(t, explode), f = termiteFrame(t, explode);
    const sweep = Math.floor(v.now / SWEEP_MS) % Math.max(1, stack.length), current = stack[sweep];
    if (turning < 1 && current) {
        g.save();
        g.globalAlpha *= 1 - turning;
        // A still view: it changes only with the slice and the box, so it renders only then.
        cachedDraw(g, v.artifacts, 'fab-segments', area, v.now, `${sweep}|${px}|${area.w}|${area.h}`, (cg, box) => {
            const at = drawStack(cg, box, stack, f, { yaw: 0.6, rgb: TERMITE_RGB, lineWidth: 0.8, currentIndex: sweep });
            t.segments.forEach((seg, k) => text(cg, String(k + 1), box.x + 2 * s, at((seg.yMin + seg.yMax) / 2 + k * explode) - px / 2, px, '#bbb'));
        }, Infinity);
        const side = Math.min(area.w * 0.28, area.h * 0.3);
        planView(g, { x: area.x + area.w - side, y: area.y, w: side, h: side }, current, f, TERMITE_RGB);
        g.restore();
    }
    const seg = current ? current.segment : 0, inSeg = stack.filter(sl => sl.segment === seg), j = inSeg.indexOf(current);
    const view = turning >= 0.5 ? `≈ ${FAB_FACTS.termite.heightMm / 10} cm as built · turning once every ${TURN_MS / 1000} s` : `PLA print preview · printed segment ${seg + 1} · slice ${j + 1} / ${inSeg.length}`;
    clippedLines(g, [
        [view, '#ccc'],
        [FAB_FACTS.pipeline, '#888'],
        [`${FAB_FACTS.termite.source} · made before the show, not on /index`, '#555'],
    ], { x: b.x, y: b.y + b.h - capH, w: b.w, h: capH }, s);
}

/** The vessel: its G-code spiral, grown to the layer the playhead has reached (≈). */
function vesselPanel(g: G, b: Box, v: DrawInput, s: number) {
    const px = fontPx(9, s), vessel = v.vessel;
    text(g, 'VESSEL · clay', b.x, b.y, px, '#ddd');
    const body: Box = { x: b.x, y: b.y + px * 1.8, w: b.w, h: b.h - px * 1.8 };
    if (!vessel) {
        lines(g, [['link vessel.gcode into data/ to draw the vessel', '#777']], { ...body, y: body.y + body.h / 3 }, s, 9);
        return;
    }
    const printed = printedLayers(vessel, VESSEL_FACTS.printedMm);
    grownVessel(g, v.artifacts, 'fab-vessel', { ...body, w: body.w * 0.5 }, vessel, v.vesselLayer, v.now, 0.8);
    const info: Box = { x: body.x + body.w * 0.54, y: body.y, w: body.w * 0.46, h: body.h };
    const z = Math.round((v.vesselLayer + 1) * vessel.layerMm);
    clippedLines(g, [
        [`layer ${v.vesselLayer + 1} / ${vessel.layers.length} ≈ · ${Math.round(vessel.heightMm)} mm tall, beside the termite form`, '#fff'],
        [`z ${z} mm${printed < vessel.layers.length ? ` · printed to layer ${printed}` : ''}`, '#bbb'],
        ["each neuron's firing locally speeds the contour's growth; sampled layers stack into one spiral", '#888'],
        ['linear in the recording: the sketch adds a layer only while a neuron fires', '#666'],
        [`${vessel.layers.length} × ${vessel.layerMm} mm spiral · nozzle ${vessel.header.nozzle ?? '?'}`, '#777'],
        [VESSEL_FACTS.file, '#666'],
        [`${VESSEL_FACTS.clay} · ${VESSEL_FACTS.printer} (${VESSEL_FACTS.source})`, '#777'],
    ], info, s);
}

function fab(g: G, l: DetailLayout, v: DrawInput) {
    const s = l.scale, st = storyTop(l), { termite, vessel } = v;
    if (!termite && !vessel) {
        lines(g, [['no artifact data (data/termite_slices.bin, data/vessel.gcode)', '#999'], ['both artifacts are grown from this recording before the show; link their files into data/ to draw them', '#666']], { ...st, y: st.y + st.h * 0.3 }, s, 10);
    } else {
        const p = fabPanels(st);
        termitePanel(g, p.form, v, s);
        vesselPanel(g, p.vessel, v, s);
        schematic(g, p.schematic, ledShare(v.live.ledCells), s);
    }
    chain(g, l.chain, [
        ['organoid', '131 · 180 s'],
        ['termites · growth', 'same spikes'],
        [`${FAB_FACTS.termite.lattice} lattice`, 'contours'],
        [termite ? `${termite.segments.length} PLA parts` : 'PLA parts', vessel ? `${vessel.layers.length} clay layers` : 'clay layers'],
        ['frame', 'installed'],
    ], s);
}

const STORIES: Record<MediumKey, (g: G, l: DetailLayout, v: DrawInput) => void> = { visual, sound, solenoids, led, robot, fab };

function drawRail(g: G, l: DetailLayout, v: DrawInput, active: MediumKey): void {
    const s = l.scale, px = fontPx(8, s), live = v.live;
    for (const key of MEDIA) {
        const t = l.railTiles[key];
        g.save();
        clipTo(g, t);
        frame(g, t, key === active ? '#fff' : '#2a2a2a');
        text(g, CARD_TITLES[key].title, t.x + 5 * s, t.y + 4 * s, px, key === active ? '#fff' : '#888');
        const gb: Box = { x: t.x + 5 * s, y: t.y + px * 1.8 + 4 * s, w: t.w - 10 * s, h: t.h - px * 1.8 - 9 * s };
        if (key === 'visual') swarmPanel(g, gb, v.swarms.physarum);
        if (key === 'sound') {
            if (live.sound.source === 'patch' && v.patch) activityStrip(g, gb, v.patch, v.range, live.sound.heardIndex, s);
            else rateLine(g, gb, live.rateHistory, live.rateHead, live.peak);
        }
        if (key === 'solenoids') strikers(g, gb, live.strikeGlow);
        if (key === 'led') ledGrid(g, gb, live.ledCells, live.ledColor, live.ledAgeMs > LED_FACTS.idleMs);
        if (key === 'robot') armsPanel(g, gb, live.arms, s * 0.6, { cone: false, labels: false });
        if (key === 'fab' && v.termite) turningTermite(g, v.artifacts, 'rail-termite', gb, v.termite, v.now, 0.6);
        else if (key === 'fab' && v.vessel) vesselTop(g, gb, v.vessel, v.vesselLayer, 6);
        g.restore();
    }
}

export function drawDetail(g: G, l: DetailLayout, key: MediumKey, v: DrawInput): void {
    g.save();
    g.globalAlpha = v.dim;
    g.font = `${fontPx(9, l.scale)}px ${MONO}`;
    header(g, l, key);
    g.save();
    clipTo(g, l.source);
    if (key === 'robot') robotSource(g, l.source, v);
    else if (key === 'sound' && v.live.sound.source === 'patch') source(g, l.source, v, undefined, 'Max hears activitylevel.wav + burstflags.wav');
    else source(g, l.source, v, key === 'solenoids' ? 'backbone' : undefined);
    g.restore();
    g.save();
    clipTo(g, l.story);
    STORIES[key](g, l, v);
    g.restore();
    drawRail(g, l, v, key);
    g.restore();
}
