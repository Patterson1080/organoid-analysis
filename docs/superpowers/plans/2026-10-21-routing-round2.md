# Routing view round 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**

- Build the team's answers into the routing view.
- Rebuild the ROBOT card and detail on the arms' real rules and anatomy (`dev/arms`).
- Add the two metro arguments in the Max patch.
- Then deslop and merge onto `main`.

**Architecture:**

- A pure arm model (`src/show/routing/arms.ts`) feeds `live.ts`.
- The SOUND arpeggio reads arm 1 from it.
- Drawing moves to `src/components/routing/armGlyphs.ts`.
- FAB gains a shared-scale pair layout (`sliceView.ts`).

**Tech Stack:** as before. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-routing-round2-design.md`

## Global Constraints

Everything from `2026-10-20-routing-sound-fab.md` still holds:

- pure modules with `.ts` imports;
- `npm test`;
- 2 pre-existing tsc errors only;
- no connections to the user's app or bridge;
- concise commits with no attribution;
- labels exact, ≈, LIVE or SIMULATED.

The arms folder and `dev/audio` aren't in this repo:

- `dev/arms` is read only.
- In `dev/audio`, only the two metro arguments change, after a backup.

## Review Focus

1. Arm telemetry arriving for one field only, such as proximity without servo. The state machine runs on the LIVE distance; the angle is computed and labelled computed. *Task 3: `live distance drives the computed angle`.*
2. A long frame or a hidden tab. Arms don't teleport: slew applies per step, and dt is clamped. *Task 2: `a long step slews at most dt × speed`.*
3. Distances outside 0–100, or NaN. They are clamped, and NaN reads as nobody (100). *Task 2: `servo target clamps and maps like Arduino`.*
4. OFF, then ON again. Events resume, with no backlog burst. *Task 3: `no events while the playhead is still; they resume without a burst`.*
5. FAB with only one artifact linked. The pair layout gives the single object its own scale and no gaps. *Task 5: `a lone artifact fills the pair box`.*

---

### Task 1: Max patch metros, Max-side docs

- [ ] Back up `dev/audio/SimulacraNaturae_4ch_realtime.maxpat` to `SimulacraNaturae_4ch_realtime.backup-2026-10-21.maxpat` in the same folder.
- [ ] Change the two raw lines:
  - line 5835, `obj-252` in `p kick`: `"text" : "metro"` → `"text" : "metro 9600"`;
  - line 8095, `obj-26` in `p guitarTones`: → `"metro 4800"`.
- [ ] Verify: `node -e` parses the JSON, and the walk prints `metro 9600` (kick), `metro 4800` (tones), `metro 50`, `metro 20`. `diff` against the backup shows exactly 2 changed lines.
- [ ] README: add a "Max side" block:
  - harmony: `[counter 17]` outlet → `[prepend /routing/sound/harmony]` → `[udpsend <show machine IP> 3333]`, with `255.255.255.255` where Max allows broadcast;
  - the modular arms already mirror `/routing/robot/1-3/…` to 3333.

### Task 2: Arm model

**Files:** create `src/show/routing/arms.ts` and `src/show/routing/arms.test.ts`.

**Produces:**

```ts
export const ARM_RULES = { rangeCm: 100, servoMax: 180, deadbandDeg: 10, slewDps: 200, settleMs: 100, cooldownMs: 2000, vertebrae: 8, tendonMmPerDeg: 0.21 } as const;
export function servoTarget(cm: number): number;          // trunc(trunc(clamp(cm or 100 if NaN, 0, 100)) * 180 / 100)
export type ArmPhase = 'listening' | 'moving' | 'settling' | 'cooldown';
export interface ArmMotion { pos: number; target: number; phase: ArmPhase; phaseLeftMs: number; cm: number }
export function createArmMotion(rest?: number): ArmMotion;  // pos = target = 90 (the sketch's reset), listening, cm 100
export function stepArmMotion(m: ArmMotion, cm: number, dtMs: number): void; // cm = this step's reading (ignored in cooldown/moving)
export function visitorCm(arm: number, nowMs: number): number; // deterministic, 0..100, mostly 100
```

**Tests:**

- `servo target clamps and maps like Arduino`:
  - `servoTarget(100) = 180`, `(50) = 90`, `(0) = 0`;
  - `(37.9) = 66`, `(-5) = 0`, `(250) = 180`;
  - `(NaN) = 180`.
- `a small change stays put (deadband)`: from 90°, cm 55 (target 99, 9° away) → phase `listening`, pos 90.
- `a big change slews at 200°/s, settles, then cools down 2 s`:
  - from 90° to target 180 (cm 100): after 450 ms of 50 ms steps, pos = 180 and phase `settling`;
  - +100 ms → `cooldown`, phaseLeftMs ≈ 2000;
  - readings during cooldown are ignored: a cm of 0 during it doesn't move it;
  - after 2000 ms → `listening`.
- `a long step slews at most dt × speed`: one 100 ms step from 90 toward 180 → pos = 110.
- `visitors come and go`:
  - over 600 s in 100 ms steps, all values are within [0, 100];
  - more than 60 % of the time reads 100;
  - every arm has at least one reading under 70;
  - the arms differ from each other.

### Task 3: Live arms, arpeggio, OFF silence, strike caption

**Files:**

- modify `src/show/routing/live.ts` (+ test), `src/show/routing/captions.ts` (+ test), `src/show/routing/facts.ts` (`ROBOT_FACTS`);
- update the drawing call sites that read `arm.proximity` (metres) so it compiles. The full redraw is Task 4.

**Interfaces:**

- `Arm` becomes:
  - `{ th: number[]; motion: ArmMotion; cm: number; servo: number; touch: boolean; light: number; live: { proximity: boolean; servo: boolean; touch: boolean } }`;
  - `cm` and `servo` mirror the motion state, or the LIVE servo.
- `SoundView.arm1` is `{ cm: number; live: boolean }`, read from `s.arms[0]`, and `arpMs = arpIntervalMs(arm1.cm)`. So the arpeggio runs from the simulated arm 1 too (SIMULATED).
- The sim steps only while `s.moving`; otherwise its clocks hold.
- `strikeCaption(source: 'computed' | 'live', mode: 'show' | 'local', strikes: number): [string, string]` in `captions.ts`:
  - LIVE: `LIVE · n strikes from the patch`;
  - show: `the rows Max sends (backboneSpikes.txt) · n strikes`;
  - local: `≈ local playback skips rows · n strikes`.

**Tests:**

- `live distance drives the computed angle`: robot 1 proximity telemetry 50 → `arms[0].cm` 50, `live.proximity` true, `live.servo` false, and the motion target is 90.
- `live servo overrides the angle`: robot 1 servo 30 → `arms[0].servo` 30, `live.servo` true.
- `touch fades the fibre light in`: touch 1 → light rises to about 1 within 1 s, and decays after release.
- `the arpeggio follows arm 1, simulated or live`:
  - with no telemetry, `arpMs` is a number;
  - `sound.arm1.live` is false;
  - with telemetry proximity 50, `arpMs` = 265 and `live` is true.
- `no events while the playhead is still; they resume without a burst`:
  - index 1, then index null for 10 s: no events after the hold began;
  - then index 2 for 1 step of 16 ms: ≤ 2 new events.
- `strike captions say how sure they are`: covers the three branches.

The existing `a held playhead keeps the last activity` test changes: activity still holds, but events stop.

### Task 4: Arm drawing (card, detail, source, rail)

**Files:** create `src/components/routing/armGlyphs.ts`; modify `overview.ts`, `details.ts`, `soundGlyphs.ts` (the arpeggio row says SIMULATED or LIVE), and `glyphs.ts` (remove `hangingArms` and the now-unused `vesselProfile`).

**Content:** as in the spec's "What the view does". Verified in the harness at 1920×1080 and 1080×1920: overview, robot detail and sound detail, with 0 console errors.

### Task 5: FAB at one scale

**Files:** modify `src/show/routing/sliceView.ts` (+ test), `facts.ts`, `artifactGlyphs.ts`, `overview.ts`, `details.ts`.

**Produces:**

- `FAB_FACTS.termite.heightMm = 700`.
- `pairLayout(box: Box, termiteH: number | null, vesselH: number | null, termiteW: number, vesselW: number, gap: number): { termite: Box | null; vessel: Box | null; mmPerPx: number }`. It puts the objects side by side on one ground line at one mm-per-pixel.

**Tests:**

- `one scale for both`: their heights in px are in the ratio of their heights in mm, both sit on one ground line, and both fit inside the box.
- `a lone artifact fills the pair box`.

### Task 6: Docs and checks

- [ ] README:
  - Robot row: the rules, the protocol, SIMULATED/LIVE;
  - FAB row: to scale, ≈ 70 cm;
  - OFF silence, solenoid wording, the Max side.
- [ ] ARCHITECTURE: `arms.ts`, the arm glyphs, the pair layout.
- [ ] Spec amendments if anything changed.
- [ ] `npm test`, `npx tsc --noEmit` (2 errors), harness screenshots.

### Then

- `/deslop-global` over `main..HEAD`.
- Merge onto `main` locally (`--no-ff`), and run the tests on the merged result.
- Ask about pushing.

## Unresolved questions

- Which arm firmware runs in this show? `proximitydata:` from the CURRENTS sketch doesn't reach the Max serial patch's `route sensordata:`.
