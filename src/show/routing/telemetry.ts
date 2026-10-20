// What the audio computer reports back over OSC (UDP :3333, forwarded by the bridge as OSC_MSG),
// so the Sound, Solenoids and Robot cards can show what actually happened instead of computing
// or simulating it. The Max patch doesn't send these yet; the cards fall back when they're stale.
//
//   /routing/sound/<rate|burst|harmony|tones|grains|kick>  <float>
//   /routing/solenoid                                      <slot 0–26> [velocity]
//   /routing/robot/<1–3>/<proximity|servo|touch>           <float>

export const TELEMETRY_FRESH_MS = 2000;
const MAX_STRIKES = 64;
const SOUND_FIELDS = ['rate', 'burst', 'harmony', 'tones', 'grains', 'kick'] as const;
const ROBOT_FIELDS = ['proximity', 'servo', 'touch'] as const;
const SLOTS = 27;

type SoundField = (typeof SOUND_FIELDS)[number];
type RobotField = (typeof ROBOT_FIELDS)[number];

export interface Reading {
    value: number;
    at: number;
}

export interface Telemetry {
    sound: Partial<Record<SoundField, Reading>>;
    strikes: { slot: number; velocity: number; at: number }[]; // newest last
    robot: Partial<Record<RobotField, Reading>>[]; // arms 1–3 at 0–2
}

export const createTelemetry = (): Telemetry => ({ sound: {}, strikes: [], robot: [{}, {}, {}] });

export const fresh = (r: { at: number } | undefined, now: number): boolean => r !== undefined && now - r.at < TELEMETRY_FRESH_MS;

/** A finite number from an OSC argument (numbers or numeric strings), else null. */
function num(arg: unknown): number | null {
    if (typeof arg !== 'number' && !(typeof arg === 'string' && arg.trim() !== '')) return null;
    const v = Number(arg);
    return Number.isFinite(v) ? v : null;
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
        if (!Number.isInteger(value) || value < 0 || value >= SLOTS) return false;
        t.strikes.push({ slot: value, velocity: num(args[1]) ?? 1, at: now });
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
