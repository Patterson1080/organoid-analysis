import { BURST_FRACTION, stepBurst } from '../src/show/routing/soundFeatures.ts';
import { spikesInWindow } from './show-data.js';

// Monitors: apps that listen to the show without being part of it (Kybyria). They get what the
// show destinations get, plus extras the show destinations never see: the recent neurons'
// positions, the population rate and burst ends, and the /routing/* telemetry relayed.

const LOOPBACK = ['127.0.0.1', 'localhost', '0.0.0.0', '::1'];

// Parse a destination string into { ip, port } entries.
// Accepts a comma-separated list; each entry may be "ip" or "ip:port".
// Entries without a port fall back to the shared defaultPort. Entries whose port is out
// of UDP range are dropped: dgram throws on send, which would kill the show clock.
export function parseDestinations(ipString, defaultPort) {
    return String(ipString || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(entry => {
            const [ip, port] = entry.split(':');
            const parsedPort = port ? parseInt(port, 10) : defaultPort;
            return { ip: ip.trim(), port: Number.isFinite(parsedPort) ? parsedPort : defaultPort };
        })
        .filter(({ ip, port }) => {
            if (Number.isInteger(port) && port > 0 && port < 65536) return true;
            console.warn(`Ignoring OSC destination ${ip}:${port} (port must be 1-65535)`);
            return false;
        });
}

/** The monitors that may be sent to: not a show destination (it would get every message twice,
 *  and the extras), not this bridge's own OSC input (the relay would loop), each once. */
export function monitorsApartFrom(monitors, outputs, inPort, ownAddresses = []) {
    const own = [...LOOPBACK, ...ownAddresses];
    const key = d => `${d.ip}:${d.port}`;
    const taken = new Set(outputs.map(key));
    return monitors.filter(d => {
        const reason = taken.has(key(d)) ? 'already a show output, or listed twice'
            : d.port === inPort && own.includes(d.ip) ? "this bridge's own OSC input" : null;
        if (reason) console.warn(`Ignoring monitor ${key(d)} (${reason})`);
        taken.add(key(d));
        return !reason;
    });
}

/** /x1, /y1 … for the recent-neuron trail, in the form local playback sends: the neurons' own
 *  positions, oldest first. */
export function positionMessages(trail, xPrefix, yPrefix) {
    return trail.flatMap((n, i) => [
        { address: `${xPrefix}${i + 1}`, args: [n.x] },
        { address: `${yPrefix}${i + 1}`, args: [n.y] },
    ]);
}

export const RATE_ADDRESS = '/feature/rate';
export const BURST_ADDRESS = '/feature/burst';

/** The population rate at the index and whether a burst ended since the last tick, as the
 *  routing view's SOUND fallback computes them (soundFeatures.ts), from the bridge's frames.
 *  step(after, index) covers (after, index]; reset() at a new pass. */
export function createFeatureTracker(frames) {
    let peak = 1;
    for (let f = 0; f < frames.frameCount; f++) peak = Math.max(peak, spikesInWindow(frames, f));
    const threshold = BURST_FRACTION * peak;
    let burst = { inBurst: false, ends: 0 };
    return {
        peak,
        reset() {
            burst = { inBurst: false, ends: 0 };
        },
        step(after, index) {
            const before = burst.ends;
            for (let f = Math.max(0, Math.floor(after) + 1); f <= index; f++) burst = stepBurst(burst, spikesInWindow(frames, f), threshold);
            return [
                { address: RATE_ADDRESS, args: [spikesInWindow(frames, index)] },
                { address: BURST_ADDRESS, args: [burst.ends > before ? 1 : 0] },
            ];
        },
    };
}
