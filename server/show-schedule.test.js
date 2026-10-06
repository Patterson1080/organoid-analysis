import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SHOW_CONFIG, normalizeConfig, timing, cueFrames, stateAt, step, offMessage, MAX_FILL_FRAMES,
} from './show-schedule.js';

const config = normalizeConfig();
const addrs = r => r.messages.map(m => m.address);
const msAt = index => (index * 1000) / 60 + 1; // elapsed ms safely inside frame `index` at 60 fps

test('defaults reproduce the EoC tester loop: 50 min pass, 52 min cycle', () => {
    assert.deepEqual(timing(config), { passFrames: 180000, passMs: 3_000_000, cycleMs: 3_120_000 });
});

test('normalizeConfig fills defaults, parses form strings, repairs bad input', () => {
    assert.deepEqual(config, { ...DEFAULT_SHOW_CONFIG });
    const c = normalizeConfig({
        startIndex: '600', endIndex: '0', fps: '-1', offSeconds: '', passStartCue: '',
        spreadCues: [{ address: ' /a ', count: '2' }, { address: '', count: 3 }],
    });
    assert.equal(c.startIndex, 0);
    assert.equal(c.endIndex, 600);
    assert.equal(c.fps, 60);
    assert.equal(c.offSeconds, 120);
    assert.equal(c.passStartCue, '');
    assert.deepEqual(c.spreadCues, [{ address: '/a', count: 2 }]);
});

test('cueFrames: 5 termite + 10 physarum resets spread evenly, sorted', () => {
    const cues = cueFrames(config);
    assert.equal(cues.length, 15);
    assert.deepEqual(
        cues.filter(c => c.address === '/sim_resetTermites').map(c => c.frame),
        [30000, 60000, 90000, 119999, 149999],
    );
    const frames = cues.map(c => c.frame);
    assert.deepEqual(frames, [...frames].sort((a, b) => a - b));
    assert.ok(frames.every(f => f > 0 && f < 179999));
});

test('stateAt: ON ramps the index at fps, OFF follows, pass 2 restarts at startIndex', () => {
    assert.deepEqual(stateAt(config, 0), { pass: 1, phase: 'on', index: 0, phaseElapsedMs: 0, phaseDurationMs: 3_000_000 });
    assert.equal(stateAt(config, 1000).index, 60);
    assert.equal(stateAt(config, 2_999_999).index, 179999);
    assert.deepEqual(stateAt(config, 3_000_000), { pass: 1, phase: 'off', index: null, phaseElapsedMs: 0, phaseDurationMs: 120_000 });
    assert.equal(stateAt(config, 3_119_999).phase, 'off');
    assert.deepEqual(stateAt(config, 3_120_000), { pass: 2, phase: 'on', index: 0, phaseElapsedMs: 0, phaseDurationMs: 3_000_000 });
});

test('step: first tick resets, fades in, then sends index 0', () => {
    const r = step(null, config, 0);
    assert.deepEqual(r.messages, [
        { address: '/sim_resetSimsOnly', args: [1] },
        { address: '/sim_on', args: [{ type: 'f', value: 5 }] },
        { address: '/index', args: [0] },
    ]);
    assert.deepEqual(r.next, { pass: 1, phase: 'on', index: 0 });
});

test('step: same frame sends nothing; next frame sends only /index', () => {
    const first = step(null, config, 0);
    assert.deepEqual(step(first.next, config, 5).messages, []);
    assert.deepEqual(step(first.next, config, msAt(1)).messages, [{ address: '/index', args: [1] }]);
});

test('step: a late tick sends every skipped frame, each cue right after its frame', () => {
    const r = step({ pass: 1, phase: 'on', index: 29990 }, config, msAt(30010));
    assert.deepEqual(r.messages.filter(m => m.address === '/index').map(m => m.args[0]),
        Array.from({ length: 20 }, (_, i) => 29991 + i));
    const cue = r.messages.findIndex(m => m.address === '/sim_resetTermites');
    assert.deepEqual(r.messages[cue - 1], { address: '/index', args: [30000] });
});

test('step: a gap longer than MAX_FILL_FRAMES jumps, firing jumped cues once', () => {
    const r = step({ pass: 1, phase: 'on', index: 0 }, config, msAt(40000));
    const a = addrs(r);
    assert.deepEqual(a.slice(0, 3), ['/sim_resetPhysarum', '/sim_resetTermites', '/sim_resetPhysarum']); // 16364, 30000, 32727
    assert.deepEqual(r.messages.slice(3).map(m => m.args[0]),
        Array.from({ length: MAX_FILL_FRAMES }, (_, i) => 40000 - MAX_FILL_FRAMES + 1 + i));
});

test('step: end of pass fades out once, then OFF is silent', () => {
    const prev = { pass: 1, phase: 'on', index: 179990 };
    const r = step(prev, config, 3_000_500);
    assert.deepEqual(r.messages.slice(0, 9).map(m => m.args[0]), [179991, 179992, 179993, 179994, 179995, 179996, 179997, 179998, 179999]);
    assert.deepEqual(r.messages.slice(9), [{ address: '/sim_off', args: [{ type: 'f', value: 5 }] }]);
    assert.deepEqual(step(r.next, config, 3_060_000).messages, []);
});

test('step: OFF → pass 2 respawns while black, then fades in', () => {
    const prev = { pass: 1, phase: 'off', index: null };
    assert.deepEqual(addrs(step(prev, config, 3_120_000)), ['/sim_resetSimsOnly', '/sim_on', '/index']);
});

test('step: a stall across OFF closes the old pass before starting the new one', () => {
    const prev = { pass: 1, phase: 'on', index: 100 };
    const a = addrs(step(prev, config, 3_120_000 + 1000));
    assert.ok(a.slice(0, 15).every(x => x === '/sim_resetTermites' || x === '/sim_resetPhysarum'));
    assert.deepEqual(a.slice(15, 45), Array(30).fill('/index'));
    assert.deepEqual(a.slice(45, 48), ['/sim_off', '/sim_resetSimsOnly', '/sim_on']);
    assert.deepEqual(a.slice(48), Array(30).fill('/index'));
});

test('step: offSeconds 0 loops passes back to back with no /sim_off', () => {
    const c = normalizeConfig({ endIndex: 599, offSeconds: 0, spreadCues: [] });
    const prev = { pass: 1, phase: 'on', index: 599 };
    assert.deepEqual(addrs(step(prev, c, 10_000)), ['/sim_resetSimsOnly', '/sim_on', '/index']);
});

test('step: empty passStartCue sends none', () => {
    assert.deepEqual(addrs(step(null, normalizeConfig({ passStartCue: '' }), 0)), ['/sim_on', '/index']);
});

test('offMessage: STOP fades out with the configured fade', () => {
    assert.deepEqual(offMessage(normalizeConfig({ fadeSeconds: 2 })), { address: '/sim_off', args: [{ type: 'f', value: 2 }] });
});

test('normalizeConfig caps values that would spin the clock or flood cues', () => {
    const c = normalizeConfig({ fps: 1e9, endIndex: 1e12, offSeconds: 1e9, spreadCues: [{ address: '/a', count: 1e9 }] });
    assert.equal(c.fps, 1000);
    assert.equal(c.endIndex, 100_000_000);
    assert.equal(c.offSeconds, 86_400);
    assert.deepEqual(c.spreadCues, [{ address: '/a', count: 1000 }]);
});
