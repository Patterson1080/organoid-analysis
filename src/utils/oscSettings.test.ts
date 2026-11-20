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

test('a listener saved as an output before monitors existed becomes the monitor', () => {
    const base = { ...DEFAULT_OSC_SETTINGS };
    assert.deepEqual(listenerAsMonitor({ ...base, oscOutIp: '127.0.0.1:3334' }), { ...base, oscOutIp: '127.0.0.1', oscMonitorIp: '127.0.0.1:3334' });
    assert.deepEqual(listenerAsMonitor({ ...base, oscOutIp: '192.168.1.5, 127.0.0.1:3334' }), { ...base, oscOutIp: '192.168.1.5', oscMonitorIp: '127.0.0.1:3334' });
    // A monitor already set, or no listener among the outputs: left alone.
    const set = { ...base, oscOutIp: '127.0.0.1:3334', oscMonitorIp: '10.0.0.2:9000' };
    assert.deepEqual(listenerAsMonitor(set), set);
    assert.deepEqual(listenerAsMonitor(base), base);
    // And it is applied on load.
    const s = new Map<string, string>();
    const storage = { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => { s.set(k, v); } };
    saveOscSettings({ ...base, oscOutIp: '127.0.0.1:3334' }, storage);
    assert.equal(loadOscSettings(storage).oscMonitorIp, '127.0.0.1:3334');
    assert.equal(loadOscSettings(storage).oscOutIp, '127.0.0.1');
});
