import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dataRoutes, dataStatus } from './data-files.js';

const dir = await mkdtemp(path.join(tmpdir(), 'data-files-'));
await writeFile(path.join(dir, 'neurons.csv'), 'backbone_labels,xy_norm_0,xy_norm_1\n');
await writeFile(path.join(dir, 'vessel.gcode'), 'G1 X0 Y0 Z0\n');

test('status lists every data file', () => {
    assert.deepEqual(dataStatus(dir), { neurons: true, spikes: false, firing: false, vessel: true, activity: false, bursts: false, termite: false });
});

test('routes carry their content type', () => {
    const routes = dataRoutes(dir);
    assert.deepEqual(routes.get('/data/organoid_firing.f16'), { path: path.join(dir, 'organoid_firing.f16'), type: 'application/octet-stream' });
    assert.equal(routes.get('/data/vessel.gcode').type, 'text/plain');
});

test('status keys keep their order', () => {
    assert.equal(Object.keys(dataStatus(dir)).join(), 'neurons,spikes,firing,vessel,activity,bursts,termite');
});

test('the WAVs are served as audio/wav', () => {
    const routes = dataRoutes(dir);
    assert.equal(routes.get('/data/activitylevel.wav').type, 'audio/wav');
    assert.equal(routes.get('/data/burstflags.wav').type, 'audio/wav');
    assert.equal(routes.get('/data/termite_slices.bin').type, 'application/octet-stream');
});
