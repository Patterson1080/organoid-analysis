import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OSC_SETTINGS, loadOscSettings, saveOscSettings } from './oscSettings.ts';

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
