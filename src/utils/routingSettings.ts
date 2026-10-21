// The routing view's operator settings, kept per browser like the tile spans: whether it shows,
// whether it tours by itself, and what this show does with Unity's output.

import type { VisualOutput } from '../show/routing/facts';

export interface RoutingSettings {
    visible: boolean;
    tour: boolean;
    visualOutput: VisualOutput;
}

const KEY = 'organoid-analysis.routing';
const DEFAULTS: RoutingSettings = { visible: true, tour: true, visualOutput: 'unity' };
const OUTPUTS: VisualOutput[] = ['unity', 'td', 'td-sd'];

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

// `storage` defaults to localStorage, looked up inside the try: merely touching it throws
// in some sandboxed/privacy contexts.
export function loadRoutingSettings(storage?: KeyValueStore): RoutingSettings {
    let saved: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY) ?? 'null');
        if (parsed && typeof parsed === 'object') saved = parsed;
    } catch {
        // Corrupt or blocked storage: the defaults.
    }
    return {
        visible: typeof saved.visible === 'boolean' ? saved.visible : DEFAULTS.visible,
        tour: typeof saved.tour === 'boolean' ? saved.tour : DEFAULTS.tour,
        visualOutput: OUTPUTS.includes(saved.visualOutput as VisualOutput) ? (saved.visualOutput as VisualOutput) : DEFAULTS.visualOutput,
    };
}

export function saveRoutingSettings(settings: RoutingSettings, storage?: KeyValueStore): void {
    try {
        (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify(settings));
    } catch {
        // Blocked storage: the settings just won't survive a reload.
    }
}
