import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalHost, isLocalOrigin } from './local-origin.js';

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

test('requests must be addressed to this machine (DNS rebinding)', () => {
    for (const h of ['127.0.0.1:8080', 'localhost:8080', '[::1]:8080', 'localhost']) {
        assert.equal(isLocalHost(h), true, h);
    }
    for (const h of [undefined, '', 'evil.example:8080', 'localhost.evil.example:8080', '192.168.1.20:8080']) {
        assert.equal(isLocalHost(h), false, String(h));
    }
});
