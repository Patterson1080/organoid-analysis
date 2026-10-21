// What the Max patch listens to, computed here from the same spikes: the population firing rate
// and the ends of network bursts (SIGGRAPH 2026), and the VISAP 2025 mappings from rate to
// tone, grain and kick density. An approximation until the patch reports its own values.

import type { SpikeEvent } from '../../types';
import { SOUND_FACTS } from './facts.ts';

const RATE_WINDOW_MS = 100;
/** A burst is a population rate at or above this share of the recording's peak. */
export const BURST_FRACTION = 0.2;

/** First i with spikes[i].timestamp_ms > t (spikes sorted ascending). */
function upperBound(spikes: SpikeEvent[], t: number): number {
    let lo = 0;
    let hi = spikes.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (spikes[mid].timestamp_ms <= t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** Spikes in (index − windowMs, index]. */
export function populationRate(spikes: SpikeEvent[], index: number, windowMs = RATE_WINDOW_MS): number {
    return upperBound(spikes, index) - upperBound(spikes, index - windowMs);
}

/** The busiest window of the recording, at least 1 so it can divide. */
export function peakRate(spikes: SpikeEvent[], windowMs = RATE_WINDOW_MS): number {
    let peak = 0;
    for (let i = 0, j = 0; j < spikes.length; j++) {
        while (spikes[i].timestamp_ms <= spikes[j].timestamp_ms - windowMs) i++;
        peak = Math.max(peak, j - i + 1);
    }
    return Math.max(1, peak);
}

export interface BurstState {
    inBurst: boolean;
    ends: number; // burst endpoints seen: the patch's harmonic transitions
}

export function stepBurst(prev: BurstState, rate: number, threshold: number): BurstState {
    const inBurst = rate >= threshold;
    return { inBurst, ends: prev.inBurst && !inBurst ? prev.ends + 1 : prev.ends };
}

export interface PaperMappings {
    toneDensity: number; // sustained guitar tones, events/s
    grainDensity: number; // granulated fragments, events/s
    grainMs: number; // grain duration
    kickDensity: number; // subwoofer kick, events/s
}

// a at t = 0, b at t = 1, exactly at both ends.
const mix = ([a, b]: [number, number], t: number) => a * (1 - t) + b * t;

/** VISAP 2025's mappings for a rate normalized to the recording's peak (clamped to 0..1). */
export function paperMappings(norm: number): PaperMappings {
    const n = Math.min(1, Math.max(0, norm));
    return {
        toneDensity: mix(SOUND_FACTS.tone, Math.sqrt(n)),
        grainDensity: mix([SOUND_FACTS.grains[1], SOUND_FACTS.grains[0]], n ** (1 / 6)), // sixth root, inverted
        grainMs: mix(SOUND_FACTS.grainMs, n),
        kickDensity: mix([SOUND_FACTS.kick[1], SOUND_FACTS.kick[0]], n), // inverse
    };
}
