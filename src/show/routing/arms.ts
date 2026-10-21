// The arms as their firmware moves them: ProximityServoArms_Currents.ino (the CURRENTS show) and the
// modular rebuild's `currents`/`hybrid` modes share these rules. An ultrasonic sensor at the tip
// reads 0–100 cm (no echo = 100, nobody there); the servo aims at map(d, 0, 100, 0, 180), moves
// only past a 10° deadband, ramps at 200°/s, settles 100 ms, then ignores the sensor for 2 s.

export const ARM_RULES = {
    rangeCm: 100,
    servoMax: 180,
    rest: 90, // the sketch's reset() angle at boot
    deadbandDeg: 10,
    slewDps: 200, // the sketch's 1° per 5 ms ramp
    settleMs: 100,
    cooldownMs: 2000,
    vertebrae: 8,
} as const;

/** Out-of-range distances clamp; an unreadable one counts as nobody there. */
export const readCm = (cm: number) => (Number.isFinite(cm) ? Math.min(ARM_RULES.rangeCm, Math.max(0, cm)) : ARM_RULES.rangeCm);

/** Arduino's `map(d, 0, 100, 0, 180)`: the float distance truncates to a long, then integer math. */
export function servoTarget(cm: number): number {
    return Math.trunc((Math.trunc(readCm(cm)) * ARM_RULES.servoMax) / ARM_RULES.rangeCm);
}

export type ArmPhase = 'listening' | 'moving' | 'settling' | 'cooldown';

export interface ArmMotion {
    pos: number; // servo angle now
    target: number;
    phase: ArmPhase;
    phaseLeftMs: number; // settling or cooldown time left
    cm: number; // the last reading the arm took
}

export const createArmMotion = (rest: number = ARM_RULES.rest): ArmMotion =>
    ({ pos: rest, target: rest, phase: 'listening', phaseLeftMs: 0, cm: ARM_RULES.rangeCm });

/** One step of the firmware's loop for this arm; `cm` is what the sensor would read now. A step
 *  can cross phases: a move that ends early settles in the time left. */
export function stepArmMotion(m: ArmMotion, cm: number, dtMs: number): void {
    let dt = dtMs;
    while (dt > 0) {
        if (m.phase === 'settling' || m.phase === 'cooldown') {
            const used = Math.min(dt, m.phaseLeftMs);
            m.phaseLeftMs -= used;
            dt -= used;
            if (m.phaseLeftMs > 0) continue;
            if (m.phase === 'settling') {
                m.phase = 'cooldown';
                m.phaseLeftMs = ARM_RULES.cooldownMs;
            } else {
                m.phase = 'listening';
            }
        } else if (m.phase === 'moving') {
            const gap = m.target - m.pos, reach = (ARM_RULES.slewDps * dt) / 1000;
            if (Math.abs(gap) > reach) {
                m.pos += Math.sign(gap) * reach;
                return;
            }
            dt -= (Math.abs(gap) / ARM_RULES.slewDps) * 1000;
            m.pos = m.target;
            m.phase = 'settling';
            m.phaseLeftMs = ARM_RULES.settleMs;
        } else {
            m.cm = readCm(cm);
            m.target = servoTarget(m.cm);
            if (Math.abs(m.target - m.pos) <= ARM_RULES.deadbandDeg) return;
            m.phase = 'moving';
        }
    }
}

// Each simulated arm gets a visitor now and then: in for a few seconds, then gone.
const VISITS = [
    { periodMs: 31_000, phase: 0.1, nearestCm: 35 },
    { periodMs: 43_000, phase: 0.55, nearestCm: 20 },
    { periodMs: 37_000, phase: 0.8, nearestCm: 55 },
];
const VISIT_START = 0.35, VISIT_SHARE = 0.3; // the visit fills 30 % of each cycle

/** A stand-in visitor's distance for arm 0, 1 or 2: 100 (nobody) most of the time. */
export function visitorCm(arm: number, nowMs: number): number {
    const v = VISITS[((arm % VISITS.length) + VISITS.length) % VISITS.length];
    const t = (((nowMs / v.periodMs + v.phase) % 1) + 1) % 1;
    if (t < VISIT_START || t > VISIT_START + VISIT_SHARE) return ARM_RULES.rangeCm;
    const depth = Math.sin((Math.PI * (t - VISIT_START)) / VISIT_SHARE) ** 0.6; // steps in, lingers, leaves
    const sway = 3 * Math.sin(nowMs / 700 + arm * 2.1); // a person never stands quite still
    return Math.min(ARM_RULES.rangeCm, Math.max(0, ARM_RULES.rangeCm - (ARM_RULES.rangeCm - v.nearestCm) * depth + sway * depth));
}
