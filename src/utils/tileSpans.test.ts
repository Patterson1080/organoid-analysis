import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTileSpan, nextTileSpan, saveTileSpan } from './tileSpans.ts';

const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

test('spans cycle 1 → 2 → full → 1', () => {
    assert.equal(nextTileSpan('1'), '2');
    assert.equal(nextTileSpan('2'), 'full');
    assert.equal(nextTileSpan('full'), '1');
});

test('a tile starts one column wide', () => {
    assert.equal(loadTileSpan('organoid', memory()), '1');
});

test('each tile remembers its own span', () => {
    const s = memory();
    saveTileSpan('organoid', '2', s);
    saveTileSpan('activity-raster', 'full', s);
    assert.equal(loadTileSpan('organoid', s), '2');
    assert.equal(loadTileSpan('activity-raster', s), 'full');
    assert.equal(loadTileSpan('pca', s), '1');
});

test('corrupt storage falls back to one column', () => {
    const s = memory();
    s.setItem('organoid-analysis.tileSpans', '{not json');
    assert.equal(loadTileSpan('organoid', s), '1');
    s.setItem('organoid-analysis.tileSpans', JSON.stringify({ organoid: 7, pca: 'wide' }));
    assert.equal(loadTileSpan('organoid', s), '1');
    assert.equal(loadTileSpan('pca', s), '1');
});

test('blocked storage never throws', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    assert.equal(loadTileSpan('organoid', blocked), '1');
    assert.doesNotThrow(() => saveTileSpan('organoid', '2', blocked));
});
