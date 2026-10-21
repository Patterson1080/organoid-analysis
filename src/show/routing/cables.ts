// The overview's cables as curves: out of the organoid's rim, through the channel the layout leaves
// around it, into the middle of the card edge that faces it, so every route reads as a cable on any
// screen shape.

import type { Box } from './layout.ts';

export type Point = [number, number];

/** A cubic Bézier: the start, its two handles, the end. */
export interface Cable {
    p0: Point;
    p1: Point;
    p2: Point;
    p3: Point;
}

/** The card edge a cable meets. */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

const HANDLE = 0.5; // handle length, as a share of the start-to-end distance
const RIM_GAP = 3; // the cable starts just outside the organoid's outline
const SPREAD = 0.6; // how far round the rim a cable starts, toward the open space beside the cards

/** A point `along` (0..1) the edge, and the edge's outward normal. */
function onEdge(b: Box, edge: Edge, along: number): { at: Point; n: Point } {
    switch (edge) {
        case 'right': return { at: [b.x + b.w, b.y + b.h * along], n: [1, 0] };
        case 'left': return { at: [b.x, b.y + b.h * along], n: [-1, 0] };
        case 'bottom': return { at: [b.x + b.w * along, b.y + b.h], n: [0, 1] };
        case 'top': return { at: [b.x + b.w * along, b.y], n: [0, -1] };
    }
}

/** From the rim to the middle of `edge`: leaving radially, arriving square to the edge. It starts
 *  round the rim from the straight line, toward the open space beside the cards (above or below the
 *  organoid when the cards are left and right of it), the more so the further off-axis the card is,
 *  so the cables sweep through that space instead of bunching where the cards are closest. */
export function organoidCable(c: { cx: number; cy: number; r: number }, card: Box, edge: Edge): Cable {
    const { at, n } = onEdge(card, edge, 0.5);
    const direct = Math.atan2(at[1] - c.cy, at[0] - c.cx);
    const across = edge === 'left' || edge === 'right';
    const off = across ? Math.sin(direct) : Math.cos(direct); // 0 for a card square across from the centre
    const toward = across ? Math.sign(off) * (Math.PI / 2) : off >= 0 ? 0 : Math.sign(direct || 1) * Math.PI;
    const a = direct + (toward - direct) * SPREAD * Math.abs(off), u: Point = [Math.cos(a), Math.sin(a)];
    const p0: Point = [c.cx + u[0] * (c.r + RIM_GAP), c.cy + u[1] * (c.r + RIM_GAP)];
    const h = HANDLE * Math.hypot(at[0] - p0[0], at[1] - p0[1]);
    return { p0, p1: [p0[0] + u[0] * h, p0[1] + u[1] * h], p2: [at[0] + n[0] * h, at[1] + n[1] * h], p3: at };
}

/** A short cable between neighbouring cards, from the far part of `from`'s edge to the near part of
 *  `to`'s, bowing out by three quarters of `bulge` on that side. */
export function patchArc(from: Box, to: Box, edge: Edge, bulge: number): Cable {
    const a = onEdge(from, edge, 0.8), b = onEdge(to, edge, 0.2);
    return { p0: a.at, p1: [a.at[0] + a.n[0] * bulge, a.at[1] + a.n[1] * bulge], p2: [b.at[0] + b.n[0] * bulge, b.at[1] + b.n[1] * bulge], p3: b.at };
}

export function cablePoint(c: Cable, t: number): Point {
    const u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
    return [
        k0 * c.p0[0] + k1 * c.p1[0] + k2 * c.p2[0] + k3 * c.p3[0],
        k0 * c.p0[1] + k1 * c.p1[1] + k2 * c.p2[1] + k3 * c.p3[1],
    ];
}

/** The direction the cable runs at t, as an angle. */
export function cableAngle(c: Cable, t: number): number {
    const u = 1 - t;
    const dx = 3 * u * u * (c.p1[0] - c.p0[0]) + 6 * u * t * (c.p2[0] - c.p1[0]) + 3 * t * t * (c.p3[0] - c.p2[0]);
    const dy = 3 * u * u * (c.p1[1] - c.p0[1]) + 6 * u * t * (c.p2[1] - c.p1[1]) + 3 * t * t * (c.p3[1] - c.p2[1]);
    return Math.atan2(dy, dx);
}
