import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OSC_SETTINGS, listenerAsMonitor, loadOscSettings, saveOscSettings } from './oscSettings.ts';

const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

test('defaults send to EoC on port 1234', () => {
    assert.equal(DEFAULT_OSC_SETTINGS.oscOutPort, '1234');
    assert.deepEqual(loadOscSettings(memory()), DEFAULT_OSC_SETTINGS);
});

test('saved settings survive a reload', () => {
    const s = memory();
    saveOscSettings({ ...DEFAULT_OSC_SETTINGS, oscOutIp: '192.168.1.5', oscTimeEnabled: false }, s);
    const loaded = loadOscSettings(s);
    assert.equal(loaded.oscOutIp, '192.168.1.5');
    assert.equal(loaded.oscTimeEnabled, false);
});

test('corrupt or mistyped storage falls back field by field', () => {
    const s = memory();
    s.setItem('organoid-analysis.oscBridge', '{not json');
    assert.deepEqual(loadOscSettings(s), DEFAULT_OSC_SETTINGS);
    s.setItem('organoid-analysis.oscBridge', JSON.stringify({ oscOutIp: 42, oscOutPort: '9000', bogus: 1 }));
    const loaded = loadOscSettings(s);
    assert.equal(loaded.oscOutIp, '127.0.0.1');
    assert.equal(loaded.oscOutPort, '9000');
    assert.equal('bogus' in loaded, false);
});

test('blocked storage never throws', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    assert.deepEqual(loadOscSettings(blocked), DEFAULT_OSC_SETTINGS);
    assert.doesNotThrow(() => saveOscSettings(DEFAULT_OSC_SETTINGS, blocked));
});

test('a listener saved as an output becomes a monitor, and the Output Port goes back to 1234', () => {
    const base = { ...DEFAULT_OSC_SETTINGS };
    const fixed = { ...base, oscOutIp: '127.0.0.1', oscOutPort: '1234', oscMonitorIp: '127.0.0.1:3334' };
    assert.deepEqual(listenerAsMonitor({ ...base, oscOutIp: '127.0.0.1:3334' }), fixed);
    // The listener's port saved as the shared Output Port, with or without the monitor already set.
    assert.deepEqual(listenerAsMonitor({ ...base, oscOutPort: '3334' }), fixed);
    assert.deepEqual(listenerAsMonitor({ ...base, oscOutPort: '3334', oscMonitorIp: '127.0.0.1:3334' }), fixed);
    // Other outputs stay; one with its own port is not moved by the shared port.
    assert.deepEqual(listenerAsMonitor({ ...base, oscOutIp: '192.168.1.5, 127.0.0.1:3334' }), { ...fixed, oscOutIp: '192.168.1.5' });
    assert.deepEqual(listenerAsMonitor({ ...base, oscOutIp: '192.168.1.5:9000, 10.0.0.2', oscOutPort: '3334' }),
        { ...base, oscOutIp: '192.168.1.5:9000', oscOutPort: '1234', oscMonitorIp: '10.0.0.2:3334' });
    // Nothing to do: left exactly as saved.
    const fine = { ...base, oscOutIp: '192.168.1.5', oscMonitorIp: '127.0.0.1:3334' };
    assert.equal(listenerAsMonitor(fine), fine);
    assert.equal(listenerAsMonitor(base), base);
    // And it is applied on load.
    const s = new Map<string, string>();
    const storage = { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => { s.set(k, v); } };
    saveOscSettings({ ...base, oscOutPort: '3334', oscMonitorIp: '127.0.0.1:3334' }, storage);
    assert.deepEqual(loadOscSettings(storage), fixed);
});
