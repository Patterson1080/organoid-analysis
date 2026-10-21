import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRoutingSettings, saveRoutingSettings } from './routingSettings.ts';

const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

test('defaults', () => {
    assert.deepEqual(loadRoutingSettings(memory()), { visible: true, tour: true, visualOutput: 'unity' });
});

test('round trip', () => {
    const s = memory();
    saveRoutingSettings({ visible: false, tour: false, visualOutput: 'td-sd' }, s);
    assert.deepEqual(loadRoutingSettings(s), { visible: false, tour: false, visualOutput: 'td-sd' });
});

test('corrupt or unknown values fall back per field', () => {
    const s = memory();
    s.setItem('organoid-analysis.routing', '{"visible":"yes","visualOutput":"vhs","tour":false}');
    assert.deepEqual(loadRoutingSettings(s), { visible: true, tour: false, visualOutput: 'unity' });
    s.setItem('organoid-analysis.routing', '{not json');
    assert.deepEqual(loadRoutingSettings(s), { visible: true, tour: true, visualOutput: 'unity' });
});
