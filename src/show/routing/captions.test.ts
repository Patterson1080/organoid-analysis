import test from 'node:test';
import assert from 'node:assert/strict';
import { firingCaption, pad6, sourceCaption } from './captions.ts';
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
