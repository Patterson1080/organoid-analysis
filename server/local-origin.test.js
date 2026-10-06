import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalOrigin } from './local-origin.js';

test('local pages and non-browser clients are accepted', () => {
    for (const o of [undefined, '', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:4173', 'file://']) {
        assert.equal(isLocalOrigin(o), true, String(o));
    }
});

test('remote sites, sandboxed frames and junk are refused', () => {
    for (const o of ['https://evil.example', 'http://192.168.1.20:5173', 'http://localhost.evil.example', 'null', 'not a url']) {
        assert.equal(isLocalOrigin(o), false, o);
    }
});
