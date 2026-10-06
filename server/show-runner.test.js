import test from 'node:test';
import assert from 'node:assert/strict';
import { createShowRunner } from './show-runner.js';

// Fake clock + timers: tests move time by hand and fire the pending tick.
function harness() {
    let clock = 0;
    const sent = [];
    const states = [];
    const timers = [];
    const runner = createShowRunner({
        send: (address, args) => sent.push({ address, args, at: clock }),
        onState: s => states.push(s),
        now: () => clock,
        setTimer: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length; },
        clearTimer: id => { timers[id - 1].cancelled = true; },
    });
    const fireNext = () => {
        const t = timers.at(-1);
        clock = Math.max(clock, t.at) + 0.01;
        t.fn();
    };
    return { runner, sent, states, timers, fireNext, setClock: ms => { clock = ms; } };
}

test('start sends the pass-start burst at once and publishes ON state', () => {
    const h = harness();
    assert.equal(h.runner.start({}), true);
    assert.deepEqual(h.sent.map(m => m.address), ['/sim_resetSimsOnly', '/sim_on', '/index']);
    const s = h.states.at(-1);
    assert.equal(s.running, true);
    assert.equal(s.phase, 'on');
    assert.equal(s.pass, 1);
    assert.equal(s.index, 0);
});

test('a second START while running is ignored', () => {
    const h = harness();
    h.runner.start({});
    assert.equal(h.runner.start({ fps: 30 }), false);
    assert.equal(h.runner.getState().config.fps, 60);
    assert.equal(h.sent.filter(m => m.address === '/sim_on').length, 1);
});

test('ticks land on frame boundaries and send one /index per frame', () => {
    const h = harness();
    h.runner.start({});
    assert.ok(Math.abs(h.timers.at(-1).at - 1000 / 60) < 1e-9);
    h.fireNext();
    assert.deepEqual(h.sent.at(-1).args, [1]);
});

test('a late tick skips ahead to the next future boundary (no catch-up burst)', () => {
    const h = harness();
    h.runner.start({});
    h.setClock(100); // the timer fires 83 ms late
    h.timers.at(-1).fn();
    assert.deepEqual(h.sent.at(-1).args, [6]);                     // floor(100 * 60 / 1000)
    assert.ok(Math.abs(h.timers.at(-1).at - 7000 / 60) < 1e-9);   // next boundary at 116.67 ms
});

test('broadcasts every 4th tick and on every phase change', () => {
    const h = harness();
    h.runner.start({ endIndex: 59, offSeconds: 1 }); // 1 s pass, 1 s off
    for (let i = 0; i < 8; i++) h.fireNext();
    assert.equal(h.states.length, 3); // ticks 0, 4, 8
    h.setClock(1000.5);
    h.timers.at(-1).fn();
    assert.equal(h.states.at(-1).phase, 'off');
    assert.equal(h.sent.at(-1).address, '/sim_off');
});

test('stop sends /sim_off, cancels the clock and publishes STOPPED', () => {
    const h = harness();
    h.runner.start({ fadeSeconds: 3 });
    assert.equal(h.runner.stop(), true);
    assert.deepEqual(h.sent.at(-1), { address: '/sim_off', args: [{ type: 'f', value: 3 }], at: 0 });
    assert.equal(h.timers.at(-1).cancelled, true);
    assert.equal(h.states.at(-1).running, false);
    assert.equal(h.states.at(-1).phase, 'stopped');
    assert.equal(h.runner.stop(), false);
});

test('stopped state still carries config, cues and timing for the panel', () => {
    const s = harness().runner.getState();
    assert.equal(s.running, false);
    assert.equal(s.phase, 'stopped');
    assert.equal(s.config.endIndex, 179999);
    assert.equal(s.cues.length, 15);
    assert.equal(s.timing.cycleMs, 3_120_000);
});
