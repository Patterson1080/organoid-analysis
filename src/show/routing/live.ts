// Everything the routing view draws that changes from frame to frame, advanced from the
// playhead: which neurons just spiked, what EoC's firing blob says, the solenoid strikes, what
// the sound patch reads and plays, the LED frame that went down the serial line, and the robot
// arms. Pure apart from the clock the caller passes, so it runs under node --test.

import type { Neuron, SpikeEvent } from '../../types';
import { neuronBounds } from '../ledFrame.ts';
import { ARM_RULES, createArmMotion, stepArmMotion, visitorCm } from './arms.ts';
import type { ArmMotion } from './arms.ts';
import type { LedFrame } from '../ledFrame.ts';
import { spikesBetween } from '../showMath.ts';
import { BACKBONE_COUNT, LED_FACTS, ROBOT_FACTS, VISUAL_FACTS } from './facts.ts';
import { firingRow } from './firingBlob.ts';
import type { FiringBlob } from './firingBlob.ts';
import {
    PATCH, activityAt, arpIntervalMs, audibleKicks, chordOf, chordStep, flagsIn, grainChance, grainLenBins, grainTickMs, kickMs, nextFlag,
    showChordFlags, toneMs,
} from './maxPatch.ts';
import type { PatchData } from './maxPatch.ts';
import { createSoundSim, stepSoundSim } from './soundEvents.ts';
import type { SoundSim } from './soundEvents.ts';
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
    patch: PatchData | null; // the sound patch's data buffers, when linked into data/
    mode: 'show' | 'local';
    pass: number;
    range: { start: number; end: number }; // the indices a pass covers
}

/** What the sound patch reads at the last index it heard, and what it plays with it. */
export interface SoundView {
    source: 'patch' | 'fallback'; // fallback: no patch data for this index
    heardIndex: number | null; // Max keeps the last /index it got (paused, OFF)
    v: number;
    a: number;
    toneMs: number | null;
    kickMs: number | null;
    held: { tone: boolean; kick: boolean }; // no table entry here: Max is on an earlier value
    grainTickMs: number | null;
    grainLen: [number, number] | null;
    grainChance: number; // per tick, at the LFO's midpoint
    threshold: number; // 10 + 80√a
    passFlags: number;
    flagsSoFar: number;
    nextFlag: number | null;
    chordStep: number | null;
    chordSource: 'computed' | 'live' | 'unknown';
    arm1: { cm: number; live: boolean }; // arm 1 paces the arpeggio; simulated when it doesn't report here
    arpMs: number | null;
    rates: { tones: Rate; grains: Rate; kick: Rate }; // what the view prints: Max's own when it reports them
    sim: SoundSim;
}

export interface Rate {
    perSec: number;
    live: boolean;
}

export interface Arm {
    th: number[]; // the drawing's spine angles from vertical, top to bottom, lagging like a hanging arm
    motion: ArmMotion; // the firmware's rules, run here on the distance it reads
    cm: number; // the distance the arm last read: 0–100, 100 = nobody there
    servo: number; // angle now: telemetry's when fresh, else the motion's
    touch: boolean;
    light: number; // fibre light 0..1; a touch fades it in
    live: { proximity: boolean; servo: boolean; touch: boolean }; // which values came from the arm itself
}

/** DualLED_Currents.ino's palette numbers; 0 is the white baseline. */
export const LED_COLOR = { cyan: 1, red: 3, purple: 4, blue: 5 } as const;

export interface LiveState {
    neurons: LiveNeuron[];
    idToIdx: Map<number, number>;
    slotOf: Int16Array; // neuron index → solenoid slot, or −1
    backboneSlots: number[]; // slot → neuron index
    lastIndex: number | null;
    movedAt: number; // when the playhead last changed
    moving: boolean; // the index is advancing: something is being sent
    fired: number[]; // neuron indices that spiked in the last advance
    spikeGlow: Float32Array;
    firing: Float32Array;
    firingSource: 'blob' | 'spikes' | 'mismatch'; // mismatch: a blob for another dataset
    strikeGlow: Float32Array;
    strikeLog: { slot: number; neuronId: number; t: number }[]; // newest last
    strikes: number;
    strikeSource: 'computed' | 'live';
    telemetryStrikeSeq: number; // newest telemetry strike already shown
    rate: number;
    peak: number;
    burst: BurstState;
    rateHistory: Float32Array;
    rateHead: number;
    rateClock: number;
    rateSource: 'computed' | 'live';
    soundLive: Partial<Record<'harmony' | 'tones' | 'grains' | 'kick', number>>; // fresh telemetry only
    ledCells: Float32Array; // 16 × 16, row-major: remaining life of each pixel's color
    ledColor: Uint8Array; // LED_COLOR per pixel
    ledLines: string[]; // the serial lines of the last frame
    lastLedFrame: LedFrame | null;
    ledFrames: number;
    ledAgeMs: number;
    arms: Arm[];
    sound: SoundView;
}

