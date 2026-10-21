// Which clock the routing view follows: the show's while it runs and the bridge is there to send
// it; otherwise local playback, which sends /index, LEDs and sound itself.

import type { ShowState } from '../../types';
import { extrapolateIndex, phaseRemainingMs } from '../showMath.ts';

export interface Playhead {
    index: number | null;
    phase: 'on' | 'off' | 'stopped';
    mode: 'show' | 'local';
    offRemainingMs: number;
}

export function routingPlayhead(
    snap: { state: ShowState; receivedAt: number } | null,
    connected: boolean,
    localTime: number,
    hasData: boolean,
    now: number,
): Playhead {
    const st = snap?.state;
    if (snap && st?.running && connected) {
        const since = now - snap.receivedAt;
        const phase = st.phase === 'off' ? 'off' : 'on';
        return { index: extrapolateIndex(st, since), phase, mode: 'show', offRemainingMs: phase === 'off' ? phaseRemainingMs(st, since) : 0 };
    }
    return { index: hasData ? localTime : null, phase: 'stopped', mode: 'local', offRemainingMs: 0 };
}
