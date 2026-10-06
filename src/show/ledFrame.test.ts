import test from 'node:test';
import assert from 'node:assert/strict';
import { ledCell, ledStep, neuronBounds, neuronsById, showOutputAfter, LED_TRAIL_LENGTH } from './ledFrame.ts';

const n = (id: number, x: number, y: number) => ({ neuron_id: id, x, y });
const neurons = [n(1, 0, 0), n(2, 10, 10), n(3, 5, 0), n(4, 0, 10), n(5, 10, 0), n(6, 2, 2), n(7, 8, 8)];
const byId = new Map(neurons.map(x => [x.neuron_id, x]));
const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10 };

test('neuronBounds spans every position; null when there are none', () => {
    assert.deepEqual(neuronBounds(neurons), bounds);
    assert.equal(neuronBounds([]), null);
});

test('ledCell maps positions onto the 0–15 grid', () => {
    assert.deepEqual(ledCell(n(1, 0, 0), bounds), { x: 0, y: 0 });
    assert.deepEqual(ledCell(n(2, 10, 10), bounds), { x: 15, y: 15 });
    assert.deepEqual(ledCell(n(3, 5, 0), bounds), { x: 8, y: 0 }); // 7.5 rounds up
    assert.deepEqual(ledCell({ x: 3, y: 3 }, { minX: 3, maxX: 3, minY: 3, maxY: 3 }), { x: 0, y: 0 });
});

test('ledStep: a quiet frame keeps showing the trail', () => {
    const { trail, frame } = ledStep([n(1, 0, 0)], [], byId, bounds);
    assert.deepEqual(trail.map(t => t.neuron_id), [1]);
    assert.deepEqual(frame, { isBurst: false, firings: [{ x: 0, y: 0 }] });
});

test('ledStep: no trail and nothing fired sends nothing', () => {
    assert.deepEqual(ledStep([], [], byId, bounds), { trail: [], frame: null });
});

test('ledStep: the trail keeps the last 5 fired neurons; unknown ids are skipped', () => {
    const { trail, frame } = ledStep([n(1, 0, 0), n(2, 10, 10)], [3, 99, 4, 5, 6], byId, bounds);
    assert.deepEqual(trail.map(t => t.neuron_id), [2, 3, 4, 5, 6]);
    assert.equal(frame?.isBurst, false); // 5 distinct ids (99 included) is not more than 5
    assert.equal(frame?.firings.length, LED_TRAIL_LENGTH);
});

test('ledStep: more than 5 distinct neurons in one frame is a burst showing every spike', () => {
    const { frame } = ledStep([], [1, 2, 3, 4, 5, 6, 6], byId, bounds);
    assert.equal(frame?.isBurst, true);
    assert.equal(frame?.firings.length, 7);
});

test('showOutputAfter: continues from the last index, restarts per pass, caps any backlog', () => {
    assert.equal(showOutputAfter(100, 101, 0), 100);
    assert.equal(showOutputAfter(null, 0, 0), -1);         // pass start
    assert.equal(showOutputAfter(179999, 5, 0), -1);       // wrapped into a new pass
    assert.equal(showOutputAfter(null, 90000, 0), 89970);  // reconnect mid-pass: last 30 ms only
    assert.equal(showOutputAfter(10, 5000, 0), 4970);      // stall
});

test('neuronsById keeps the first neuron for a repeated id (as Array.find did)', () => {
    const byIdFirst = neuronsById([n(1, 0, 0), n(1, 5, 5), n(2, 1, 1)]);
    assert.deepEqual(byIdFirst.get(1), n(1, 0, 0));
    assert.equal(byIdFirst.size, 2);
});
