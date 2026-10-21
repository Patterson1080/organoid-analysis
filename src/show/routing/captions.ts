// Visitor-facing lines that depend on state: the playhead, where the Visual card's values come
// from, and the attribution every routing screen carries.

import { ATTRIBUTION, VISUAL_FACTS } from './facts.ts';

export const pad6 = (v: number) => String(Math.floor(v)).padStart(6, '0');

/** The lines under a detail's source: the playhead, what this medium hears, the attribution. */
export function sourceCaption(phase: 'on' | 'off' | 'stopped', index: number | null, heard: string): [string, string][] {
    return [
        [phase === 'off' ? '■ OFF' : `/index ${index === null ? '——————' : pad6(index)}`, '#fff'],
        [heard, '#777'],
        [ATTRIBUTION, '#5a5a5a'],
    ];
}

/** Where the Visual card's firing comes from. */
export function firingCaption(source: 'blob' | 'spikes' | 'mismatch', neurons: number, firing: number): string {
    if (source === 'blob') return `SetFrame → ${neurons} intensities · ${firing} ≥ ${VISUAL_FACTS.threshold}`;
    return source === 'mismatch' ? 'spikes · the firing blob is for another dataset' : 'spikes · no firing blob';
}
