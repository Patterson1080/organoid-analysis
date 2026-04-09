import { Neuron, SpikeEvent } from '../types';
import { polygonHull } from 'd3-polygon';

export interface Hyperedge {
    id: string; // unique identifier
    neurons: number[]; // Array of neuron_ids
    centroid: { x: number, y: number };
    size: number;
    backboneCount: number;
    points: [number, number][]; // Required for UI drawing
    hull: [number, number][]; // Convex hull polygon for rendering
    trackId?: number; // Added for temporal tracking
}

export interface HypergraphTrack {
    trackId: number;
    colorIndex: number; // Stable color index for rendering
    centroids: { x: number, y: number, time: number }[]; // Path across bins
}

export interface HypergraphFrame {
    timeStart: number;
    timeEnd: number;
    activeNeurons: number[];
    hyperedges: Hyperedge[];
}

export interface HypergraphSequenceResult {
    frames: HypergraphFrame[];
    tracks: HypergraphTrack[];
}

/**
 * Computes hyperedges based on spatial proximity over a single time bin.
 */
export function computeHyperedges(
    spikes: SpikeEvent[],
    neurons: Neuron[],
    timeStart: number,
    timeEnd: number,
    eps: number,
    minSize: number
): HypergraphFrame {
    // 1. Identify active neurons
    const activeNeuronIds = new Set<number>();
    for (const spike of spikes) {
        if (spike.timestamp_ms >= timeStart && spike.timestamp_ms < timeEnd) {
            activeNeuronIds.add(spike.neuron_id);
        }
    }

    const activeIdsArray = Array.from(activeNeuronIds);
    if (activeIdsArray.length < minSize) {
        return { timeStart, timeEnd, activeNeurons: activeIdsArray, hyperedges: [] };
    }

    // Map active neurons to their records for spatial data
    const activeNeuronsData = activeIdsArray
        .map(id => neurons.find(n => n.neuron_id === id))
        .filter((n): n is Neuron => n !== undefined);

    // 2. Connected Components clustering
    // Build adjacency list based on distance
    const adjList: number[][] = Array(activeNeuronsData.length).fill(0).map(() => []);

    for (let i = 0; i < activeNeuronsData.length; i++) {
        for (let j = i + 1; j < activeNeuronsData.length; j++) {
            const n1 = activeNeuronsData[i];
            const n2 = activeNeuronsData[j];
            // Distance in normalized xy space 
            const dx = n1.xy_norm_0 - n2.xy_norm_0;
            const dy = n1.xy_norm_1 - n2.xy_norm_1;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= eps) {
                adjList[i].push(j);
                adjList[j].push(i);
            }
        }
    }

    // Find connected components
    const visited = new Array(activeNeuronsData.length).fill(false);
    const components: Neuron[][] = [];

    for (let i = 0; i < activeNeuronsData.length; i++) {
        if (!visited[i]) {
            const currentComponent: Neuron[] = [];
            const queue = [i];
            visited[i] = true;

            while (queue.length > 0) {
                const curr = queue.shift()!;
                currentComponent.push(activeNeuronsData[curr]);

                for (const neighbor of adjList[curr]) {
                    if (!visited[neighbor]) {
                        visited[neighbor] = true;
                        queue.push(neighbor);
                    }
                }
            }

            if (currentComponent.length >= minSize) {
                components.push(currentComponent);
            }
        }
    }

    // 3. Build Hyperedge objects
    const hyperedges: Hyperedge[] = components.map((comp, idx) => {
        const neuronIds = comp.map(n => n.neuron_id);
        const points: [number, number][] = comp.map(n => [n.xy_norm_0, n.xy_norm_1]);
        const backboneCount = comp.filter(n => n.is_backbone).length;

        // Calculate centroid
        const sumX = points.reduce((acc, p) => acc + p[0], 0);
        const sumY = points.reduce((acc, p) => acc + p[1], 0);
        const centroid = {
            x: sumX / points.length,
            y: sumY / points.length
        };

        // Compute hull
        let hull: [number, number][] = [];
        if (points.length >= 3) {
            // d3 polygonHull can return null if points are collinear or identical
            const computedHull = polygonHull(points);
            if (computedHull && computedHull.length > 0) {
                hull = computedHull;
            } else {
                // Fallback to bounding box or just lines if hull fails
                hull = [...points];
            }
        } else {
            // For pairs (size = 2), the hull is just the line segment
            hull = [...points];
        }

        return {
            id: `HE_${timeStart}_${idx}`,
            neurons: neuronIds,
            points,
            centroid,
            size: comp.length,
            backboneCount,
            hull
        };
    });

    return {
        timeStart,
        timeEnd,
        activeNeurons: activeIdsArray,
        hyperedges
    };
}

