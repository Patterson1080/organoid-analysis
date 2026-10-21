// Horizontal slices of a triangle mesh, as a slicer cuts a form into print layers: each triangle
// that crosses a height leaves one segment, segments chain through their shared edges into
// polylines (x, z pairs), and Ramer–Douglas–Peucker keeps only the points the shape needs.

export interface Mesh {
    V: Float32Array; // x, y, z per vertex
    F: Uint32Array; // three vertex indices per face
}

export interface Slice {
    y: number;
    lines: Float32Array[]; // x, z pairs
}

/** One height per step, each in the middle of its step: yMin + (s + ½)·step below yMax. */
export function sliceHeights(yMin: number, yMax: number, step: number): number[] {
    const out: number[] = [];
    for (let s = 0; yMin + (s + 0.5) * step < yMax; s++) out.push(yMin + (s + 0.5) * step);
    return out;
}

/** First i with heights[i] ≥ y. */
function lowerBound(heights: number[], y: number): number {
    let lo = 0;
    let hi = heights.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (heights[mid] < y) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

interface Segments {
    keys: number[]; // per endpoint: the crossed edge (sorted vertex pair)
    pts: number[]; // per endpoint: x, z
}

/** The faces' contours at each of the heights their range spans (heights sorted ascending). */
export function sliceMesh(mesh: Mesh, faceStart: number, faceEnd: number, heights: number[]): Slice[] {
    const { V, F } = mesh;
    const n = V.length / 3;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let f = faceStart; f < faceEnd; f++) {
        for (let k = 0; k < 3; k++) {
            const y = V[F[f * 3 + k] * 3 + 1];
            if (y < yMin) yMin = y;
            if (y > yMax) yMax = y;
        }
    }
    const first = lowerBound(heights, yMin);
    let last = first;
    while (last < heights.length && heights[last] <= yMax) last++;
    const bins: Segments[] = Array.from({ length: last - first }, () => ({ keys: [], pts: [] }));

    for (let f = faceStart; f < faceEnd; f++) {
        const tri = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]];
        const ys = tri.map(v => V[v * 3 + 1]);
        const lo = Math.min(ys[0], ys[1], ys[2]), hi = Math.max(ys[0], ys[1], ys[2]);
        for (let s = Math.max(first, lowerBound(heights, lo)); s < last && heights[s] <= hi; s++) {
            const h = heights[s], bin = bins[s - first];
            let crossed = 0;
            for (let e = 0; e < 3; e++) {
                const p = tri[e], q = tri[(e + 1) % 3], yp = V[p * 3 + 1], yq = V[q * 3 + 1];
                if (yp < h === yq < h) continue; // a vertex on the plane counts as above it
                const t = (h - yp) / (yq - yp);
                bin.keys.push(p < q ? p * n + q : q * n + p);
                bin.pts.push(V[p * 3] + t * (V[q * 3] - V[p * 3]), V[p * 3 + 2] + t * (V[q * 3 + 2] - V[p * 3 + 2]));
                crossed++;
            }
            if (crossed !== 2) { // only a plane through a vertex can do this; drop the odd ends
                bin.keys.length -= crossed;
                bin.pts.length -= crossed * 2;
            }
        }
    }
    return bins.map((bin, i) => ({ y: heights[first + i], lines: chain(bin) }));
}

/** Join segments that share an edge crossing into polylines; a loop ends on its first point. */
function chain({ keys, pts }: Segments): Float32Array[] {
    const ends = new Map<number, number[]>();
    keys.forEach((k, e) => {
        const at = ends.get(k);
        if (at) at.push(e);
        else ends.set(k, [e]);
    });
    const segments = keys.length / 2;
    const used = new Uint8Array(segments);
    const walk = (from: number): number[] => {
        const out: number[] = [];
        for (let cur = from; ;) {
            const next = ends.get(keys[cur])?.find(e => !used[e >> 1]);
            if (next === undefined) return out;
            used[next >> 1] = 1;
            cur = next ^ 1; // the segment's other end
            out.push(pts[cur * 2], pts[cur * 2 + 1]);
        }
    };
    const lines: Float32Array[] = [];
    for (let i = 0; i < segments; i++) {
        if (used[i]) continue;
        used[i] = 1;
        const forward = walk(i * 2 + 1), back = walk(i * 2);
        const line: number[] = [];
        for (let j = back.length - 2; j >= 0; j -= 2) line.push(back[j], back[j + 1]);
        line.push(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3], ...forward);
        lines.push(Float32Array.from(line));
    }
    return lines;
}

/** Ramer–Douglas–Peucker over x, z pairs; both ends stay. A closed run (first = last) measures
 *  from its first point until it has split. */
export function rdp(pts: Float32Array, tol: number): Float32Array {
    const n = pts.length / 2;
    if (n < 3) return pts.slice();
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack: [number, number][] = [[0, n - 1]];
    while (stack.length) {
        const [a, b] = stack.pop() as [number, number];
        const ax = pts[a * 2], az = pts[a * 2 + 1], dx = pts[b * 2] - ax, dz = pts[b * 2 + 1] - az;
        const len = Math.hypot(dx, dz);
        let far = -1;
        let farD = tol;
        for (let i = a + 1; i < b; i++) {
            const px = pts[i * 2] - ax, pz = pts[i * 2 + 1] - az;
            const d = len > 0 ? Math.abs(dx * pz - dz * px) / len : Math.hypot(px, pz);
            if (d > farD) {
                farD = d;
                far = i;
            }
        }
        if (far >= 0) {
            keep[far] = 1;
            stack.push([a, far], [far, b]);
        }
    }
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
    return Float32Array.from(out);
}
