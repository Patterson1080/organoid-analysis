// Everything the routing view draws that changes from frame to frame, advanced from the
// playhead: which neurons just spiked, what EoC's firing blob says, the solenoid strikes, the
// population rate the patch listens to, the LED frame that went down the serial line, and the
// robot arms. Pure apart from the clock the caller passes, so it runs under node --test.

import type { Neuron, SpikeEvent } from '../../types';
import { neuronBounds, showOutputAfter } from '../ledFrame.ts';
import type { LedFrame } from '../ledFrame.ts';
import { spikesBetween } from '../showMath.ts';
import { BACKBONE_COUNT, LED_FACTS, ROBOT_FACTS, VISUAL_FACTS } from './facts.ts';
import { firingRow } from './firingBlob.ts';
import type { FiringBlob } from './firingBlob.ts';
import { BURST_FRACTION, peakRate, populationRate, stepBurst } from './soundFeatures.ts';
import type { BurstState } from './soundFeatures.ts';
import { fresh } from './telemetry.ts';
import type { Telemetry } from './telemetry.ts';

export interface LiveNeuron {
    x: number; // 0..1 within the neuron bounds
    y: number;
    backbone: boolean;
    id: number;
}

export interface LiveInput {
    index: number | null; // the playhead, null while nothing plays (OFF)
    spikes: SpikeEvent[]; // sorted by timestamp_ms
    blob: FiringBlob | null;
    ledFrame: LedFrame | null; // the last frame emitFrameOutputs computed
    telemetry: Telemetry | null;
    dtMs: number;
    now: number;
}

export interface Arm {
    th: number[]; // segment angles from vertical, top to bottom
    proximity: number; // metres
    servo: number; // degrees
    live: boolean; // servo from telemetry rather than simulated
}

export interface LiveState {
    neurons: LiveNeuron[];
    idToIdx: Map<number, number>;
    slotOf: Int16Array; // neuron index → solenoid slot, or −1
    backboneSlots: number[]; // slot → neuron index
    lastIndex: number | null;
    fired: number[]; // neuron indices that spiked in the last advance
    spikeGlow: Float32Array;
    firing: Float32Array;
    firingSource: 'blob' | 'spikes';
    strikeGlow: Float32Array;
    strikeLog: { slot: number; neuronId: number; t: number }[]; // newest last
    strikes: number;
    strikeSource: 'computed' | 'live';
    telemetryStrikeAt: number; // newest telemetry strike already shown
    rate: number;
    peak: number;
    burst: BurstState;
    rateHistory: Float32Array;
    rateHead: number;
    rateClock: number;
    rateSource: 'computed' | 'live';
    ledCells: Float32Array; // 16 × 16, row-major
    ledCyan: Uint8Array;
    ledLines: string[]; // the serial lines of the last frame
    lastLedFrame: LedFrame | null;
    ledFrames: number;
    ledAgeMs: number;
    arms: Arm[];
}

const SPIKE_TAU_MS = 350;
const STRIKE_TAU_MS = 180;
const LED_TAU_MS = 260;
const MAX_DT_MS = 100; // a long gap (hidden tab) decays like one slow frame
const HISTORY = 160;
const HISTORY_STEP_MS = 40;
const STRIKE_LOG = 8;