/**
 * Runs the sliding window computation over the current target history window.
 */
export function computeHypergraphSequence(
    spikes: SpikeEvent[],
    neurons: Neuron[],
    currentTime: number,
    windowLengthMs: number, // e.g. 1000 for 1s
    binSizeMs: number,       // e.g. 20ms bins
    eps: number,
    minSize: number,
    computeTracks: boolean = false,
    matchThreshold: number = 0.2,
    maxLinkDist?: number | null
): HypergraphSequenceResult {
    const sequence: HypergraphFrame[] = [];
    const startTime = Math.max(0, currentTime - windowLengthMs);

    // Filter spikes once for the whole window for performance
    const windowSpikes = spikes.filter(s => s.timestamp_ms >= startTime && s.timestamp_ms < currentTime);

    // Compute bins
    for (let t = startTime; t < currentTime; t += binSizeMs) {
        const tEnd = t + binSizeMs;
        const frame = computeHyperedges(windowSpikes, neurons, t, tEnd, eps, minSize);
        sequence.push(frame);
    }

    const tracks: HypergraphTrack[] = [];

    if (computeTracks && sequence.length > 1) {
        let nextTrackId = 1;

        // Give initial track IDs to the first frame
        sequence[0].hyperedges.forEach(he => {
            he.trackId = nextTrackId;
            tracks.push({
                trackId: nextTrackId,
                colorIndex: nextTrackId, // stable color
                centroids: [{ x: he.centroid.x, y: he.centroid.y, time: sequence[0].timeStart }]
            });
            nextTrackId++;
        });

        // Compute tracks across consecutive frames
        for (let i = 0; i < sequence.length - 1; i++) {
            const currentFrame = sequence[i];
            const nextFrame = sequence[i + 1];

            // Build potential matches
            const matches: { currIdx: number, nextIdx: number, jaccard: number }[] = [];

            for (let c = 0; c < currentFrame.hyperedges.length; c++) {
                const currHe = currentFrame.hyperedges[c];
                const setA = new Set(currHe.neurons);

                for (let n = 0; n < nextFrame.hyperedges.length; n++) {
                    const nextHe = nextFrame.hyperedges[n];
                    const setB = new Set(nextHe.neurons);

                    // Jaccard = Intersection / Union
                    const intersection = new Set([...setA].filter(x => setB.has(x)));
                    const union = new Set([...setA, ...setB]);
                    const jaccard = intersection.size / union.size;

                    // Support optional Max Centroid Distance limit
                    let withinDist = true;
                    if (maxLinkDist !== undefined && maxLinkDist !== null) {
                        const dx = currHe.centroid.x - nextHe.centroid.x;
                        const dy = currHe.centroid.y - nextHe.centroid.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist > maxLinkDist) {
                            withinDist = false;
                        }
                    }

                    if (jaccard >= matchThreshold && withinDist) {
                        matches.push({ currIdx: c, nextIdx: n, jaccard });
                    }
                }
            }

            // Sort matches descending by jaccard
            matches.sort((a, b) => b.jaccard - a.jaccard);

            // Greedy assignment
            const matchedNext = new Set<number>();
            const matchedCurr = new Set<number>();

            for (const match of matches) {
                if (!matchedCurr.has(match.currIdx) && !matchedNext.has(match.nextIdx)) {
                    // Match! Propagate trackId
                    const currHe = currentFrame.hyperedges[match.currIdx];
                    const nextHe = nextFrame.hyperedges[match.nextIdx];

                    nextHe.trackId = currHe.trackId;

                    // Add centroid to track
                    const track = tracks.find(t => t.trackId === currHe.trackId);
                    if (track) {
                        track.centroids.push({ x: nextHe.centroid.x, y: nextHe.centroid.y, time: nextFrame.timeStart });
                    }

                    matchedCurr.add(match.currIdx);
                    matchedNext.add(match.nextIdx);
                }
            }

            // For any unmatched in nextFrame, assign a new trackId
            for (let n = 0; n < nextFrame.hyperedges.length; n++) {
                if (!matchedNext.has(n)) {
                    const nextHe = nextFrame.hyperedges[n];
                    nextHe.trackId = nextTrackId;
                    tracks.push({
                        trackId: nextTrackId,
                        colorIndex: nextTrackId,
                        centroids: [{ x: nextHe.centroid.x, y: nextHe.centroid.y, time: nextFrame.timeStart }]
                    });
                    nextTrackId++;
                }
            }
        }
    }

    return { frames: sequence, tracks };
}

