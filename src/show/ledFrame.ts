// LED matrix frames for the serial bridge, shared by the page (local playback) and the OSC
// bridge (the show, imported by Node directly), so both light the LEDs the same way.

export interface LedNeuron {
    x: number;
    y: number;
}

export interface Bounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface LedFrame {
    isBurst: boolean;
    firings: { x: number; y: number }[];
}

export const LED_TRAIL_LENGTH = 5;
// More distinct neurons than this firing in one frame lights all of them at once.
export const LED_BURST_NEURONS = 5;
// Show playhead → LED/sound output: the most data (ms) emitted for one SHOW_STATE tick.
export const SHOW_OUTPUT_MAX_GAP = 30;

export function neuronBounds(neurons: LedNeuron[]): Bounds | null {
    if (neurons.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of neurons) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
    }
    return { minX, maxX, minY, maxY };
}

/** Lookup by neuron_id; the first neuron wins when an id repeats. */
export function neuronsById<N extends { neuron_id: number }>(neurons: N[]): Map<number, N> {
    const byId = new Map<number, N>();
    for (const n of neurons) {
        if (!byId.has(n.neuron_id)) byId.set(n.neuron_id, n);
    }
    return byId;
}

/** Neuron position → 0–15 grid cell on the LED matrix. */
export function ledCell(n: LedNeuron, b: Bounds): { x: number; y: number } {
    const rangeX = b.maxX - b.minX || 1;
    const rangeY = b.maxY - b.minY || 1;
    return {
        x: Math.round(((n.x - b.minX) / rangeX) * 15),
        y: Math.round(((n.y - b.minY) / rangeY) * 15),
    };
}

/** One frame: the neurons that fired join the recent-neuron trail, and the LEDs show either
 *  every firing neuron (a burst) or the trail. frame is null when there is nothing to light. */
export function ledStep<N extends LedNeuron>(
    trail: N[],
    spikeIds: number[],
    neuronById: Map<number, N>,
    bounds: Bounds,
): { trail: N[]; frame: LedFrame | null } {
    const fired = spikeIds.map(id => neuronById.get(id)).filter((n): n is N => n !== undefined);
    const nextTrail = [...trail, ...fired].slice(-LED_TRAIL_LENGTH);
    const isBurst = new Set(spikeIds).size > LED_BURST_NEURONS;
    const firings = (isBurst ? fired : nextTrail).map(n => ledCell(n, bounds));
    return { trail: nextTrail, frame: isBurst || firings.length > 0 ? { isBurst, firings } : null };
}

/** Where a show tick's output starts: after the last emitted index, or just before the
 *  pass start on a new pass / first message — never more than SHOW_OUTPUT_MAX_GAP back, so
 *  a reconnect or a stall emits no backlog burst. Output covers (after, index]. */
export function showOutputAfter(last: number | null, index: number, startIndex: number): number {
    return Math.max(last !== null && last <= index ? last : startIndex - 1, index - SHOW_OUTPUT_MAX_GAP);
}