export function createLiveState(neurons: Neuron[], spikes: SpikeEvent[]): LiveState {
    const b = neuronBounds(neurons) ?? { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const live: LiveNeuron[] = neurons.map(n => ({
        x: (n.x - b.minX) / (b.maxX - b.minX || 1),
        y: (n.y - b.minY) / (b.maxY - b.minY || 1),
        backbone: n.is_backbone,
        id: n.neuron_id,
    }));
    const idToIdx = new Map<number, number>();
    live.forEach((n, i) => { if (!idToIdx.has(n.id)) idToIdx.set(n.id, i); });
    const slotOf = new Int16Array(live.length).fill(-1);
    const backboneSlots: number[] = [];
    live.forEach((n, i) => {
        if (!n.backbone || backboneSlots.length >= BACKBONE_COUNT) return;
        slotOf[i] = backboneSlots.length;
        backboneSlots.push(i);
    });
    return {
        neurons: live, idToIdx, slotOf, backboneSlots,
        lastIndex: null, fired: [],
        spikeGlow: new Float32Array(live.length), firing: new Float32Array(live.length), firingSource: 'spikes',
        strikeGlow: new Float32Array(BACKBONE_COUNT), strikeLog: [], strikes: 0, strikeSource: 'computed', telemetryStrikeAt: -Infinity,
        rate: 0, peak: peakRate(spikes), burst: { inBurst: false, ends: 0 },
        rateHistory: new Float32Array(HISTORY), rateHead: 0, rateClock: 0, rateSource: 'computed',
        ledCells: new Float32Array(256), ledCyan: new Uint8Array(256), ledLines: [], lastLedFrame: null, ledFrames: 0, ledAgeMs: 0,
        arms: Array.from({ length: ROBOT_FACTS.arms }, () => ({ th: [0, 0, 0], proximity: 0, servo: 90, live: false })),
    };
}

function decay(values: Float32Array, dt: number, tau: number) {
    const k = Math.exp(-dt / tau);
    for (let i = 0; i < values.length; i++) values[i] *= k;
}

function logStrike(s: LiveState, slot: number, t: number) {
    s.strikes++;
    s.strikeLog.push({ slot, neuronId: s.neurons[s.backboneSlots[slot]]?.id ?? -1, t });
    if (s.strikeLog.length > STRIKE_LOG) s.strikeLog.splice(0, s.strikeLog.length - STRIKE_LOG);
}

export function advanceLive(s: LiveState, input: LiveInput): void {
    const { index, telemetry, now } = input;
    const dt = Math.min(input.dtMs, MAX_DT_MS);
    decay(s.spikeGlow, dt, SPIKE_TAU_MS);
    decay(s.strikeGlow, dt, STRIKE_TAU_MS);
    decay(s.ledCells, dt, LED_TAU_MS);

    // Strikes come from the patch when it reports them, else from backbone spikes.
    const liveStrikes = !!telemetry && telemetry.strikes.some(st => fresh(st, now));
    s.strikeSource = liveStrikes ? 'live' : 'computed';

    // The spikes since the last frame, never more than 30 ms back (a jump or a reconnect).
    s.fired = [];
    const slice = index === null ? [] : spikesBetween(input.spikes, showOutputAfter(s.lastIndex, index, 0), index);
    s.lastIndex = index;
    for (const spike of slice) {
        const i = s.idToIdx.get(spike.neuron_id);
        if (i === undefined) continue;
        s.spikeGlow[i] = 1;
        s.fired.push(i);
        const slot = s.slotOf[i];
        if (!liveStrikes && slot >= 0) {
            s.strikeGlow[slot] = 1;
            logStrike(s, slot, spike.timestamp_ms);
        }
    }
    if (telemetry && telemetry.strikes.length > 0) {
        if (liveStrikes) {
            for (const st of telemetry.strikes) {
                if (st.at <= s.telemetryStrikeAt) continue;
                s.strikeGlow[st.slot] = Math.min(1, st.velocity);
                logStrike(s, st.slot, index ?? 0);
            }
        }
        s.telemetryStrikeAt = Math.max(s.telemetryStrikeAt, telemetry.strikes[telemetry.strikes.length - 1].at);
    }

    // What EoC sees: its blob when it matches the loaded neurons, else the spikes stand in.
    const blob = input.blob;
    if (blob && blob.neurons === s.neurons.length) {
        s.firingSource = 'blob';
        if (index !== null) firingRow(blob, index, s.firing);
        else for (let i = 0; i < s.firing.length; i++) s.firing[i] = Math.max(0, s.firing[i] - dt / (VISUAL_FACTS.fadeS * 1000)); // EoC's fade when /index stops
    } else {
        s.firingSource = 'spikes';
        s.firing.set(s.spikeGlow);
    }

    // The population rate the patch listens to.
    const liveRate = telemetry?.sound.rate;
    if (liveRate && fresh(liveRate, now)) {
        s.rate = liveRate.value;
        s.rateSource = 'live';
    } else {
        s.rate = index === null ? 0 : populationRate(input.spikes, index);
        s.rateSource = 'computed';
    }
    s.burst = stepBurst(s.burst, s.rate, BURST_FRACTION * s.peak);
    s.rateClock += dt;
    while (s.rateClock >= HISTORY_STEP_MS) {
        s.rateClock -= HISTORY_STEP_MS;
        s.rateHistory[s.rateHead] = s.rate;
        s.rateHead = (s.rateHead + 1) % HISTORY;
    }

    s.ledAgeMs += dt;
    if (input.ledFrame && input.ledFrame !== s.lastLedFrame) applyLedFrame(s, input.ledFrame);

    stepArms(s, telemetry, now, dt);
}

/** The frame as the matrices get it: at most perFrameCap cells, as F:x,y (trail) or C:x,y (burst). */
function applyLedFrame(s: LiveState, frame: LedFrame) {
    const cells = frame.firings.slice(0, LED_FACTS.perFrameCap).map(f => ({ x: Math.floor(f.x), y: Math.floor(f.y) }));
    const light = (x: number, y: number, v: number, cyan: boolean) => {
        if (x < 0 || x > 15 || y < 0 || y > 15) return;
        const i = y * 16 + x;
        if (v < s.ledCells[i]) return;
        s.ledCells[i] = v;
        s.ledCyan[i] = cyan ? 1 : 0;
    };
    for (const { x, y } of cells) {
        if (frame.isBurst) for (let j = 0; j < 16; j++) { light(x, j, 0.3, false); light(j, y, 0.3, false); }
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) light(x + dx, y + dy, 0.55, false);
    }
    for (const { x, y } of cells) light(x, y, 1, true); // centres last, so a neighbour never covers one
    s.ledLines = cells.map(({ x, y }) => `${frame.isBurst ? 'C' : 'F'}:${x},${y}`);
    s.lastLedFrame = frame;
    s.ledFrames++;
    s.ledAgeMs = 0;
}

/** Servo from telemetry, or a slow simulated visitor; the hanging segments trail it (gravity). */
function stepArms(s: LiveState, telemetry: Telemetry | null, now: number, dt: number) {
    const ease = (rate: number) => 1 - Math.exp(-(dt / 1000) * rate);
    s.arms.forEach((arm, k) => {
        const t = telemetry?.robot[k];
        const servo = t?.servo && fresh(t.servo, now) ? t.servo.value : null;
        const proximity = t?.proximity && fresh(t.proximity, now) ? t.proximity.value / 100 : null; // cm → m
        const p = 0.5 + 0.5 * Math.sin((now / 1000) * 0.45 + k * 2.1);
        arm.live = servo !== null;
        arm.servo = servo ?? (1 - p) * 180;
        arm.proximity = proximity ?? 0.3 + p * 2.7;
        arm.th[0] += (((arm.servo - 90) / 90) * (Math.PI / 5) - arm.th[0]) * ease(5);
        arm.th[1] += (0.8 * arm.th[0] - arm.th[1]) * ease(2.5);
        arm.th[2] += (0.8 * arm.th[1] - arm.th[2]) * ease(1.2);
    });
}
