// One medium full size: its source, its story drawn large, the signal chain with live values,
// and a rail of all six media to step between them.

import { firingCaption, pad6, sourceCaption } from '../../show/routing/captions';
import { ATTRIBUTION, CARD_TITLES, LED_FACTS, MEDIA, ROBOT_FACTS, SOLENOID_FACTS, SOUND_FACTS, VESSEL_FACTS, VISUAL_FACTS, VISUAL_OUTPUT_CHAINS } from '../../show/routing/facts';
import type { MediumKey } from '../../show/routing/facts';
import type { Box, DetailLayout } from '../../show/routing/layout';
import { fontPx } from '../../show/routing/layout';
import { expectedKicks } from '../../show/routing/maxPatch';
import type { PatchData } from '../../show/routing/maxPatch';
import { paperMappings } from '../../show/routing/soundFeatures';
import { soundPanels } from '../../show/routing/soundLayout';
import { printedLayers } from '../../show/routing/vessel';
import { MONO, arrowHead, clipTo, fitSquare, frame, hangingArms, ledGrid, lines, neuronMap, rateLine, strikers, swarmPanel, text, vesselProfile, vesselTop } from './glyphs';
import type { G } from './glyphs';
import { firingCount, row } from './overview';
import { activityStrip, grainsPerSecond, harmony, perSecond, rules, score, speakers } from './soundGlyphs';
import type { DrawInput, SwarmKey } from './overview';

const CLOSE_LABEL = '× ROUTING';

/** The `× ROUTING` target at the header's right end. */
export function closeBox(l: DetailLayout): Box {
    const w = 110 * l.scale;
    return { x: l.header.x + l.header.w - w, y: l.header.y, w, h: l.header.h };
}

const gapOf = (s: number) => 10 * s;

