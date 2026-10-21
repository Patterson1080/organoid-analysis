// The routing view's auto-tour: when nobody touches the interface it walks the overview and
// each medium's detail in turn; any interaction pauses it, and 60 s of quiet restarts it at
// the overview. Pure: the caller passes the clock.

import { MEDIA } from './facts.ts';
import type { MediumKey } from './facts.ts';

export type TourStop = 'overview' | MediumKey;
export const TOUR_STOPS: TourStop[] = ['overview', ...MEDIA];
export const TOUR_DWELL_MS = 20_000;
export const TOUR_IDLE_MS = 60_000;

export interface TourState {
    enabled: boolean;
    stop: number; // index into TOUR_STOPS
    stopStartedAt: number;
    pausedUntil: number | null; // ms; null while touring
}

export const createTour = (now: number, enabled = true): TourState => ({ enabled, stop: 0, stopStartedAt: now, pausedUntil: null });

export const tourPaused = (s: TourState, now: number): boolean => s.pausedUntil !== null && now < s.pausedUntil;

export const tourCurrent = (s: TourState): TourStop => TOUR_STOPS[s.stop];

export function tourTick(s: TourState, now: number): TourState {
    if (!s.enabled) return s;
    if (s.pausedUntil !== null) return now < s.pausedUntil ? s : createTour(now);
    const steps = Math.floor((now - s.stopStartedAt) / TOUR_DWELL_MS);
    if (steps < 1) return s;
    return { ...s, stop: (s.stop + steps) % TOUR_STOPS.length, stopStartedAt: s.stopStartedAt + steps * TOUR_DWELL_MS };
}

export const tourInteract = (s: TourState, now: number): TourState => ({ ...s, pausedUntil: now + TOUR_IDLE_MS });

export const setTourEnabled = (s: TourState, enabled: boolean, now: number): TourState =>
    enabled ? createTour(now) : { ...s, enabled: false };

/** How far through the current stop, 0..1; 0 while paused or off. */
export function tourProgress(s: TourState, now: number): number {
    if (!s.enabled || tourPaused(s, now)) return 0;
    return Math.min(1, Math.max(0, (now - s.stopStartedAt) / TOUR_DWELL_MS));
}
