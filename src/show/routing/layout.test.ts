import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_COMPUTER, BRIDGE_FED, MEDIA } from './facts.ts';
import { detailLayout, fontPx, hitBox, routingLayout, typeScale } from './layout.ts';
import type { Box } from './layout.ts';

const inside = (b: Box, w: number, h: number) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h && b.w > 0 && b.h > 0;
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const midX = (b: Box) => b.x + b.w / 2;
const contains = (outer: Box, b: Box) => b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h;

function assertCardsApart(w: number, h: number) {
    const { cards } = routingLayout(w, h);
    for (const k of MEDIA) assert.ok(inside(cards[k], w, h), `${k} inside ${w}×${h}: ${JSON.stringify(cards[k])}`);
    for (const a of MEDIA) for (const b of MEDIA) {
        if (a < b) assert.ok(!overlap(cards[a], cards[b]), `${a} and ${b} overlap at ${w}×${h}`);
    }
}

test('landscape puts bridge-fed media left and the audio computer right', () => {
    const l = routingLayout(1600, 600);
    assert.equal(l.orientation, 'landscape');
    assertCardsApart(1600, 600);
    for (const k of BRIDGE_FED) assert.ok(midX(l.cards[k]) < l.centre.cx, `${k} left of centre`);
    for (const k of AUDIO_COMPUTER) {
        assert.ok(midX(l.cards[k]) > l.centre.cx, `${k} right of centre`);
        assert.ok(contains(l.audioFrame, l.cards[k]), `${k} inside the audio computer frame`);
    }
});

test('portrait stacks them above and below', () => {
    const l = routingLayout(600, 1200);
    assert.equal(l.orientation, 'portrait');
    assertCardsApart(600, 1200);
    for (const k of BRIDGE_FED) assert.ok(l.cards[k].y + l.cards[k].h <= l.centre.cy - l.centre.r, `${k} above the centre`);
    for (const k of AUDIO_COMPUTER) assert.ok(l.cards[k].y >= l.centre.cy + l.centre.r, `${k} below the centre`);
});

test('orientation switches at w/h 1.1', () => {
    assert.equal(routingLayout(1100, 1000).orientation, 'landscape');
    assert.equal(routingLayout(1090, 1000).orientation, 'portrait');
});

test('extreme areas stay inside and apart', () => {
    assertCardsApart(3000, 500);
    assertCardsApart(320, 900);
    assert.ok(fontPx(11, typeScale(320, 900)) >= 8);
});

test('hitBox finds each card and misses the centre', () => {
    const l = routingLayout(1600, 900);
    for (const k of MEDIA) {
        const b = l.cards[k];
        assert.equal(hitBox(l.cards, b.x + b.w / 2, b.y + b.h / 2), k);
    }
    assert.equal(hitBox(l.cards, l.centre.cx, l.centre.cy), null);
});

test('typeScale clamps', () => {
    assert.equal(typeScale(540, 540), 1);
    assert.equal(typeScale(300, 300), 0.85);
    assert.equal(typeScale(2000, 2000), 1.8);
});

test('detail layouts', () => {
    const l = detailLayout(1600, 900);
    assert.equal(l.orientation, 'landscape');
    assert.ok(l.source.x + l.source.w <= l.story.x, 'source left of story');
    assert.ok(l.rail.y >= l.story.y + l.story.h, 'rail below story');
    for (const k of MEDIA) assert.ok(contains(l.rail, l.railTiles[k]), `${k} tile inside the rail`);
    for (const a of MEDIA) for (const b of MEDIA) {
        if (a < b) assert.ok(!overlap(l.railTiles[a], l.railTiles[b]), `${a} and ${b} tiles overlap`);
    }
    const p = detailLayout(900, 1600);
    assert.equal(p.orientation, 'portrait');
    assert.ok(p.source.y + p.source.h <= p.story.y, 'source above story');
});
