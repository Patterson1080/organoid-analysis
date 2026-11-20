// OSC Bridge panel settings, kept per browser so a reload restores them. Without this a
// reloaded tab would push the defaults to the bridge on connect.

export interface OscSettings {
    oscInPort: string;
    oscOutIp: string;
    oscOutPort: string;
    oscMonitorIp: string; // listeners beside the show (Kybyria): server/monitor.js
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
    oscMonitorIp: '',
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
    return listenerAsMonitor(out);
}

const LISTENER_PORT = '3334'; // Kybyria's OSC input

/** A listener saved as a show output (from before monitors existed) would get the show without
 *  the monitor signals, and the bridge ignores a monitor that is also an output. So an output
 *  whose port is the listener's, by its own `:port` or by the shared Output Port, becomes a
 *  monitor; the Output Port goes back to the default, and so do the outputs if none is left. */
export function listenerAsMonitor(settings: OscSettings): OscSettings {
    const split = (list: string) => list.split(',').map(s => s.trim()).filter(Boolean);
    const sharedIsListener = settings.oscOutPort.trim() === LISTENER_PORT;
    const isListener = (entry: string) => (entry.includes(':') ? entry.split(':')[1] === LISTENER_PORT : sharedIsListener);
    const entries = split(settings.oscOutIp);
    const listeners = entries.filter(isListener).map(e => `${e.split(':')[0]}:${LISTENER_PORT}`);
    if (listeners.length === 0 && !sharedIsListener) return settings;
    const monitors = [...new Set([...split(settings.oscMonitorIp), ...listeners])];
    return {
        ...settings,
        oscOutIp: entries.filter(e => !isListener(e)).join(', ') || DEFAULT_OSC_SETTINGS.oscOutIp,
        oscOutPort: sharedIsListener ? DEFAULT_OSC_SETTINGS.oscOutPort : settings.oscOutPort,
        oscMonitorIp: monitors.join(', '),
    };
}

export function saveOscSettings(settings: OscSettings, storage?: KeyValueStore): void {
    try {
        (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify(settings));
    } catch {
        // Blocked storage: settings just won't survive a reload.
    }
}
