import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureTracker, monitorsApartFrom, parseDestinations, positionMessages } from './monitor.js';
import { spikesInWindow } from './show-data.js';

// Frames from a list of spike counts per ms (which neuron fires doesn't matter here).
const framesOf = counts => {
    const offsets = [0];
    for (const c of counts) offsets.push(offsets.at(-1) + c);
    return { frameCount: counts.length, offsets: Int32Array.from(offsets), ids: new Uint16Array(offsets.at(-1)).fill(1) };
};

test('parseDestinations takes ip and ip:port, and drops ports out of range', () => {
    assert.deepEqual(parseDestinations('10.0.0.2, 127.0.0.1:3334 ,,x:99999', 1234), [{ ip: '10.0.0.2', port: 1234 }, { ip: '127.0.0.1', port: 3334 }]);
    assert.deepEqual(parseDestinations('', 1234), []);
});

test('a monitor is not a show output, not listed twice, and not the bridge itself', () => {
    const outputs = [{ ip: '127.0.0.1', port: 1234 }];
    const monitors = parseDestinations('127.0.0.1:3334, 127.0.0.1:1234, 127.0.0.1:3334, localhost:3333, 192.168.1.9:3333, 10.0.0.7:3333', 1234);
    assert.deepEqual(monitorsApartFrom(monitors, outputs, 3333, ['192.168.1.9']), [{ ip: '127.0.0.1', port: 3334 }, { ip: '10.0.0.7', port: 3333 }]);
});

test("positions are the trail's own x and y, numbered from 1", () => {
    assert.deepEqual(positionMessages([{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.1 }], '/x', '/y'), [
        { address: '/x1', args: [0.25] }, { address: '/y1', args: [0.5] },
        { address: '/x2', args: [0.75] }, { address: '/y2', args: [0.1] },
    ]);
    assert.deepEqual(positionMessages([], '/x', '/y'), []);
});

test('spikesInWindow counts (index − window, index], clipped to the recording', () => {
    const frames = framesOf([1, 2, 3, 4]);
    assert.equal(spikesInWindow(frames, 0), 1);
    assert.equal(spikesInWindow(frames, 3, 2), 7);
    assert.equal(spikesInWindow(frames, 4, 2), 4); // one past the end: only the last frame is in the window
    assert.equal(spikesInWindow(frames, 99, 2), 0);
    assert.equal(spikesInWindow(frames, -1), 0);
});

test('the tracker sends the rate at the index and flags a burst end once, even on a late tick', () => {
    // 300 quiet ms, a 10 ms burst of 10 spikes/ms, then quiet: the 100 ms rate peaks at 100, so a
    // burst is rate >= 20, from the 2nd burst ms until 100 ms after it thins out.
    const counts = [...Array(300).fill(0), ...Array(10).fill(10), ...Array(300).fill(0)];
    const t = createFeatureTracker(framesOf(counts));
    assert.equal(t.peak, 100);
    assert.deepEqual(t.step(-1, 299), [{ address: '/feature/rate', args: [0] }, { address: '/feature/burst', args: [0] }]);
    assert.deepEqual(t.step(299, 305).map(m => m.args[0]), [60, 0]);
    // One late tick that covers the whole decay still reports the end.
    assert.deepEqual(t.step(305, 420).map(m => m.args[0]), [0, 1]);
    assert.deepEqual(t.step(420, 421).map(m => m.args[0]), [0, 0]);
    // A new pass starts outside a burst.
    t.step(421, 305);
    t.reset();
    assert.deepEqual(t.step(-1, 0).map(m => m.args[0]), [0, 0]);
});