/** Boxes in a row joined by arrows: [title, live value] each. */
function chain(g: G, b: Box, items: [string, string][], s: number) {
    const gap = 14 * s, h = Math.min(b.h, 46 * s);
    const cells = row({ x: b.x, y: b.y + (b.h - h) / 2, w: b.w, h }, items.length, gap);
    cells.forEach((c, i) => {
        frame(g, c, '#333');
        g.save();
        clipTo(g, c);
        lines(g, [[items[i][0], '#e6e6e6'], [items[i][1], '#888']], { x: c.x + 6 * s, y: c.y + 6 * s, w: c.w - 12 * s, h: c.h - 12 * s }, s, 9);
        g.restore();
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
    const map = { ...b, h: b.h - px * 6 };
    frame(g, fitSquare(map), '#1e1e1e');
    if (v.live.neurons.length) neuronMap(g, map, v.live.neurons, v.live.spikeGlow, s, only);
    const heard = heardAs ?? (only ? `${v.live.backboneSlots.length} backbone neurons of ${v.live.neurons.length}` : `${v.live.neurons.length} neurons · spikes`);
    lines(g, sourceCaption(v.phase, v.index, heard), { x: b.x, y: map.y + map.h + px * 0.6, w: b.w, h: px * 5.5 }, s, 10);
}

/** The story area above the chain. */
const storyTop = (l: DetailLayout): Box => ({ ...l.story, h: l.story.h - l.chain.h - gapOf(l.scale) });

function visual(g: G, l: DetailLayout, v: DrawInput) {
    const s = l.scale, st = storyTop(l), px = fontPx(9, s);
    const keys: SwarmKey[] = ['physarum', 'boids', 'termites'];
    const panelsH = st.h * 0.58;
    row({ ...st, h: panelsH }, 3, 12 * s).forEach((cell, i) => {
        const facts = VISUAL_FACTS.swarms[keys[i]];
        const labelH = px * 4.4;
        swarmPanel(g, { ...cell, h: cell.h - labelH }, v.swarms[keys[i]]);
        g.save();
        clipTo(g, { ...cell, y: cell.y + cell.h - labelH, h: labelH });
        lines(g, [
            [`${facts.label} · ${facts.agents} · ${facts.types} type${facts.types > 1 ? 's' : ''}`, '#e6e6e6'],
            [`firing → speed ×${facts.speedMul}`, '#999'],
            [`deposit ${facts.deposit}`, '#777'],
        ], { x: cell.x, y: cell.y + cell.h - labelH + 4 * s, w: cell.w, h: labelH }, s, 9);
        g.restore();
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
    g.save();
    clipTo(g, below);
    lines(g, [
        [live.firingSource === 'blob' ? `spikes (cyan) vs the normalized rate EoC reads (bars) · line = ${VISUAL_FACTS.threshold}` : `${firingCaption(live.firingSource, live.neurons.length, 0)} (data/${VISUAL_FACTS.blob})`, '#999'],
        ['pass  /sim_resetSimsOnly → /sim_on 5 → T ×5 · P ×10 → /sim_off 5 → 2 min dark, sims paused', '#777'],
        ['one pass = one day: the diurnal sun sweeps the temperature field once per /index pass', '#777'],
        [`out  ${VISUAL_OUTPUT_CHAINS[v.visualOutput].join(' → ')}`, '#bbb'],
        [VISUAL_FACTS.drawnNote, '#555'],
    ], below, s, 9);
    g.restore();
    chain(g, l.chain, [
        [`/index ${v.index === null ? '——————' : pad6(v.index)}`, `OSC int · ${VISUAL_FACTS.fps}/s`],
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
    const playing = v.live.moving ? 'the last 10 s, drawn like Max draws them' : 'Max plays on at the last values';
    text(g, `VOICES · ${playing}`, p.score.x, p.score.y, px, '#ddd');
    const strip: Box = { x: p.score.x, y: p.score.y + px * 1.6, w: p.score.w, h: Math.max(8, p.score.h * 0.14) };
    activityStrip(g, strip, patch, v.range, sv.heardIndex, s);
    const below = strip.y + strip.h + 6 * s;
    score(g, { ...p.score, y: below, h: Math.max(8, p.score.y + p.score.h - below) }, sv, v.now, s);
    rules(g, p.rules, sv, s);
    harmony(g, p.harmony, sv, v.index, v.mode, s);
    speakers(g, p.output, sv, v.now, s);
    chain(g, l.chain, [
        [`/index ${v.index === null ? '——————' : pad6(v.index)}`, 'OSC → audio computer'],
        ['peek~ activity · flags', `v ${sv.v.toFixed(3)} · flag ${sv.flagsSoFar}`],
        ['a = v / 0.9668', sv.a.toFixed(3)],
        ['tones · grains · kick', `${perSecond(sv.toneMs).toFixed(1)} · ${grainsPerSecond(sv).toFixed(0)} · ${(perSecond(sv.kickMs) * expectedKicks()).toFixed(2)} /s`],
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
    const sl = live.soundLive, tag = (k: keyof typeof sl) => (sl[k] !== undefined ? ' · LIVE' : '');
    const tones = sl.tones ?? m.toneDensity, grains = sl.grains ?? m.grainDensity, kick = sl.kick ?? m.kickDensity;
    bar(g, cols[0], span(SOUND_FACTS.tone, tones), `tones √ ${tones.toFixed(2)}/s${tag('tones')}`, s);
    bar(g, cols[1], span(SOUND_FACTS.grains, grains), `grains ⁶√⁻¹ ${grains.toFixed(1)}/s${tag('grains')}`, s);
    bar(g, cols[2], span(SOUND_FACTS.grainMs, m.grainMs), `grain ${m.grainMs.toFixed(0)} ms`, s);
    bar(g, cols[3], span(SOUND_FACTS.kick, kick), `kick ${kick.toFixed(2)}/s · ${SOUND_FACTS.kickPitch}${tag('kick')}`, s);
    const textBox: Box = { x: st.x, y: cols[0].y + cols[0].h + 10 * s, w: st.w, h: st.y + st.h - (cols[0].y + cols[0].h + 10 * s) };
    g.save();
    clipTo(g, textBox);
    lines(g, [
        [`link activitylevel.wav + burstflags.wav (dev/audio) into data/ for the patch's own values (${SOUND_FACTS.patchFile})`, '#bbb'],
        [`ranges: ${SOUND_FACTS.rangesSource} · rate normalized to this recording's peak (${live.peak}/100 ms)`, '#777'],
        [`${SOUND_FACTS.descriptionSource}: population firing rate → synthesis density and spatialization; burst endpoints → harmonic transitions`, '#999'],
        [`${SOUND_FACTS.harmony} · distorted electric guitar · ${SOUND_FACTS.channels} ch · a reverb per channel${sl.harmony !== undefined ? ` · harmonic step ${sl.harmony} (LIVE)` : ''}`, '#999'],
        ['← robot sensors over serial  ·  → 27 solenoids', '#bbb'],
        [live.rateSource === 'live' ? 'LIVE · rate from the patch' : SOUND_FACTS.badge, live.rateSource === 'live' ? '#fff' : '#555'],
    ], textBox, s, 9);
    g.restore();
    chain(g, l.chain, [
        [`/index ${v.index === null ? '——————' : pad6(v.index)}`, 'OSC → audio computer'],
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
    g.save();
    clipTo(g, logBox);
    const log = live.strikeLog.slice().reverse().map(e => [`slot ${String(e.slot).padStart(2, '0')} · neuron ${e.neuronId} · t ${pad6(e.t)}`, '#999'] as [string, string]);
    lines(g, [
        ['one solenoid per backbone neuron, in the ceramic vessels and suspended glassware', '#bbb'],
        [`Max sends line index + 1 of ${SOLENOID_FACTS.file} as <27 digits> to the ${SOLENOID_FACTS.board}; all off ${SOLENOID_FACTS.releaseMs} ms after the last line`, '#999'],
        [live.strikeSource === 'live' ? `LIVE · ${live.strikes} strikes from the patch` : `≈ computed from the 27 backbone spike columns · ${live.strikes} strikes`, live.strikeSource === 'live' ? '#fff' : '#555'],
        ...log,
    ], logBox, s, 9);
    g.restore();
    chain(g, l.chain, [
        [`/index ${v.index === null ? '——————' : pad6(v.index)}`, 'OSC → audio computer'],
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
    g.save();
    clipTo(g, side);
    const age = live.lastLedFrame ? `last frame ${Math.round(live.ledAgeMs)} ms ago` : 'no frame yet';
    lines(g, [
        ['serial lines', '#888'],
        ...(live.ledLines.length ? live.ledLines : ['—']).map(line => [line, '#ddd'] as [string, string]),
        ['', '#000'],
        [age, '#777'],
        [`${LED_FACTS.idleMs / 1000} s without frames → white idle shimmer`, '#555'],
        ['two matrices in laser-cut frames; fibers carry the light into the glassware with the plants', '#777'],
    ], side, s, 9);
    g.restore();
    chain(g, l.chain, [
        ['ledStep', `trail ${LED_FACTS.trail} · burst >${LED_FACTS.burstOver}`],
        ['SERIAL_SYNC', 'WebSocket :8081'],
        [`F: / C: ≤${LED_FACTS.perFrameCap}`, `${live.ledFrames} frames`],
        [`USB ${LED_FACTS.baud}`, 'Arduino'],
        ['2 × 16×16', '→ fiber optics'],
    ], s);
}

function robot(g: G, l: DetailLayout, v: DrawInput) {
    const s = l.scale, st = storyTop(l), live = v.live;
    const armsBox: Box = { ...st, h: st.h * 0.62 };
    hangingArms(g, armsBox, live.arms, s);
    const textBox: Box = { x: st.x, y: armsBox.y + armsBox.h + 10 * s, w: st.w, h: st.y + st.h - (armsBox.y + armsBox.h + 10 * s) };
    g.save();
    clipTo(g, textBox);
    lines(g, [
        ...live.arms.map((a, k) => [`arm ${k + 1} · ${a.proximity.toFixed(2)} m · servo ${Math.round(a.servo)}°${a.touch ? ' · touched' : ''} · ${a.live ? 'LIVE' : 'simulated'}`, a.live ? '#fff' : '#999'] as [string, string]),
        ['hung upside down: gravity swings each arm as its servo turns', '#777'],
        ['→ sensor values over serial to Max, where they shape the composition', '#bbb'],
        [`┄ ${ROBOT_FACTS.dormant}`, '#555'],
        [live.arms.some(a => a.live) ? 'LIVE · from the audio computer' : ROBOT_FACTS.badge, live.arms.some(a => a.live) ? '#fff' : '#555'],
    ], textBox, s, 9);
    g.restore();
    chain(g, l.chain, [
        ['visitor', 'proximity · touch'],
        [ROBOT_FACTS.sensor, 'ultrasonic · leaves capacitive'],
        ['Arduino', `→ ${ROBOT_FACTS.servo} 0–180°`],
        ['serial', '→ Max/MSP'],
        ['sound', 'the composition'],
    ], s);
}

function robotSource(g: G, b: Box, v: DrawInput) {
    const s = v.scale;
    text(g, 'VISITORS', b.x, b.y, fontPx(10, s), '#fff');
    const bars = row({ x: b.x, y: b.y + fontPx(10, s) * 2, w: b.w, h: Math.min(b.h * 0.6, 180 * s) }, v.live.arms.length, 10 * s);
    v.live.arms.forEach((a, k) => {
        const c = bars[k], fill = Math.max(0, Math.min(1, 1 - a.proximity / 3));
        frame(g, c, '#222');
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillRect(c.x + 2, c.y + c.h * (1 - fill), c.w - 4, c.h * fill);
        text(g, `${k + 1}`, c.x + c.w / 2, c.y + c.h + 4 * s, fontPx(9, s), '#888', 'center');
    });
    text(g, 'closer = taller', b.x, bars[0].y + bars[0].h + fontPx(9, s) * 2.2, fontPx(8, s), '#555');
    lines(g, [[ATTRIBUTION, '#5a5a5a']], { x: b.x, y: b.y + b.h - fontPx(10, s) * 3, w: b.w, h: fontPx(10, s) * 3 }, s, 10);
}

function fab(g: G, l: DetailLayout, v: DrawInput) {
    const s = l.scale, st = storyTop(l), vessel = v.vessel;
    if (!vessel) {
        lines(g, [['no vessel data (data/vessel.gcode)', '#999'], ['the vessel is grown from this recording before the show; link its G-code into data/ to show the layer', '#666']], { ...st, y: st.y + st.h * 0.3 }, s, 10);
    } else {
        const px = fontPx(9, s);
        const side: Box = { x: st.x + 40 * s, y: st.y + px, w: st.w * 0.22, h: st.h - 2 * px };
        const printed = printedLayers(vessel, VESSEL_FACTS.printedMm);
        vesselProfile(g, side, vessel, v.vesselLayer, printed);
        text(g, `${Math.round(vessel.heightMm)} mm`, side.x - 6 * s, side.y - px / 2, px, '#666', 'right');
        text(g, '0', side.x - 6 * s, side.y + side.h - px, px, '#666', 'right');
        const z = Math.round((v.vesselLayer + 1) * vessel.layerMm);
        const yk = side.y + side.h - ((v.vesselLayer + 0.5) / vessel.layers.length) * side.h;
        text(g, `${z} mm`, side.x - 6 * s, yk - px / 2, px, '#fff', 'right');
        if (printed < vessel.layers.length) text(g, 'not printed', side.x + side.w / 2, side.y, px, '#555', 'center');
        const top: Box = { x: st.x + st.w * 0.3, y: st.y, w: st.w * 0.38, h: st.h };
        vesselTop(g, top, vessel, v.vesselLayer, 24);
        const info: Box = { x: st.x + st.w * 0.7, y: st.y, w: st.w * 0.3, h: st.h };
        g.save();
        clipTo(g, info);
        let y = lines(g, [
            [`layer ${v.vesselLayer + 1} / ${vessel.layers.length} ≈`, '#fff'],
            [`z ${z} mm`, '#bbb'],
            ['linear in the recording: the sketch adds a layer only while a neuron fires', '#666'],
            [`${VESSEL_FACTS.file} · ${vessel.layers.length} × ${vessel.layerMm} mm spiral · nozzle ${vessel.header.nozzle ?? '?'}`, '#888'],
            [`${VESSEL_FACTS.clay} · ${VESSEL_FACTS.printer} (${VESSEL_FACTS.source})`, '#777'],
        ], info, s, 9);
        y += px;
        const mounds: Box = { x: info.x, y, w: info.w, h: Math.min(px * 5, info.y + info.h - y) };
        g.setLineDash([3 * s, 3 * s]);
        frame(g, mounds, '#333');
        g.setLineDash([]);
        text(g, 'termite mounds · files to come', mounds.x + 6 * s, mounds.y + 6 * s, px, '#555');
        g.restore();
    }
    chain(g, l.chain, [
        ['recording', '131 neurons · 0–180 s'],
        ['growth sim', '5 min · impulse per spike'],
        ['layer on firing', vessel ? `${vessel.layers.length} layers` : '—'],
        [vessel ? `${vessel.layers.length} × ${vessel.layerMm} mm` : 'spiral', 'one continuous spiral'],
        ['G-code', `${VESSEL_FACTS.printer.split(' ')[0]} · stoneware`],
    ], s);
}

const STORIES: Record<MediumKey, (g: G, l: DetailLayout, v: DrawInput) => void> = { visual, sound, solenoids, led, robot, fab };

export function drawRail(g: G, l: DetailLayout, v: DrawInput, active: MediumKey): void {
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
        if (key === 'robot') hangingArms(g, gb, live.arms, s * 0.6);
        if (key === 'fab' && v.vessel) vesselTop(g, gb, v.vessel, v.vesselLayer, 6);
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
