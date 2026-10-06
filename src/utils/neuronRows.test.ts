import test from 'node:test';
import assert from 'node:assert/strict';
import { neuronsFromRows } from './neuronRows.ts';

test('neuron_id/x/y/is_backbone rows keep their ids and backbone flags', () => {
    const ns = neuronsFromRows(['neuron_id', 'x', 'y', 'is_backbone'], [
        { neuron_id: 7, x: 67.4, y: 88.91, is_backbone: 1 },
        { neuron_id: 8, x: 58.6, y: 85.27, is_backbone: 0 },
    ]);
    assert.deepEqual(ns.map(n => [n.neuron_id, n.x, n.y, n.is_backbone]), [[7, 67.4, 88.91, true], [8, 58.6, 85.27, false]]);
});

test('labels_positions rows (backbone_labels, xy_norm_0/1) are numbered by row', () => {
    const ns = neuronsFromRows(['backbone_labels', 'xy_norm_0', 'xy_norm_1'], [
        { backbone_labels: 0, xy_norm_0: 0.98, xy_norm_1: 0.39 },
        { backbone_labels: 1, xy_norm_0: 0.5, xy_norm_1: 0.2 },
    ]);
    assert.deepEqual(ns.map(n => [n.neuron_id, n.x, n.y]), [[1, 0.98, 0.39], [2, 0.5, 0.2]]);
});

test('rows missing a coordinate are dropped; no x/y columns gives no neurons', () => {
    assert.equal(neuronsFromRows(['neuron_id', 'x', 'y'], [{ neuron_id: 3, x: 1, y: null }]).length, 0);
    assert.deepEqual(neuronsFromRows(['a', 'b'], [{ a: 1, b: 2 }]), []);
});
