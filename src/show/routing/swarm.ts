// Stand-ins for EoC's three swarms, drawn in the Visual card: agents seeded on the neuron
// positions (agent i belongs to neuron i % N, as in EoC), faster while their neuron fires, and
// fleeing the Dispersal that firing termites stamp. A diagram of the mapping, not the Unity render.
// Units are normalized: the swarm lives in a 1 × 1 square.

export interface SwarmSpec {
    perNeuron: number;
    step: number; // per frame at 60 fps
    turn: number; // heading noise, radians per frame
    spread: number; // how far an agent strays from its neuron before turning home
    speedMul: number; // the scene's firingSpeedMul
    align?: boolean; // agents of a neuron share a drifting heading (boids)
}

export const SWARM_SPECS: Record<'physarum' | 'boids' | 'termites', SwarmSpec> = {
    physarum: { perNeuron: 18, step: 0.00175, turn: 0.6, spread: 0.07, speedMul: 2 },
    boids: { perNeuron: 5, step: 0.004, turn: 0.12, spread: 0.12, speedMul: 1.5, align: true },
    termites: { perNeuron: 1, step: 0.0011, turn: 0.9, spread: 0.045, speedMul: 2 },
};

export const FLEE_RADIUS = 0.06;
export const HOME_PAD = 0.06;
const TAU = Math.PI * 2;

export interface Swarm {
    spec: SwarmSpec;
    count: number;
    x: Float64Array;
    y: Float64Array;
    h: Float64Array; // heading
    home: Float64Array; // x, y per neuron
    nh: Float64Array; // shared heading per neuron (align)
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createSwarm(positions: { x: number; y: number }[], spec: SwarmSpec, rand = Math.random): Swarm {
    const n = positions.length;
    const count = n * spec.perNeuron;
    const home = new Float64Array(n * 2);
    positions.forEach((p, k) => {
        home[k * 2] = HOME_PAD + p.x * (1 - 2 * HOME_PAD);
        home[k * 2 + 1] = HOME_PAD + p.y * (1 - 2 * HOME_PAD);
    });
    const s: Swarm = { spec, count, x: new Float64Array(count), y: new Float64Array(count), h: new Float64Array(count), home, nh: new Float64Array(n) };
    for (let i = 0; i < count; i++) {
        const k = i % n, r = rand() * spec.spread, a = rand() * TAU;
        s.x[i] = home[k * 2] + Math.cos(a) * r;
        s.y[i] = home[k * 2 + 1] + Math.sin(a) * r;
        s.h[i] = rand() * TAU;
    }
    for (let k = 0; k < n; k++) s.nh[k] = rand() * TAU;
    return s;
}

/** Advance `frames` (1 at 60 fps). `flee` holds x, y pairs of firing termites, or null. */
export function stepSwarm(s: Swarm, firing: Float32Array, threshold: number, frames: number, flee: number[] | null, rand = Math.random): void {
    const { spec } = s;
    const n = s.nh.length;
    if (spec.align) for (let k = 0; k < n; k++) s.nh[k] += (rand() - 0.5) * 0.2 * frames;
    const r2 = FLEE_RADIUS * FLEE_RADIUS;
    for (let i = 0; i < s.count; i++) {
        const k = i % n;
        let h = s.h[i] + (rand() - 0.5) * spec.turn * frames;
        if (spec.align) h += wrap(s.nh[k] - h) * 0.06 * frames;
        const dx = s.home[k * 2] - s.x[i], dy = s.home[k * 2 + 1] - s.y[i];
        if (dx * dx + dy * dy > spec.spread * spec.spread) h += wrap(Math.atan2(dy, dx) - h) * 0.25;
        let fleeing = false;
        if (flee) {
            for (let j = 0; j < flee.length; j += 2) {
                const ex = s.x[i] - flee[j], ey = s.y[i] - flee[j + 1];
                if (ex * ex + ey * ey < r2) {
                    h += wrap(Math.atan2(ey, ex) - h) * 0.5;
                    fleeing = true;
                    break;
                }
            }
        }
        s.h[i] = h;
        const v = spec.step * (firing[k] >= threshold ? spec.speedMul : 1) * (fleeing ? 2 : 1) * frames;
        s.x[i] += Math.cos(h) * v;
        s.y[i] += Math.sin(h) * v;
    }
}

/** x, y of every termite whose neuron fires: where Dispersal is stamped. */
export function fleeSources(termites: Swarm, firing: Float32Array, threshold: number, out: number[]): number[] {
    out.length = 0;
    for (let i = 0; i < termites.count; i++) {
        if (firing[i % termites.nh.length] >= threshold) out.push(termites.x[i], termites.y[i]);
    }
    return out;
}
