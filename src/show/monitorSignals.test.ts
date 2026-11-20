import test from 'node:test';
import assert from 'node:assert/strict';
import { backboneIds, firingSignals, ledSignal, rateSignals, showSignals } from './monitorSignals.ts';

test('backboneIds is the marked set, or null when the dataset marks none', () => {
    const n = (neuron_id: number, is_backbone: boolean) => ({ neuron_id, is_backbone });
    assert.deepEqual([...backboneIds([n(1, false), n(2, true), n(5, true)])!], [2, 5]);
    assert.equal(backboneIds([n(1, false)]), null);
    assert.equal(backboneIds([]), null);
});

test('firingSignals counts distinct neurons, and the backbone ones only when a set exists', () => {
    assert.deepEqual(firingSignals([3, 3, 7, 9], new Set([7, 9, 11])), [
        { address: '/feature/firing', args: [3] },
        { address: '/feature/backbone', args: [2] },
    ]);
    assert.deepEqual(firingSignals([], new Set([7])), [{ address: '/feature/firing', args: [0] }, { address: '/feature/backbone', args: [0] }]);
    assert.deepEqual(firingSignals([3, 4], null), [{ address: '/feature/firing', args: [2] }]);
});

test('rateSignals: bursting from the threshold up', () => {
    assert.deepEqual(rateSignals(19, 20), [{ address: '/feature/rate', args: [19] }, { address: '/feature/bursting', args: [0] }]);
    assert.deepEqual(rateSignals(20, 20).map(m => m.args[0]), [20, 1]);
});

test('ledSignal counts the frame, and says nothing without one', () => {
    assert.deepEqual(ledSignal({ firings: [{}, {}, {}] }), [{ address: '/routing/led', args: [3] }]);
    assert.deepEqual(ledSignal(null), []);
});

test('showSignals carries the pass and the phase', () => {
    assert.deepEqual(showSignals({ pass: 2, phase: 'off' }), [{ address: '/show/pass', args: [2] }, { address: '/show/phase', args: ['off'] }]);
});
