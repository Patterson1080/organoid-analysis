import test from 'node:test';
import assert from 'node:assert/strict';
import { createArmMotion, servoTarget, stepArmMotion, visitorCm } from './arms.ts';

test('servo target clamps and maps like Arduino', () => {
    assert.deepEqual([100, 50, 0, 37.9, -5, 250, NaN].map(servoTarget), [180, 90, 0, 66, 0, 180, 180]);
});

test('a small change stays put (deadband)', () => {
    const m = createArmMotion();
    stepArmMotion(m, 55, 100); // target 99: 9° away
    assert.equal(m.phase, 'listening');
    assert.equal(m.pos, 90);
    stepArmMotion(m, 56, 100); // target 100: exactly 10° stays (the sketch moves only past 10)
    assert.equal(m.phase, 'listening');
    stepArmMotion(m, 57, 1); // target 102: 12° moves
    assert.equal(m.phase, 'moving');
});

test('a big change slews at 200°/s, settles, then cools down 2 s', () => {
    const m = createArmMotion();
    for (let i = 0; i < 9; i++) stepArmMotion(m, 100, 50); // 90° at 200°/s = 450 ms
    assert.equal(m.pos, 180);
    assert.equal(m.phase, 'settling');
    stepArmMotion(m, 100, 50);
    stepArmMotion(m, 100, 50);
    assert.equal(m.phase, 'cooldown');
    assert.equal(m.phaseLeftMs, 2000);
    stepArmMotion(m, 0, 1000); // a visitor right at the sensor, unread during the cooldown
    assert.equal(m.pos, 180);
    assert.equal(m.phase, 'cooldown');
    stepArmMotion(m, 0, 1000);
    assert.equal(m.phase, 'listening');
    assert.equal(m.pos, 180);
});

test('a long step slews at most dt × speed', () => {
    const m = createArmMotion();
    stepArmMotion(m, 100, 100);
    assert.equal(m.phase, 'moving');
    assert.equal(m.pos, 110);
});

test('visitors come and go', () => {
    const readings = [0, 1, 2].map(arm => Array.from({ length: 6000 }, (_, i) => visitorCm(arm, i * 100)));
    for (const r of readings) {
        assert.ok(r.every(cm => cm >= 0 && cm <= 100));
        assert.ok(r.filter(cm => cm === 100).length / r.length > 0.6, 'mostly nobody');
        assert.ok(Math.min(...r) < 70, 'someone comes close');
    }
    assert.notDeepEqual(readings[0], readings[1]);
    assert.notDeepEqual(readings[1], readings[2]);
});
