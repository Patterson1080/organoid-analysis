// Where everything sits in the routing view, from the space it actually gets: the screen
// changes between shows, landscape or portrait, and presentation uses all of it.

import { organoidCable, patchArc } from './cables.ts';
import type { Cable, Edge } from './cables.ts';
import { AUDIO_COMPUTER, BRIDGE_FED, MEDIA } from './facts.ts';
import type { MediumKey } from './facts.ts';

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface RoutingLayout {
    orientation: 'landscape' | 'portrait';
    centre: { cx: number; cy: number; r: number };
    cards: Record<MediumKey, Box>;
    audioFrame: Box;
    cables: Record<'visual' | 'led' | 'fab' | 'sound', Cable>; // from the organoid: the bridge's three, and /index to the audio computer
    strikes: Cable; // Max to the solenoids
    scale: number;
}

export interface DetailLayout {
    orientation: 'landscape' | 'portrait';
    header: Box;
    source: Box;
    story: Box;
    chain: Box;
    rail: Box;
    railTiles: Record<MediumKey, Box>;
    scale: number;
}

const LANDSCAPE_RATIO = 1.1;
const CABLE_CHANNEL = 0.28; // the cables' room between the organoid and the cards, as a share of its radius
// Each card's share of its column (landscape) or row (portrait), in BRIDGE_FED / AUDIO_COMPUTER order.
const BRIDGE_SHARES = [0.45, 0.25, 0.3];
const AUDIO_SHARES = [0.34, 0.26, 0.4];

/** Text and stroke scale for an area: 1 at 540 px on the short side. */
export const typeScale = (w: number, h: number) => Math.min(1.8, Math.max(0.85, Math.min(w, h) / 540));

export const fontPx = (base: number, scale: number) => Math.max(8, Math.round(base * scale));

export const isLandscape = (w: number, h: number) => w / h >= LANDSCAPE_RATIO;

export const inside = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/** Split [start, start + span] into parts by `shares`, with `gap` between them: [start, length] each. */
function split(start: number, span: number, shares: number[], gap: number): [number, number][] {
    const free = span - gap * (shares.length - 1);
    let at = start;
    return shares.map(share => {
        const part: [number, number] = [at, free * share];
        at += free * share + gap;
        return part;
    });
}

/** Split a box into `n` equal boxes side by side with `gap` between them. */
export function row(b: Box, n: number, gap: number): Box[] {
    const w = (b.w - gap * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => ({ x: b.x + i * (w + gap), y: b.y, w, h: b.h }));
}

export function routingLayout(w: number, h: number): RoutingLayout {
    const scale = typeScale(w, h);
    const m = 12 * scale, g = 10 * scale, band = 16 * scale;
    const cx = w / 2, cy = h / 2;
    const landscape = isLandscape(w, h);
    const r = landscape ? Math.min(0.42 * h, 0.16 * w) : Math.min(0.16 * h, 0.42 * w);
    const ch = Math.max(g, CABLE_CHANNEL * r);
    const cards = {} as Record<MediumKey, Box>;
    let audioFrame: Box;
    if (landscape) {
        const left: Box = { x: m, y: m, w: cx - r - ch - m, h: h - 2 * m };
        audioFrame = { x: cx + r + ch, y: m, w: w - m - (cx + r + ch), h: h - 2 * m };
        split(left.y, left.h, BRIDGE_SHARES, g).forEach(([y, len], i) => { cards[BRIDGE_FED[i]] = { x: left.x, y, w: left.w, h: len }; });
        const inner = { x: audioFrame.x + g / 2, y: audioFrame.y + band, w: audioFrame.w - g, h: audioFrame.h - band - g / 2 };
        split(inner.y, inner.h, AUDIO_SHARES, g).forEach(([y, len], i) => { cards[AUDIO_COMPUTER[i]] = { x: inner.x, y, w: inner.w, h: len }; });
    } else {
        const top: Box = { x: m, y: m, w: w - 2 * m, h: cy - r - ch - m };
        audioFrame = { x: m, y: cy + r + ch, w: w - 2 * m, h: h - m - (cy + r + ch) };
        split(top.x, top.w, BRIDGE_SHARES, g).forEach(([x, len], i) => { cards[BRIDGE_FED[i]] = { x, y: top.y, w: len, h: top.h }; });
        const inner = { x: audioFrame.x + g / 2, y: audioFrame.y + band, w: audioFrame.w - g, h: audioFrame.h - band - g / 2 };
        split(inner.x, inner.w, AUDIO_SHARES, g).forEach(([x, len], i) => { cards[AUDIO_COMPUTER[i]] = { x, y: inner.y, w: len, h: inner.h }; });
    }
    // Each cable meets the card edge that faces the organoid: across the channel, or up or down it.
    const centre = { cx, cy, r }, bridge: Edge = landscape ? 'right' : 'bottom', audio: Edge = landscape ? 'left' : 'top';
    const cables = {
        visual: organoidCable(centre, cards.visual, bridge),
        led: organoidCable(centre, cards.led, bridge),
        fab: organoidCable(centre, cards.fab, bridge),
        sound: organoidCable(centre, cards.sound, audio),
    };
    const strikes = patchArc(cards.sound, cards.solenoids, audio, 0.8 * ch);
    return { orientation: landscape ? 'landscape' : 'portrait', centre, cards, audioFrame, cables, strikes, scale };
}

export function detailLayout(w: number, h: number): DetailLayout {
    const scale = typeScale(w, h);
    const m = 12 * scale, g = 10 * scale;
    const landscape = isLandscape(w, h);
    const header: Box = { x: m, y: m, w: w - 2 * m, h: 36 * scale };
    const railH = Math.max(64, 0.16 * h);
    const rail: Box = { x: m, y: h - m - railH, w: w - 2 * m, h: railH };
    const top = header.y + header.h + g;
    const body: Box = { x: m, y: top, w: w - 2 * m, h: rail.y - g - top };
    let source: Box, story: Box;
    if (landscape) {
        const sw = body.w * 0.28;
        source = { x: body.x, y: body.y, w: sw, h: body.h };
        story = { x: body.x + sw + g, y: body.y, w: body.w - sw - g, h: body.h };
    } else {
        const sh = body.h * 0.3;
        source = { x: body.x, y: body.y, w: body.w, h: sh };
        story = { x: body.x, y: body.y + sh + g, w: body.w, h: body.h - sh - g };
    }
    const chainH = story.h * 0.22;
    const chain: Box = { x: story.x, y: story.y + story.h - chainH, w: story.w, h: chainH };
    const railTiles = {} as Record<MediumKey, Box>;
    split(rail.x, rail.w, MEDIA.map(() => 1 / MEDIA.length), g).forEach(([x, len], i) => { railTiles[MEDIA[i]] = { x, y: rail.y, w: len, h: rail.h }; });
    return { orientation: landscape ? 'landscape' : 'portrait', header, source, story, chain, rail, railTiles, scale };
}

/** The key of the first box containing (x, y), or null. */
export function hitBox<K extends string>(boxes: Record<K, Box>, x: number, y: number): K | null {
    for (const k of Object.keys(boxes) as K[]) if (inside(boxes[k], x, y)) return k;
    return null;
}
