import { normalizeConfig, cueFrames, timing, step, offMessage } from './show-schedule.js';

// Runs the show schedule in real time. Ticks are aimed at absolute frame deadlines
// (t0 + n / fps) so timer jitter never accumulates; the index itself comes from elapsed
// time and step() sends any frames a late tick skipped (show-schedule.js), so lateness
// never becomes drift or a gap.
//   send(address, args) — deliver one OSC message to every destination
//   onState(state)      — publish state, after every tick
// now / setTimer / clearTimer are injectable so tests can drive a fake clock.
export function createShowRunner({
    send,
    onState,
    now = () => performance.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
}) {
    let config = normalizeConfig();
    let cues = cueFrames(config);
    let running = false;
    let timer = null;
    let t0 = 0;
    let frame = 0;      // deadline counter: the next tick is due at t0 + frame / fps
    let prev = null;    // step() position of the last tick
    let current = null; // stateAt() of the last tick

    function getState() {
        if (!running) {
            return {
                running: false, pass: 0, phase: 'stopped', index: null,
                phaseElapsedMs: 0, phaseDurationMs: 0, config, cues, timing: timing(config),
            };
        }
        return { running: true, ...current, config, cues, timing: timing(config) };
    }

    function tick() {
        timer = null;
        const r = step(prev, config, now() - t0, cues);
        for (const m of r.messages) send(m.address, m.args);
        prev = r.next;
        current = r.state;
        onState(getState());
        // Next frame boundary that is still ahead (skips ahead when this tick ran late).
        // Multiply by fps rather than divide by the period: 100 / (1000 / 60) is 5.999….
        frame = Math.max(frame + 1, Math.floor(((now() - t0) * config.fps) / 1000) + 1);
        timer = setTimer(tick, Math.max(0, t0 + (frame * 1000) / config.fps - now()));
    }

    function start(partial) {
        if (running) return false;
        config = normalizeConfig(partial);
        cues = cueFrames(config);
        running = true;
        t0 = now();
        frame = 0;
        prev = null;
        current = null;
        tick();
        return true;
    }

    function stop() {
        if (!running) return false;
        if (timer !== null) clearTimer(timer);
        timer = null;
        running = false;
        prev = null;
        current = null;
        const off = offMessage(config);
        send(off.address, off.args);
        onState(getState());
        return true;
    }

    return { start, stop, getState, isRunning: () => running };
}