const SPIKE_TAU_MS = 350;
const STRIKE_TAU_MS = 180;
const LED_TAU_MS = 260;
const MAX_DT_MS = 100; // a long gap (hidden tab) decays like one slow frame
const FRAME_SPAN_MS = 250; // a forward step up to this is one frame: keep all its spikes
const JUMP_SPAN_MS = 30; // after a bigger or backwards jump, only this much (no backlog burst)
const STALE_MS = 150; // a playhead that hasn't moved for this long has stopped
const HISTORY = 160;
const HISTORY_STEP_MS = 40;
const STRIKE_LOG = 8;
const SOUND_LIVE = ['harmony', 'tones', 'grains', 'kick'] as const;
const GRAIN_LFO_MID = 0.5; // the grain gate's ≈125 s LFO has an unknown phase: drawn at its midpoint
const FIBRE_FADE_MS = 1000; // the rebuild's led_fade_ms: touch fades the fibres in and out

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
        lastIndex: null, movedAt: -Infinity, moving: false, fired: [],
        spikeGlow: new Float32Array(live.length), firing: new Float32Array(live.length), firingSource: 'spikes',
        strikeGlow: new Float32Array(BACKBONE_COUNT), strikeLog: [], strikes: 0, strikeSource: 'computed', telemetryStrikeSeq: 0,
        rate: 0, peak: peakRate(spikes), burst: { inBurst: false, ends: 0 },
        rateHistory: new Float32Array(HISTORY), rateHead: 0, rateClock: 0, rateSource: 'computed', soundLive: {},
        ledCells: new Float32Array(256), ledColor: new Uint8Array(256), ledLines: [], lastLedFrame: null, ledFrames: 0, ledAgeMs: 0,
        arms: Array.from({ length: ROBOT_FACTS.arms }, () => ({
            th: [0, 0, 0], motion: createArmMotion(), cm: ARM_RULES.rangeCm, servo: ARM_RULES.rest, touch: false, light: 0,
            live: { proximity: false, servo: false, touch: false },
        })),
        sound: {
            source: 'fallback', heardIndex: null, v: 0, a: 0, toneMs: null, kickMs: null, held: { tone: false, kick: false },
            grainTickMs: null, grainLen: null, grainChance: 0, threshold: 10, passFlags: 0, flagsSoFar: 0, nextFlag: null,
            chordStep: null, chordSource: 'unknown', arm1: { cm: ARM_RULES.rangeCm, live: false }, arpMs: null,
            rates: { tones: { perSec: 0, live: false }, grains: { perSec: 0, live: false }, kick: { perSec: 0, live: false } },
            sim: createSoundSim(1),
        },
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

/** Where this frame's spikes start: the last index for a normal forward step, else just before a jump. */
function sliceAfter(last: number | null, index: number): number {
    return last !== null && index >= last && index - last <= FRAME_SPAN_MS ? last : index - JUMP_SPAN_MS;
}

