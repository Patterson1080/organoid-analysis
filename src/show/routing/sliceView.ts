// The FAB card's view of both artifacts as stacks of print layers: the vessel's G-code layers and the
// termite form's slices in one shape, and how densely to draw so the layers stay readable at any size.

import type { Box } from './layout.ts';
import { isLandscape, typeScale } from './layout.ts';
import type { TermiteSlices } from './termiteSlices.ts';
import type { Vessel } from './vessel.ts';

export interface StackSlice {
    y: number; // height of the layer
    lines: Float32Array[]; // x, z pairs
    segment: number; // the termite form's print segment (0 = bottom); −1 for the vessel
}

/** The vessel's layers, each closed into a loop at its own height. */
export function vesselStack(v: Vessel): StackSlice[] {
    return v.layers.map((layer, i) => {
        const pts = layer.pts, loop = new Float32Array(pts.length + 2);
        loop.set(pts);
        loop[pts.length] = pts[0];
        loop[pts.length + 1] = pts[1];
        return { y: (i + 1) * v.layerMm, lines: [loop], segment: -1 };
    });
}

/** The termite form's slices bottom to top; segment k lifts by k·explode, opening the seams. */
export function termiteStack(t: TermiteSlices, explode: number): StackSlice[] {
    return t.segments.flatMap((seg, k) => seg.slices.map(s => ({ y: s.y + k * explode, lines: s.lines, segment: k })));
}

/** Draw every n-th slice, so neighbours stay at least minGapPx apart on screen. */
export function sliceStride(slices: number, spanPx: number, minGapPx = 3): number {
    if (slices <= 0 || spanPx <= 0) return 1;
    return Math.max(1, Math.ceil(minGapPx / (spanPx / slices)));
}

/** Front of the form (depth +radius) full, back (−radius) a quarter. */
export function depthAlpha(depth: number, radius: number): number {
    const t = radius > 0 ? (depth + radius) / (2 * radius) : 1;
    return 0.25 + 0.75 * Math.min(1, Math.max(0, t));
}

/** The two artifacts as they stand: side by side on one ground line at one scale (mm per pixel),
 *  the pair centred in the box. Sizes are their drawn extents in mm; either may be missing. */
export function pairLayout(box: Box, termite: { w: number; h: number } | null, vessel: { w: number; h: number } | null, gap: number):
    { termite: Box | null; vessel: Box | null; mmPerPx: number } {
    const items = [termite, vessel].filter((x): x is { w: number; h: number } => x !== null && x.w > 0 && x.h > 0);
    if (items.length === 0) return { termite: null, vessel: null, mmPerPx: 1 };
    const gaps = gap * (items.length - 1), sumW = items.reduce((a, x) => a + x.w, 0), maxH = Math.max(...items.map(x => x.h));
    const k = Math.min((box.w - gaps) / sumW, box.h / maxH); // pixels per mm
    const ground = box.y + box.h;
    let x = box.x + (box.w - (sumW * k + gaps)) / 2;
    const place = (o: { w: number; h: number } | null): Box | null => {
        if (!o || o.w <= 0 || o.h <= 0) return null;
        const b = { x, y: ground - o.h * k, w: o.w * k, h: o.h * k };
        x += b.w + gap;
        return b;
    };
    const t = place(termite);
    return { termite: t, vessel: place(vessel), mmPerPx: 1 / k };
}

/** Landscape: the termite form on the left (55 %), the vessel over the schematic on the right.
 *  Portrait: the form on top, the vessel and the schematic side by side below. */
export function fabPanels(story: Box): { form: Box; vessel: Box; schematic: Box } {
    const g = 10 * typeScale(story.w, story.h);
    const pos = (n: number) => Math.max(1, n);
    if (isLandscape(story.w, story.h)) {
        const fw = pos((story.w - g) * 0.55), rx = story.x + fw + g, rw = pos(story.w - fw - g);
        const vh = pos((story.h - g) * 0.62);
        return {
            form: { x: story.x, y: story.y, w: fw, h: story.h },
            vessel: { x: rx, y: story.y, w: rw, h: vh },
            schematic: { x: rx, y: story.y + vh + g, w: rw, h: pos(story.h - vh - g) },
        };
    }
    const fh = pos((story.h - g) * 0.52), by = story.y + fh + g, bh = pos(story.h - fh - g);
    const vw = pos((story.w - g) * 0.58);
    return {
        form: { x: story.x, y: story.y, w: story.w, h: fh },
        vessel: { x: story.x, y: by, w: vw, h: bh },
        schematic: { x: story.x + vw + g, y: by, w: pos(story.w - vw - g), h: bh },
    };
}
