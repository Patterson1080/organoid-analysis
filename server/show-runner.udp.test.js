import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, Server } from 'node-osc';
import { createShowRunner } from './show-runner.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('real UDP: one 1 s pass at 60 fps, fade args as floats, then a silent OFF', { timeout: 10_000 }, async () => {
    const port = 39123;
    const received = [];
    const server = await new Promise(resolve => { const s = new Server(port, '127.0.0.1', () => resolve(s)); });
    server.on('message', ([address, ...args]) => received.push({ address, args, at: performance.now() }));
    const client = new Client('127.0.0.1', port);
    const runner = createShowRunner({ send: (address, args) => client.send(address, ...args), onState: () => {} });

    runner.start({ endIndex: 59, offSeconds: 1, fadeSeconds: 1, spreadCues: [{ address: '/sim_resetTermites', count: 2 }] });
    await sleep(1600); // the 1 s pass and 0.6 s into OFF
    runner.stop();
    await sleep(150);
    client.close();
    server.close();

    const addrs = received.map(m => m.address);
    assert.deepEqual(addrs.slice(0, 2), ['/sim_resetSimsOnly', '/sim_on']);
    assert.ok(Math.abs(received[1].args[0] - 1) < 1e-6, `fade arg ${received[1].args[0]}`);
    const indices = received.filter(m => m.address === '/index').map(m => m.args[0]);
    assert.ok(indices.length >= 55 && indices.length <= 60, `${indices.length} /index messages`);
    assert.equal(indices.at(-1), 59);
    assert.equal(addrs.filter(a => a === '/sim_resetTermites').length, 2);
    const passMs = received.find(m => m.address === '/sim_off').at - received.find(m => m.address === '/index').at;
    assert.ok(passMs > 950 && passMs < 1150, `pass took ${passMs.toFixed(0)} ms`);
    // OFF is silent: after the end-of-pass /sim_off only STOP's /sim_off arrives.
    assert.deepEqual(addrs.slice(addrs.indexOf('/sim_off')), ['/sim_off', '/sim_off']);
});
