// Visitor-facing lines that depend on state: the playhead, where the Visual card's values come
// from, and the attribution every routing screen carries.

import { ATTRIBUTION, ROBOT_FACTS, VISUAL_FACTS } from './facts.ts';

export const pad6 = (v: number) => String(Math.floor(v)).padStart(6, '0');

export const indexLabel = (index: number | null) => `/index ${index === null ? '——————' : pad6(index)}`;

/** The lines under a detail's source: the playhead, what this medium hears, the attribution. */
export function sourceCaption(phase: 'on' | 'off' | 'stopped', index: number | null, heard: string): [string, string][] {
    return [
        [phase === 'off' ? '■ OFF' : indexLabel(index), '#fff'],
        [heard, '#777'],
        [ATTRIBUTION, '#5a5a5a'],
    ];
}

/** How sure the solenoid card is of its strikes: Max's own, the same rows Max sends in the show
 *  (backboneSpikes.txt holds the 27 backbone columns), or ≈ in local playback, which skips rows. */
export function strikeCaption(source: 'computed' | 'live', mode: 'show' | 'local', strikes: number): [string, string] {
    if (source === 'live') return [`LIVE · ${strikes} strikes from the patch`, '#fff'];
    return mode === 'show' ? [`the rows Max sends (backboneSpikes.txt) · ${strikes} strikes`, '#999'] : [`≈ local playback skips rows · ${strikes} strikes`, '#555'];
}

/** The robot's badge: LIVE once any arm reports here. */
export const robotCaption = (anyLive: boolean): [string, string] => (anyLive ? ['LIVE · from the arms', '#fff'] : [ROBOT_FACTS.badge, '#555']);

/** Where the Visual card's firing comes from. */
export function firingCaption(source: 'blob' | 'spikes' | 'mismatch', neurons: number, firing: number): string {
    if (source === 'blob') return `SetFrame → ${neurons} intensities · ${firing} ≥ ${VISUAL_FACTS.threshold}`;
    return source === 'mismatch' ? 'spikes · the firing blob is for another dataset' : 'spikes · no firing blob';
}
