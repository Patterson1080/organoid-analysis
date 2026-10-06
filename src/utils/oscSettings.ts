// OSC Bridge panel settings, kept per browser so a reload restores them. Without this a
// reloaded tab would push the defaults to the bridge on connect.

export interface OscSettings {
    oscInPort: string;
    oscOutIp: string;
    oscOutPort: string;
    oscTimeEnabled: boolean;
    oscTimeAddress: string;
    oscNeuronsEnabled: boolean;
    oscXPrefix: string;
    oscYPrefix: string;
    oscRowEnabled: boolean;
    oscRowAddress: string;
}

export const DEFAULT_OSC_SETTINGS: OscSettings = {
    oscInPort: '3333',
    oscOutIp: '127.0.0.1',
    oscOutPort: '1234', // EoC-biomes OSCMapping port in the show scenes
    oscTimeEnabled: true,
    oscTimeAddress: '/index',
    oscNeuronsEnabled: true,
    oscXPrefix: '/x',
    oscYPrefix: '/y',
    oscRowEnabled: true,
    oscRowAddress: '/row',
};

const KEY = 'organoid-analysis.oscBridge';

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

// `storage` defaults to localStorage, looked up inside the try: merely touching it throws
// in some sandboxed/privacy contexts.
export function loadOscSettings(storage?: KeyValueStore): OscSettings {
    const out: OscSettings = { ...DEFAULT_OSC_SETTINGS };
    try {
        const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY) ?? 'null');
        if (!saved || typeof saved !== 'object') return out;
        for (const key of Object.keys(out) as (keyof OscSettings)[]) {
            if (typeof saved[key] === typeof out[key]) Object.assign(out, { [key]: saved[key] });
        }
    } catch {
        // Unreadable or blocked storage: defaults.
    }
    return out;
}

export function saveOscSettings(settings: OscSettings, storage?: KeyValueStore): void {
    try {
        (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify(settings));
    } catch {
        // Blocked storage: settings just won't survive a reload.
    }
}
