import type { ShowState, SpikeEvent } from '../types';

// Pure helpers for the show panel — no DOM, unit-tested with node --test.

/** First index i with spikes[i].timestamp_ms >= t (spikes sorted ascending). */
export function lowerBound(spikes: SpikeEvent[], t: number): number {
    let lo = 0;
    let hi = spikes.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (spikes[mid].timestamp_ms < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** Playhead between SHOW_STATE messages: the last index advanced at fps, clamped to the
 *  pass end. Fractional, so the raster scrolls smoothly. null outside a running ON phase. */
export function extrapolateIndex(state: ShowState, msSinceReceived: number): number | null {
    if (!state.running || state.phase !== 'on' || state.index === null) return null;
    return Math.min(state.config.endIndex, state.index + (Math.max(0, msSinceReceived) * state.config.fps) / 1000);
}

/** m:ss, rounded up so a countdown reads 0:00 exactly at the switch. */
export function formatClock(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Spike counts in `bins` equal slices of [start, end] (end inclusive). */
export function rateBins(spikes: SpikeEvent[], start: number, end: number, bins: number): Float32Array {
    const out = new Float32Array(Math.max(0, bins));
    const span = end - start;
    if (bins <= 0 || span < 0) return out;
    for (let i = lowerBound(spikes, start); i < spikes.length && spikes[i].timestamp_ms <= end; i++) {
        const b = span > 0 ? Math.floor(((spikes[i].timestamp_ms - start) / span) * bins) : 0;
        out[Math.min(bins - 1, b)]++;
    }
    return out;
}

/** 0..1 through the cycle (ON, then OFF), extrapolated. null when stopped. */
export function cyclePosition(state: ShowState, msSinceReceived = 0): number | null {
    if (!state.running || state.phase === 'stopped') return null;
    const { passMs, cycleMs } = state.timing;
    const into = state.phaseElapsedMs + Math.max(0, msSinceReceived);
    const t = state.phase === 'on' ? Math.min(into, passMs) : passMs + Math.min(into, cycleMs - passMs);
    return cycleMs > 0 ? t / cycleMs : 0;
}

/** Time left in the current phase, extrapolated. */
export function phaseRemainingMs(state: ShowState, msSinceReceived = 0): number {
    return Math.max(0, state.phaseDurationMs - state.phaseElapsedMs - Math.max(0, msSinceReceived));
}

/** One-letter tick label for a cue: '/sim_resetTermites' → 'T'. */
export function cueLabel(address: string): string {
    const name = address.replace(/^\/sim_reset/, '').replace(/^\//, '');
    return (name.charAt(0) || '•').toUpperCase();
}
