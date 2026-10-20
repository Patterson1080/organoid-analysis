import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTelemetry, createTelemetry, fresh } from './telemetry.ts';

test('sound readings', () => {
    const t = createTelemetry();
    assert.equal(applyTelemetry(t, '/routing/sound/rate', [12.5], 1000), true);
    assert.deepEqual(t.sound.rate, { value: 12.5, at: 1000 });
    assert.equal(fresh(t.sound.rate, 2999), true);
    assert.equal(fresh(t.sound.rate, 3000), false);
    assert.equal(fresh(t.sound.kick, 1000), false);
});

test('robot readings are per arm, 1-3', () => {
    const t = createTelemetry();
    assert.equal(applyTelemetry(t, '/routing/robot/2/servo', [90], 5), true);
    assert.equal(t.robot[1].servo?.value, 90);
    assert.equal(t.robot[0].servo, undefined);
    assert.equal(applyTelemetry(t, '/routing/robot/4/servo', [90], 5), false);
    assert.equal(applyTelemetry(t, '/routing/robot/0/servo', [90], 5), false);
});

test('a strike, velocity defaults to 1', () => {
    const t = createTelemetry();
    assert.equal(applyTelemetry(t, '/routing/solenoid', [3, 0.8], 7), true);
    assert.deepEqual(t.strikes.at(-1), { slot: 3, velocity: 0.8, at: 7 });
    assert.equal(applyTelemetry(t, '/routing/solenoid', [5], 8), true);
    assert.equal(t.strikes.at(-1)?.velocity, 1);
    assert.equal(applyTelemetry(t, '/routing/solenoid', [27], 9), false);
    assert.equal(t.strikes.length, 2);
});

test('malformed and foreign messages are ignored', () => {
    const cases: [string, unknown[]][] = [
        ['/row', [5]],
        ['/routing/sound/rate', ['x']],
        ['/routing/sound/rate', []],
        ['/routing/sound/rate', [NaN]],
        ['/routing/unknown', [1]],
    ];
    for (const [address, args] of cases) {
        const t = createTelemetry();
        assert.equal(applyTelemetry(t, address, args, 1), false, `${address} ${JSON.stringify(args)}`);
        assert.deepEqual(t, createTelemetry());
    }
});

test('strikes keep the newest 64', () => {
    const t = createTelemetry();
    for (let i = 0; i < 70; i++) applyTelemetry(t, '/routing/solenoid', [i % 27], i);
    assert.equal(t.strikes.length, 64);
    assert.equal(t.strikes[0].slot, 6); // the 7th strike is now the oldest kept
});