export function advanceLive(s: LiveState, input: LiveInput): void {
    const { index, telemetry, now } = input;
    const dt = Math.min(input.dtMs, MAX_DT_MS);
    decay(s.spikeGlow, dt, SPIKE_TAU_MS);
    decay(s.strikeGlow, dt, STRIKE_TAU_MS);
    decay(s.ledCells, dt, LED_TAU_MS);

    if (index !== null && index !== s.lastIndex) s.movedAt = now;
    s.moving = index !== null && now - s.movedAt <= STALE_MS;

    // Strikes come from the patch when it reports them, else from backbone spikes.
    const liveStrikes = !!telemetry && telemetry.strikes.some(st => fresh(st, now));
    s.strikeSource = liveStrikes ? 'live' : 'computed';

    s.fired = [];
    const slice = index === null ? [] : spikesBetween(input.spikes, sliceAfter(s.lastIndex, index), index);
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
                if (st.seq <= s.telemetryStrikeSeq) continue;
                s.strikeGlow[st.slot] = Math.min(1, st.velocity);
                logStrike(s, st.slot, index ?? 0);
            }
        }
        s.telemetryStrikeSeq = Math.max(s.telemetryStrikeSeq, telemetry.strikes[telemetry.strikes.length - 1].seq);
    }

    // What EoC sees: its blob row while the playhead moves, fading like EoC once it stops;
    // without a blob for these neurons, the spikes stand in.
    const blob = input.blob;
    if (blob && blob.neurons === s.neurons.length) {
        s.firingSource = 'blob';
        if (index !== null && s.moving) firingRow(blob, index, s.firing);
        else for (let i = 0; i < s.firing.length; i++) s.firing[i] = Math.max(0, s.firing[i] - dt / (VISUAL_FACTS.fadeS * 1000));
    } else {
        s.firingSource = blob ? 'mismatch' : 'spikes';
        s.firing.set(s.spikeGlow);
    }

    // The population rate and burst state the patch works from; its own values when it reports them.
    const sound = telemetry?.sound;
    const liveRate = sound?.rate;
    if (liveRate && fresh(liveRate, now)) {
        s.rate = liveRate.value;
        s.rateSource = 'live';
    } else {
        s.rate = index === null ? 0 : populationRate(input.spikes, index);
        s.rateSource = 'computed';
    }
    const liveBurst = sound?.burst && fresh(sound.burst, now) ? sound.burst.value >= 0.5 : null;
    s.burst = liveBurst === null
        ? stepBurst(s.burst, s.rate, BURST_FRACTION * s.peak)
        : { inBurst: liveBurst, ends: s.burst.inBurst && !liveBurst ? s.burst.ends + 1 : s.burst.ends };
    s.soundLive = {};
    for (const k of SOUND_LIVE) {
        const r = sound?.[k];
        if (r && fresh(r, now)) s.soundLive[k] = r.value;
    }
    s.rateClock += dt;
    while (s.rateClock >= HISTORY_STEP_MS) {
        s.rateClock -= HISTORY_STEP_MS;
        s.rateHistory[s.rateHead] = s.rate;
        s.rateHead = (s.rateHead + 1) % HISTORY;
    }

    s.ledAgeMs += dt;
    if (input.ledFrame && input.ledFrame !== s.lastLedFrame) applyLedFrame(s, input.ledFrame);

    stepArms(s, telemetry, now, dt);
    stepSound(s.sound, s.soundLive, s.arms[0], s.moving, input, dt);
}

/** The patch at the last index Max heard (it holds while /index is still), the chord its counter is
 *  on, arm 1's arpeggio, and its voices played forward while /index flows: without the recording
 *  playing, nothing triggers (the team's word for the room). */
function stepSound(sv: SoundView, soundLive: LiveState['soundLive'], arm1: Arm, moving: boolean, input: LiveInput, dt: number) {
    const { patch, telemetry, now, range } = input;
    if (input.index !== null) sv.heardIndex = input.index;
    const v = patch && sv.heardIndex !== null ? activityAt(patch, sv.heardIndex) : null;
    const i = Math.floor(sv.heardIndex ?? 0);
    if (patch && v !== null) {
        const a = v / PATCH.activityScale, tone = toneMs(a), kick = kickMs(a);
        sv.source = 'patch';
        sv.v = v;
        sv.a = a;
        sv.held = { tone: tone === null, kick: kick === null };
        sv.toneMs = tone ?? (patch.toneHeldMs[i] || null);
        sv.kickMs = kick ?? (patch.kickHeldMs[i] || null);
        sv.grainTickMs = grainTickMs(a) ?? sv.grainTickMs;
        sv.grainLen = grainLenBins(a) ?? sv.grainLen;
        sv.grainChance = grainChance(a, GRAIN_LFO_MID);
        sv.threshold = 10 + 80 * Math.sqrt(a);
        sv.passFlags = flagsIn(patch, range.start, range.end);
        sv.flagsSoFar = flagsIn(patch, range.start, i);
        const next = nextFlag(patch, i);
        sv.nextFlag = next !== null && next <= range.end ? next : null;
    } else {
        sv.source = 'fallback';
        sv.toneMs = sv.kickMs = sv.grainTickMs = null;
        sv.grainLen = null;
        sv.grainChance = 0;
    }

    // The counter's step: Max's own when it reports it; in the show, counted from the flags Max has
    // been sent since pass 1; in local playback unknown (it sends too few indices to hit a flag).
    const harmony = telemetry?.sound.harmony;
    if (harmony && fresh(harmony, now)) {
        sv.chordStep = Math.min(17, Math.max(0, Math.round(harmony.value)));
        sv.chordSource = 'live';
    } else if (patch && v !== null && input.mode === 'show') {
        sv.chordStep = chordStep(showChordFlags(patch, input.pass, range.start, range.end, i));
        sv.chordSource = 'computed';
    } else {
        sv.chordStep = null;
        sv.chordSource = 'unknown';
    }

    // Events a second as the patch's rules give them, unless Max reports its own.
    const rate = (reported: number | undefined, computed: number): Rate =>
        reported !== undefined ? { perSec: reported, live: true } : { perSec: computed, live: false };
    sv.rates = {
        tones: rate(soundLive.tones, sv.toneMs ? 1000 / sv.toneMs : 0),
        grains: rate(soundLive.grains, sv.grainTickMs ? (1000 / sv.grainTickMs) * sv.grainChance : 0),
        kick: rate(soundLive.kick, sv.kickMs ? (1000 / sv.kickMs) * audibleKicks() : 0),
    };

    sv.arm1 = { cm: arm1.cm, live: arm1.live.proximity };
    sv.arpMs = arpIntervalMs(arm1.cm);

    if (!moving) return;
    stepSoundSim(sv.sim, {
        now, dtMs: dt, notes: sv.chordStep === null ? null : chordOf(sv.chordStep).notes,
        toneMs: sv.toneMs, kickMs: sv.kickMs, grainTickMs: sv.grainTickMs, grainChance: sv.grainChance, grainLen: sv.grainLen, arpMs: sv.arpMs,
    });
}