/**
 * Implements a lightweight burst detector across population activity.
 * @param spikes Flat array of all spike events in the target buffer window
 * @param targetTime Current time user wants to find a burst near
 * @param windowMs Length of entire dataset or search space
 * @param burstLengthMs The desired return window bounds width 
 */
export function detectNearestBurst(
    spikes: SpikeEvent[],
    targetTime: number,
    windowMs: number, // e.g. 10000ms history array
    burstLengthMs: number = 200,
    k: number = 4
): { t0: number, t1: number, peakTime: number } | null {
    if (spikes.length === 0) return null;

    // 1. Compute population spike count per ms
    const minTime = Math.max(0, targetTime - windowMs);
    const maxTime = targetTime;
    const duration = maxTime - minTime;

    if (duration <= 0) return null;

    const pop = new Float32Array(Math.ceil(duration));
    spikes.forEach(s => {
        if (s.timestamp_ms >= minTime && s.timestamp_ms < maxTime) {
            const idx = Math.floor(s.timestamp_ms - minTime);
            if (idx >= 0 && idx < pop.length) {
                pop[idx] += 1;
            }
        }
    });

    // 2. Smooth with a small moving average kernel (e.g. 5ms)
    const smoothSize = 5;
    const popSmooth = new Float32Array(pop.length);
    for (let i = 0; i < pop.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - Math.floor(smoothSize / 2)); j <= Math.min(pop.length - 1, i + Math.floor(smoothSize / 2)); j++) {
            sum += pop[j];
            count++;
        }
        popSmooth[i] = sum / count;
    }

    // 3. Determine threshold (median + k * MAD)
    // Sort a copy for median
    const sorted = new Float32Array(popSmooth).sort();
    const median = sorted[Math.floor(sorted.length / 2)];

    // Calculate MAD (Median Absolute Deviation)
    const absDeviations = new Float32Array(popSmooth.length);
    for (let i = 0; i < popSmooth.length; i++) {
        absDeviations[i] = Math.abs(popSmooth[i] - median);
    }
    const sortedDevs = absDeviations.sort();
    let mad = sortedDevs[Math.floor(sortedDevs.length / 2)];
    if (mad === 0) mad = 1; // Prevent Division-by-Zero or overly sensitive flat lines

    const threshold = median + (k * mad);

    // 4. Find candidate burst peaks (contiguous crossings over threshold)
    const candidatePeaks: { time: number, maxVal: number }[] = [];
    let inBurst = false;
    let currentBurstPeakVal = 0;
    let currentBurstPeakTime = -1;

    for (let i = 0; i < popSmooth.length; i++) {
        if (popSmooth[i] > threshold) {
            if (!inBurst) {
                inBurst = true;
                currentBurstPeakVal = popSmooth[i];
                currentBurstPeakTime = i;
            } else {
                if (popSmooth[i] > currentBurstPeakVal) {
                    currentBurstPeakVal = popSmooth[i];
                    currentBurstPeakTime = i;
                }
            }
        } else {
            if (inBurst) {
                // Burst ended, save peak
                candidatePeaks.push({
                    time: minTime + currentBurstPeakTime,
                    maxVal: currentBurstPeakVal
                });
                inBurst = false;
            }
        }
    }

    // Catch edge case if burst hit boundary exactly
    if (inBurst) {
        candidatePeaks.push({
            time: minTime + currentBurstPeakTime,
            maxVal: currentBurstPeakVal
        });
    }

    if (candidatePeaks.length === 0) return null;

    // 5. Select closest burst peak to targetTime
    candidatePeaks.sort((a, b) => Math.abs(a.time - targetTime) - Math.abs(b.time - targetTime));
    const bestPeak = candidatePeaks[0].time;

    // Apply exact bounds clamped to min zeros
    const halfWindow = burstLengthMs / 2;
    const t0 = Math.max(0, bestPeak - halfWindow);
    const t1 = t0 + burstLengthMs;

    return { t0, t1, peakTime: bestPeak };
}
