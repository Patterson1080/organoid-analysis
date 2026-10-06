import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SHOW_CONFIG, normalizeConfig, timing, cueFrames, stateAt, step, offMessage,
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

test('step: a late tick that skips past a cue frame still fires the cue', () => {
    const prev = { pass: 1, phase: 'on', index: 29990 };
    assert.deepEqual(addrs(step(prev, config, msAt(30010))), ['/index', '/sim_resetTermites']);
});

test('step: end of pass fades out once, then OFF is silent', () => {
    const prev = { pass: 1, phase: 'on', index: 179990 };
    const r = step(prev, config, 3_000_500);
    assert.deepEqual(r.messages, [{ address: '/sim_off', args: [{ type: 'f', value: 5 }] }]);
    assert.deepEqual(step(r.next, config, 3_060_000).messages, []);
});

test('step: OFF → pass 2 respawns while black, then fades in', () => {
    const prev = { pass: 1, phase: 'off', index: null };
    assert.deepEqual(addrs(step(prev, config, 3_120_000)), ['/sim_resetSimsOnly', '/sim_on', '/index']);
});

test('step: a stall across OFF closes the old pass before starting the new one', () => {
    const prev = { pass: 1, phase: 'on', index: 100 };
    const a = addrs(step(prev, config, 3_120_000 + 1000));
    assert.equal(a.slice(0, 15).filter(x => x === '/sim_resetTermites' || x === '/sim_resetPhysarum').length, 15);
    assert.deepEqual(a.slice(15), ['/sim_off', '/sim_resetSimsOnly', '/sim_on', '/index']);
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