/** The frame as DualLED_Currents.ino draws it: at most perFrameCap commands; F:x,y is a cyan
 *  pixel with a half-life cyan halo, C:x,y a disc of radius 3 (red centre, purple to distance 2,
 *  blue to 3). A pixel keeps its longer life and takes the newest color, as the sketch's setFire. */
function applyLedFrame(s: LiveState, frame: LedFrame) {
    const cells = frame.firings.slice(0, LED_FACTS.perFrameCap).map(f => ({ x: Math.floor(f.x), y: Math.floor(f.y) }));
    const fire = (x: number, y: number, color: number, life: number) => {
        if (x < 0 || x > 15 || y < 0 || y > 15) return;
        const i = y * 16 + x;
        s.ledColor[i] = color;
        if (life > s.ledCells[i]) s.ledCells[i] = life;
    };
    for (const { x, y } of cells) {
        if (frame.isBurst) {
            for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
                const d = Math.hypot(dx, dy);
                if (d <= 3) fire(x + dx, y + dy, d < 1 ? LED_COLOR.red : d <= 2 ? LED_COLOR.purple : LED_COLOR.blue, 1);
            }
        } else {
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) fire(x + dx, y + dy, LED_COLOR.cyan, 0.5);
            fire(x, y, LED_COLOR.cyan, 1);
        }
    }
    s.ledLines = cells.map(({ x, y }) => `${frame.isBurst ? 'C' : 'F'}:${x},${y}`);
    s.lastLedFrame = frame;
    s.ledFrames++;
    s.ledAgeMs = 0;
}

// The tendon curls the spine toward its side as the servo turns: these are the three drawn
// segments' angles from vertical at full pull, the tip curling most. 37.7 mm of tendon at 180°
// (the rebuild's pulley) bends a long spine gently, so even full pull leaves the tip at about 45°.
const CURL = [Math.PI * 0.06, Math.PI * 0.14, Math.PI * 0.25];

/** Each arm runs the firmware's rules on the distance it reads: the arm's own reading when it reports
 *  one, else a stand-in visitor. Fresh telemetry overrides the angle and the touch; the drawn spine
 *  follows the angle with a lag that grows toward the tip, as a hanging arm swings. */
function stepArms(s: LiveState, telemetry: Telemetry | null, now: number, dt: number) {
    const ease = (rate: number) => 1 - Math.exp(-(dt / 1000) * rate);
    s.arms.forEach((arm, k) => {
        const t = telemetry?.robot[k];
        const cm = t?.proximity && fresh(t.proximity, now) ? t.proximity.value : null;
        const servo = t?.servo && fresh(t.servo, now) ? t.servo.value : null;
        const touch = t?.touch && fresh(t.touch, now) ? t.touch.value >= 0.5 : null;
        arm.live = { proximity: cm !== null, servo: servo !== null, touch: touch !== null };
        stepArmMotion(arm.motion, cm ?? visitorCm(k, now), dt);
        arm.cm = cm ?? arm.motion.cm;
        arm.servo = servo ?? arm.motion.pos;
        arm.touch = touch ?? false;
        arm.light = Math.min(1, Math.max(0, arm.light + (arm.touch ? 1 : -1) * (dt / FIBRE_FADE_MS)));
        const pull = Math.min(1, Math.max(0, arm.servo / ARM_RULES.servoMax));
        arm.th[0] += (pull * CURL[0] - arm.th[0]) * ease(5);
        arm.th[1] += (pull * CURL[1] - arm.th[1]) * ease(2.5);
        arm.th[2] += (pull * CURL[2] - arm.th[2]) * ease(1.2);
    });
}
