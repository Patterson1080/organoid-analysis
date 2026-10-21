// The central vessel's G-code (PDE_SimulacraNaturae's DifferentialLineSingle export): one
// continuous spiral, grown from this same recording before the show. The routing view shows
// the layer that matches the playhead.

export interface VesselLayer {
    pts: Float32Array; // x, y pairs in mm, centred on the vessel's axis
    radius: number;
}

export interface Vessel {
    layers: VesselLayer[];
    layerMm: number;
    heightMm: number;
    maxRadius: number;
    header: Record<string, string>;
}

const DEFAULT_LAYER_MM = 1.6;
const MOVES_MARKER = ';;; ======'; // the export's priming moves end here

export function parseVesselGcode(text: string, pointsPerLayer = 200): Vessel {
    const lines = text.split('\n');
    const header: Record<string, string> = {};
    for (const line of lines) {
        if (/^G[01]\b/.test(line)) break;
        if (!line.startsWith(';')) continue;
        for (const pair of line.slice(1).split(',')) {
            const eq = pair.indexOf('=');
            if (eq > 0) header[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
        }
    }
    const layerMm = Number(header.layerHeight) > 0 ? Number(header.layerHeight) : DEFAULT_LAYER_MM;

    const marker = lines.findIndex(l => l.startsWith(MOVES_MARKER));
    const moves: number[] = []; // x, y, z triples
    let x = 0, y = 0, z = 0;
    for (const line of lines.slice(marker + 1)) {
        if (!/^G[01]\b/.test(line)) continue;
        let moved = false;
        for (const token of line.split(';')[0].trim().split(/\s+/)) {
            const axis = token[0], value = Number(token.slice(1));
            if (!Number.isFinite(value)) continue;
            if (axis === 'X') { x = value; moved = true; }
            else if (axis === 'Y') { y = value; moved = true; }
            else if (axis === 'Z') { z = value; moved = true; }
        }
        if (moved) moves.push(x, y, z);
    }
    if (moves.length === 0) throw new Error('no toolpath moves');

    let cx = 0, cy = 0, heightMm = 0;
    for (let i = 0; i < moves.length; i += 3) {
        cx += moves[i];
        cy += moves[i + 1];
        heightMm = Math.max(heightMm, moves[i + 2]);
    }
    cx /= moves.length / 3;
    cy /= moves.length / 3;

    const byLayer: number[][] = [];
    for (let i = 0; i < moves.length; i += 3) {
        (byLayer[Math.floor(moves[i + 2] / layerMm)] ??= []).push(moves[i] - cx, moves[i + 1] - cy);
    }
    const layers: VesselLayer[] = [];
    let maxRadius = 0;
    for (const pts of byLayer) {
        if (!pts) continue;
        const have = pts.length / 2, n = Math.min(pointsPerLayer, have);
        const out = new Float32Array(n * 2);
        let radius = 0;
        for (let i = 0; i < n; i++) {
            const k = Math.floor((i * have) / n) * 2;
            out[i * 2] = pts[k];
            out[i * 2 + 1] = pts[k + 1];
        }
        for (let k = 0; k < pts.length; k += 2) radius = Math.max(radius, Math.hypot(pts[k], pts[k + 1]));
        layers.push({ pts: out, radius });
        maxRadius = Math.max(maxRadius, radius);
    }
    if (layers.length === 0) throw new Error('no toolpath layers'); // e.g. every move below the bed
    return { layers, layerMm, heightMm, maxRadius, header };
}

/** The layer grown at this point of the recording: linear (≈), since the sketch only adds a
 *  layer while a neuron fires and the G-code keeps no timestamps. */
export function layerForIndex(v: Vessel, index: number, frames = 180000): number {
    return Math.min(v.layers.length - 1, Math.max(0, Math.floor((index / frames) * v.layers.length)));
}

/** How many layers were printed: all of them, or those below `printedMm` when the print stopped early. */
export function printedLayers(v: Vessel, printedMm: number | null): number {
    if (printedMm === null) return v.layers.length;
    return Math.min(v.layers.length, Math.max(0, Math.floor(printedMm / v.layerMm)));
}
