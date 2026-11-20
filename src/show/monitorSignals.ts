// The extra signals monitors get (server/monitor.js): their addresses, and the ones a tick's
// spikes give directly. Shared by the bridge (the show) and the page (local playback), so a
// listener sees the same signals in both. Counts are counts, not normalised.

export const SIGNAL = {
    rate: '/feature/rate',         // int: spikes in the last 100 ms
    burst: '/feature/burst',       // int: 1 on the tick a burst ends, else 0 (the show only)
    bursting: '/feature/bursting', // int: 1 while the rate is at or above the burst threshold
    firing: '/feature/firing',     // int: distinct neurons that fired since the last tick
    backbone: '/feature/backbone', // int: distinct backbone neurons among them
    led: '/routing/led',           // int: points in the LED frame, on ticks that build one
    pass: '/show/pass',            // int: the pass number, 0 when stopped (the show only)
    phase: '/show/phase',          // string: on, off or stopped (the show only)
} as const;

export interface OscMessage {
    address: string;
    args: (number | string)[];
}

/** The ids of the neurons the dataset marks as backbone, or null when it marks none: then
 *  there is no set to count, and no backbone signal. */
export function backboneIds(neurons: { neuron_id: number; is_backbone: boolean }[]): Set<number> | null {
    const ids = new Set(neurons.filter(n => n.is_backbone).map(n => n.neuron_id));
    return ids.size > 0 ? ids : null;
}

/** How many neurons fired in a tick's spikes, and how many of them are backbone. */
export function firingSignals(spikeIds: number[], backbone: Set<number> | null): OscMessage[] {
    const fired = new Set(spikeIds);
    const messages: OscMessage[] = [{ address: SIGNAL.firing, args: [fired.size] }];
    if (backbone) {
        let n = 0;
        for (const id of fired) if (backbone.has(id)) n++;
        messages.push({ address: SIGNAL.backbone, args: [n] });
    }
    return messages;
}

/** The rate at the index, and whether that is a burst. */
export function rateSignals(rate: number, threshold: number): OscMessage[] {
    return [
        { address: SIGNAL.rate, args: [rate] },
        { address: SIGNAL.bursting, args: [rate >= threshold ? 1 : 0] },
    ];
}

/** How many points the LED frame lit; nothing on a tick without a frame. */
export function ledSignal(frame: { firings: unknown[] } | null): OscMessage[] {
    return frame ? [{ address: SIGNAL.led, args: [frame.firings.length] }] : [];
}

/** Where the show is, for a listener that joins late. */
export function showSignals(state: { pass: number; phase: string }): OscMessage[] {
    return [
        { address: SIGNAL.pass, args: [state.pass] },
        { address: SIGNAL.phase, args: [state.phase] },
    ];
}
