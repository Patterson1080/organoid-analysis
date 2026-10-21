// What the audio computer and the arms report back over OSC (UDP :3333, forwarded by the bridge
// as OSC_MSG), so the Sound, Solenoids and Robot cards can show what actually happened instead of
// computing or simulating it. The modular arms send /routing/robot; Max doesn't send /routing/sound
// or /routing/solenoid yet. The cards fall back when a value goes stale.
//
//   /routing/sound/<rate|burst|harmony|tones|grains|kick>  <float>
//   /routing/solenoid                                      <slot 0–26> [velocity]
//   /routing/robot/<1–3>/<proximity|servo|touch>           <float>

import { BACKBONE_COUNT, ROBOT_FACTS } from './facts.ts';

const TELEMETRY_FRESH_MS = 2000;
const MAX_STRIKES = 64;
const SOUND_FIELDS = ['rate', 'burst', 'harmony', 'tones', 'grains', 'kick'] as const;
const ROBOT_FIELDS = ['proximity', 'servo', 'touch'] as const;

type SoundField = (typeof SOUND_FIELDS)[number];
type RobotField = (typeof ROBOT_FIELDS)[number];

export interface Reading {
    value: number;
    at: number;
}

export interface Telemetry {
    sound: Partial<Record<SoundField, Reading>>;
    strikes: { slot: number; velocity: number; at: number; seq: number }[]; // newest last
    robot: Partial<Record<RobotField, Reading>>[]; // arms 1–3 at 0–2
    seq: number; // the last strike's number: strikes can share a timestamp
}

export const createTelemetry = (): Telemetry => ({ sound: {}, strikes: [], robot: Array.from({ length: ROBOT_FACTS.arms }, () => ({})), seq: 0 });

export const fresh = (r: { at: number } | undefined, now: number): boolean => r !== undefined && now - r.at < TELEMETRY_FRESH_MS;

export const freshValue = (r: Reading | undefined, now: number): number | null => (r && fresh(r, now) ? r.value : null);

/** A finite number from an OSC argument (numbers or numeric strings), else null. */
function num(arg: unknown): number | null {
    if (typeof arg !== 'number' && !(typeof arg === 'string' && arg.trim() !== '')) return null;
    const v = Number(arg);
    return Number.isFinite(v) ? v : null;
}

/** Every /routing/* message belongs to the routing view, well-formed or not, so none of them
 *  reaches the rest of the app (at 10 Hz+ that would re-render it). Records the well-formed ones;
 *  true when the message was the routing view's. */
export function consumeRoutingOsc(t: Telemetry, address: unknown, args: unknown[], now: number): boolean {
    if (typeof address !== 'string' || !address.startsWith('/routing/')) return false;
    applyTelemetry(t, address, Array.isArray(args) ? args : [], now);
    return true;
}

/** Record one inbound message; true only for a well-formed /routing/* message. */
export function applyTelemetry(t: Telemetry, address: string, args: unknown[], now: number): boolean {
    const parts = address.split('/'); // ['', 'routing', ...]
    if (parts[1] !== 'routing') return false;
    const value = num(args[0]);
    if (value === null) return false;

    if (parts.length === 4 && parts[2] === 'sound' && (SOUND_FIELDS as readonly string[]).includes(parts[3])) {
        t.sound[parts[3] as SoundField] = { value, at: now };
        return true;
    }
    if (parts.length === 3 && parts[2] === 'solenoid') {
        if (!Number.isInteger(value) || value < 0 || value >= BACKBONE_COUNT) return false;
        t.strikes.push({ slot: value, velocity: num(args[1]) ?? 1, at: now, seq: ++t.seq });
        if (t.strikes.length > MAX_STRIKES) t.strikes.splice(0, t.strikes.length - MAX_STRIKES);
        return true;
    }
    if (parts.length === 5 && parts[2] === 'robot' && (ROBOT_FIELDS as readonly string[]).includes(parts[4])) {
        const arm = Number(parts[3]);
        if (!Number.isInteger(arm) || arm < 1 || arm > t.robot.length) return false;
        t.robot[arm - 1][parts[4] as RobotField] = { value, at: now };
        return true;
    }
    return false;
}
