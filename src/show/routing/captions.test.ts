import test from 'node:test';
import assert from 'node:assert/strict';
import { firingCaption, pad6, passCaption, sourceCaption, strikeCaption } from './captions.ts';
import { ATTRIBUTION } from './facts.ts';

test('every detail source carries the attribution', () => {
    for (const phase of ['on', 'off', 'stopped'] as const) {
        const rows = sourceCaption(phase, 1234, '131 neurons · spikes').map(([s]) => s);
        assert.ok(rows.includes(ATTRIBUTION), `attribution under the ${phase} source`);
    }
});

test('the playhead line', () => {
    assert.equal(pad6(1234.7), '001234');
    assert.equal(sourceCaption('on', 1234, 'x')[0][0], '/index 001234');
    assert.equal(sourceCaption('stopped', null, 'x')[0][0], '/index ——————');
    assert.equal(sourceCaption('off', null, 'x')[0][0], '■ OFF');
});

test('the firing line says where its values come from', () => {
    assert.equal(firingCaption('blob', 131, 7), 'SetFrame → 131 intensities · 7 ≥ 0.1');
    assert.equal(firingCaption('spikes', 131, 0), 'spikes · no firing blob');
    assert.equal(firingCaption('mismatch', 64, 0), 'spikes · the firing blob is for another dataset');
});

test('strike captions say how sure they are', () => {
    assert.deepEqual(strikeCaption('live', 'show', 3), ['LIVE · 3 strikes from the patch', '#fff']);
    assert.equal(strikeCaption('computed', 'show', 4)[0], 'the rows Max sends (backboneSpikes.txt) · 4 strikes');
    assert.equal(strikeCaption('computed', 'local', 5)[0], '≈ local playback skips rows · 5 strikes');
});

test("the pass line follows the bridge's config, which the operator edits", () => {
    const config = {
        startIndex: 0, endIndex: 179999, fps: 60, offSeconds: 120, fadeSeconds: 5, indexAddress: '/index', passStartCue: '/sim_resetSimsOnly',
        onAddress: '/sim_on', offAddress: '/sim_off', spreadCues: [{ address: '/sim_resetTermites', count: 5 }, { address: '/sim_resetPhysarum', count: 10 }],
    };
    assert.equal(passCaption(config), 'pass  /sim_resetSimsOnly → /sim_on 5 → T ×5 · P ×10 → /sim_off 5 → 2 min dark, sims paused');
    const edited = { ...config, offSeconds: 45, fadeSeconds: 3, spreadCues: [{ address: '/sim_resetTermites', count: 0 }, { address: '/sim_resetPhysarum', count: 2 }] };
    assert.equal(passCaption(edited), 'pass  /sim_resetSimsOnly → /sim_on 3 → P ×2 → /sim_off 3 → 45 s dark, sims paused');
});
