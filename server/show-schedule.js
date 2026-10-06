// Show-mode schedule for EoC-biomes: what to send, and when. Pure functions — no timers,
// no sockets — so the whole 52-minute cycle is testable in milliseconds. show-runner.js
// owns the clock and sends whatever step() returns.
//
// One cycle = a pass (index startIndex → endIndex at fps) + offSeconds of silence.
// Index = data milliseconds = EoC firing-blob frame (180 s recording, 1 frame/ms).

export const DEFAULT_SHOW_CONFIG = Object.freeze({
    startIndex: 0,
    endIndex: 179999,      // inclusive: 180000 frames, the whole EoC blob
    fps: 60,               // 180000 / 60 = 3000 s = 50 min per pass
    offSeconds: 120,
    fadeSeconds: 5,
    indexAddress: '/index',
    passStartCue: '/sim_resetSimsOnly',
    onAddress: '/sim_on',
    offAddress: '/sim_off',
    spreadCues: Object.freeze([
        Object.freeze({ address: '/sim_resetTermites', count: 5 }),
        Object.freeze({ address: '/sim_resetPhysarum', count: 10 }),
    ]),
});

const toNumber = (value, fallback) => {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const toAddress = (value, fallback) => (typeof value === 'string' ? value.trim() : fallback);

// Fill defaults and repair what the clock can't run (form inputs arrive as strings).
// passStartCue may be '' (send none); the other addresses fall back to their defaults.
export function normalizeConfig(partial = {}) {
    const d = DEFAULT_SHOW_CONFIG;
    let startIndex = Math.max(0, Math.floor(toNumber(partial.startIndex, d.startIndex)));
    let endIndex = Math.max(0, Math.floor(toNumber(partial.endIndex, d.endIndex)));
    if (endIndex < startIndex) [startIndex, endIndex] = [endIndex, startIndex];
    const fps = toNumber(partial.fps, d.fps);
    const spreadCues = (Array.isArray(partial.spreadCues) ? partial.spreadCues : d.spreadCues)
        .filter(c => c && typeof c.address === 'string' && c.address.trim() !== '')
        .map(c => ({ address: c.address.trim(), count: Math.max(0, Math.floor(toNumber(c.count, 0))) }));
    return {
        startIndex,
        endIndex,
        fps: fps > 0 ? fps : d.fps,
        offSeconds: Math.max(0, toNumber(partial.offSeconds, d.offSeconds)),
        fadeSeconds: Math.max(0, toNumber(partial.fadeSeconds, d.fadeSeconds)),
        indexAddress: toAddress(partial.indexAddress, d.indexAddress) || d.indexAddress,
        passStartCue: toAddress(partial.passStartCue, d.passStartCue),
        onAddress: toAddress(partial.onAddress, d.onAddress) || d.onAddress,
        offAddress: toAddress(partial.offAddress, d.offAddress) || d.offAddress,
        spreadCues,
    };
}

export function timing(config) {
    const passFrames = config.endIndex - config.startIndex + 1;
    const passMs = (passFrames / config.fps) * 1000;
    return { passFrames, passMs, cycleMs: passMs + config.offSeconds * 1000 };
}

// N cues of one address land on interior frames splitting the pass into N + 1 parts —
// the formula EoC's tools/osc_index_tester.py uses. Sorted; ties keep config order.
export function cueFrames(config) {
    const span = config.endIndex - config.startIndex;
    const cues = [];
    for (const { address, count } of config.spreadCues) {
        for (let k = 1; k <= count; k++) {
            cues.push({ address, frame: Math.round(config.startIndex + (span * k) / (count + 1)) });
        }
    }
    return cues.sort((a, b) => a.frame - b.frame);
}

// Where the show is at elapsedMs since START. The index comes from elapsed time, never
// from a counter, so a pass lasts exactly passMs however late the ticks fire.
export function stateAt(config, elapsedMs) {
    const { passMs, cycleMs } = timing(config);
    const elapsed = Math.max(0, elapsedMs);
    const cycle = Math.floor(elapsed / cycleMs);
    const t = elapsed - cycle * cycleMs;
    if (t < passMs) {
        const index = Math.min(config.endIndex, config.startIndex + Math.floor((t * config.fps) / 1000));
        return { pass: cycle + 1, phase: 'on', index, phaseElapsedMs: t, phaseDurationMs: passMs };
    }
    return { pass: cycle + 1, phase: 'off', index: null, phaseElapsedMs: t - passMs, phaseDurationMs: cycleMs - passMs };
}

// /sim_on · /sim_off argument. Explicit float tag: node-osc infers 5 as int32. A fresh
// object per call — node-osc rewrites arg.type in place while encoding.
export const fadeArg = config => ({ type: 'f', value: config.fadeSeconds });

export function offMessage(config) {
    return { address: config.offAddress, args: [fadeArg(config)] };
}

// One clock tick: the OSC messages that carry the show from `prev` (last tick's
// { pass, phase, index }, null on the first tick after START) to now.
//   leaving a pass's ON phase → its remaining cues, then the off cue
//   entering a new pass       → pass-start cue, on cue, then /index from startIndex
//   within ON                 → /index when it changed, plus every cue in (prev, index]
// Cues fire on crossing, not equality, so a late tick that skips frames never drops one.
export function step(prev, config, elapsedMs, cues = cueFrames(config)) {
    const now = stateAt(config, elapsedMs);
    const messages = [];
    const send = (address, ...args) => messages.push({ address, args });
    const fireCues = (after, upTo) => {
        for (const cue of cues) {
            if (cue.frame > after && cue.frame <= upTo) send(cue.address, 1);
        }
    };

    const stillInSameOn = prev && prev.pass === now.pass && now.phase === 'on';
    if (prev && prev.phase === 'on' && !stillInSameOn) {
        fireCues(prev.index, config.endIndex);
        if (config.offSeconds > 0) send(config.offAddress, fadeArg(config));
    }

    if (now.phase === 'on') {
        const newPass = !prev || prev.pass !== now.pass;
        if (newPass) {
            if (config.passStartCue) send(config.passStartCue, 1);
            send(config.onAddress, fadeArg(config));
        }
        if (newPass || now.index !== prev.index) {
            send(config.indexAddress, now.index);
            fireCues(newPass ? config.startIndex - 1 : prev.index, now.index);
        }
    }

    return { next: { pass: now.pass, phase: now.phase, index: now.index }, state: now, messages };
}
