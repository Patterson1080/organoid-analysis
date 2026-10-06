import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadNeurons, loadSpikeFrames, spikeIdsBetween } from './show-data.js';

const dir = await mkdtemp(path.join(tmpdir(), 'show-data-'));
const file = async (name, text) => {
    const p = path.join(dir, name);
    await writeFile(p, text);
    return p;
};

test('loadNeurons reads labels_positions-style CSVs like the page does', async () => {
    const p = await file('neurons.csv', 'backbone_labels,xy_norm_0,xy_norm_1\n0.0,0.98,0.39\n1.0,0.5,0.2\n');
    const ns = await loadNeurons(p);
    assert.deepEqual(ns.map(n => [n.neuron_id, n.x, n.y]), [[1, 0.98, 0.39], [2, 0.5, 0.2]]);
});

test('loadSpikeFrames turns matrix rows into the neuron ids firing in each ms', async () => {
    const p = await file('spikes.csv', 't_spk_mat_0,t_spk_mat_1,t_spk_mat_2\n0,1,0\n0,0,0\n1,1,1\n\n0,0,1\n');
    const frames = await loadSpikeFrames(p);
    assert.equal(frames.frameCount, 4); // the blank line is not a row
    assert.deepEqual(spikeIdsBetween(frames, -1, 0), [2]);
    assert.deepEqual(spikeIdsBetween(frames, 0, 1), []);
    assert.deepEqual(spikeIdsBetween(frames, 1, 2), [1, 2, 3]);
    assert.deepEqual(spikeIdsBetween(frames, -1, 3), [2, 1, 2, 3, 3]);
});

test('spikeIdsBetween clips to the recording', async () => {
    const frames = await loadSpikeFrames(await file('short.csv', 'a,b\n1,0\n0,1\n'));
    assert.deepEqual(spikeIdsBetween(frames, 1, 500), []);
    assert.deepEqual(spikeIdsBetween(frames, -10, 500), [1, 2]);
});

test('matrix columns past the first 131 are ignored, as in the page', async () => {
    const header = Array.from({ length: 133 }, (_, i) => `t_spk_mat_${i}`).join(',');
    const row = Array.from({ length: 133 }, (_, i) => (i >= 129 ? 1 : 0)).join(',');
    const frames = await loadSpikeFrames(await file('wide.csv', `${header}\n${row}\n`));
    assert.deepEqual(spikeIdsBetween(frames, -1, 0), [130, 131]);
});
