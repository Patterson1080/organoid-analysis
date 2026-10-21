import test from 'node:test';
import assert from 'node:assert/strict';
import { activityEnvelope, soundCaptions, soundPanels } from './soundLayout.ts';
import type { Box } from './layout.ts';

const EPS = 1e-9;
const inside = (o: Box, i: Box) => i.x >= o.x - EPS && i.y >= o.y - EPS && i.x + i.w <= o.x + o.w + EPS && i.y + i.h <= o.y + o.h + EPS;
const overlap = (a: Box, b: Box) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

test('sound panels tile the story at any aspect', () => {
    const stories: Box[] = [{ x: 40, y: 30, w: 1600, h: 700 }, { x: 0, y: 0, w: 2960, h: 420 }, { x: 12, y: 50, w: 300, h: 860 }];
    for (const story of stories) {
        const boxes = Object.values(soundPanels(story));
        assert.equal(boxes.length, 4);
        for (const b of boxes) {
            assert.ok(inside(story, b), `${JSON.stringify(b)} outside ${JSON.stringify(story)}`);
            assert.ok(b.w > 0 && b.h > 0);
        }
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]));
    }
});

test("activity envelope keeps each column's peak", () => {
    const a = new Float32Array([0, 1, 0, 0.5]);
    assert.deepEqual(Array.from(activityEnvelope(a, 2, 0, 3)), [1, 0.5]);
    assert.deepEqual(Array.from(activityEnvelope(a, 1, 2, 3)), [0.5]);
});

test('captions say the draws are simulated, playing or held', () => {
    for (const moving of [true, false]) {
        const c = soundCaptions(moving);
        assert.match(c.voices, /drawn like Max draws them/);
        assert.match(c.output, /drawn like Max draws them/);
    }
    assert.match(soundCaptions(false).voices, /plays on at the last values/);
});
