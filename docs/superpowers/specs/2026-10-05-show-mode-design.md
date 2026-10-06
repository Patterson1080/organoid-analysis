# Show Mode — design

Date: 2026-10-05 · Branch: `show-mode` (organoid-analysis) + `show-sim-off` (EoC-biomes-compute)

## Goal

Run organoid-analysis as the show's OSC driver for EoC-biomes (11.3 Brave New Work scene), replacing
`EoC-biomes-compute/tools/osc_index_tester.py`'s default loop, plus a 2 min blackout between passes.
The operator presses START SHOW once; the loop runs until STOP.

## Cycle

One cycle = 50 min ON + 2 min OFF = 52 min, looping forever.

| When | OSC out (to every configured destination) |
|---|---|
| Pass start | `/sim_resetSimsOnly 1`, then `/sim_on 5.0` |
| During pass | `/index <i>`, i = 0 → 179999, 60/s; `/sim_resetTermites 1` ×5, `/sim_resetPhysarum 1` ×10, evenly spaced |
| Pass end | `/sim_off 5.0`, then 120 s silence (no `/index`) |
| STOP pressed | `/sim_off 5.0` |

- Order at pass start: respawn while still black, then fade in — the reset pop is never visible.
- Firing in EoC decays to quiet ~0.5 s after the last `/index` (`NeuronFiringSource`), so silence needs no extra message.
- Index = data milliseconds = EoC blob frame (180 s recording, 1 frame/ms, 180000 frames). No scale factor anywhere.

### Config (defaults; editable in the panel, locked while running)

| Field | Default | Notes |
|---|---|---|
| `startIndex` / `endIndex` | 0 / 179999 | inclusive |
| `fps` | 60 | index steps per second |
| `offSeconds` | 120 | blackout length |
| `fadeSeconds` | 5 | sent as the `/sim_on` / `/sim_off` arg |
| `passStartCue` | `/sim_resetSimsOnly` | empty = none |
| `spreadCues` | `/sim_resetTermites` ×5, `/sim_resetPhysarum` ×10 | |
| `onAddress` / `offAddress` | `/sim_on` / `/sim_off` | |
| `/index` address | existing OSC Bridge "Row index" field (`oscOut.timeAddress`) | |

Derived: `passFrames = end − start + 1` (180000) · `passMs = passFrames / fps × 1000` (3 000 000) · `cycleMs = passMs + offSeconds × 1000` (3 120 000).

Spread cue frames (tester formula): for a cue with count N, `round(start + (end − start) × k / (N + 1))`, k = 1..N.

## Architecture

The bridge owns the clock; the browser only starts, stops and watches.

```
ShowPanel ──SHOW_START{config} / SHOW_STOP──▶ osc-bridge.js ──UDP OSC──▶ EoC (OSCMapping :1234)
    ▲                                              │
    └────────── SHOW_STATE (~15 Hz + on change) ───┘
```

Why the bridge, not the browser: `requestAnimationFrame` and timers are throttled in hidden/background tabs, and rAF rate follows the display (120 Hz panels double it). The bridge also survives a tab reload or close.

### `server/show-schedule.js` (pure, no I/O)

- `normalizeConfig(partial) → config` — defaults + validation (end ≥ start, fps > 0, offSeconds ≥ 0).
- `cueFrames(config) → [{ address, frame }]` sorted by frame.
- `stateAt(config, elapsedMs) → { pass, phase: 'on'|'off', index|null, phaseElapsedMs, phaseDurationMs }`
  - `cycle = floor(elapsedMs / cycleMs)`, `pass = cycle + 1`, `t = elapsedMs − cycle × cycleMs`
  - ON when `t < passMs`: `index = min(end, start + floor(t × fps / 1000))`
  - OFF otherwise: `index = null`
- `step(prev, config, elapsedMs) → { next, messages: [{ address, args }] }` — the whole sequencing, testable:
  - new pass (pass number changed, or first tick): pass-start cue, then on-cue; then the ON-phase rule below.
  - ON: if `index ≠ prev.index`, send `/index index`; fire every cue with `prev.index < frame ≤ index` (crossing, not equality — a late tick never drops a reset). First tick of a pass treats `prev.index = start − 1`.
  - ON → OFF: fire any cues still between `prev.index` and `end`, then off-cue.
  - A stall longer than a phase (machine sleep) jumps by wall clock; the transitions above still fire once each.
- Index is computed from elapsed wall time, never incremented, so a pass is exactly 50:00 regardless of timer jitter (the Python tester drifts long when it falls behind).

Arg types: `/index` int; reset cues int `1` (as the tester); `/sim_on` / `/sim_off` float, sent as `{ type: 'f', value: 5 }` (node-osc 11 infers `5` as int32).

### `server/osc-bridge.js`

- WS `SHOW_START { config }` → ignored if running; else `t0 = performance.now()`, start tick loop.
- Tick loop: `setTimeout` to absolute deadlines `t0 + n × 1000 / fps` (not `setInterval`, not sleep-after-send); each tick runs `step()` and sends its messages to every OSC client.
- WS `SHOW_STOP` → stop loop, send off-cue, broadcast stopped state.
- Broadcast `SHOW_STATE` every 4th tick (~15 Hz), on every phase change, and once to each new WS connection:
  `{ running, pass, phase, index, phaseElapsedMs, phaseDurationMs, config, cues, destinations: ['ip:port', …] }`.
- Show `/index` sends go through `oscOut.timeAddress`; the `timeEnabled` checkbox does not gate them (show mode needs `/index`).
- Bridge restart = show stops (no persistence). Operator presses START again.
- Default OSC output port is `1234` (EoC's port), in the bridge and the UI.
- Reload safety: a (re)connecting tab marks its first `CONFIG` as `initial`. While the show runs the bridge ignores that push (a fresh tab may only know defaults) and replies `OSC_CONFIG` with its live settings, which the tab adopts. Edits made by hand mid-show still apply. The UI also saves its OSC Bridge settings in `localStorage`, so a reload restores them.
- While running, the bridge drops `OSC_BUNDLE` / `OSC_SEND` from any tab — one `/index` sender even with a second tab open.

### Frontend

**`src/components/ShowPanel.tsx`** — full-width panel at the top of the viz section, toggle in View Controls (default on). Canvas drawn from refs in its own rAF loop; no per-frame React state.

- HUD (DOM): `PASS 3 · ▶ ON · IDX 091204 / 179999 · OFF IN 24:47 · → 192.168.1.5:1234`. OFF phase: `■ OFF · ON IN 1:23`. Stopped: `STOPPED`. Destination shown so a forgotten `127.0.0.1:3334` is obvious.
- Overview strip (~64 px): spike count per pixel bin over `[startIndex, endIndex]`, precomputed to an offscreen canvas when spikes / range / width change; cue ticks (T, P) underneath; playhead line.
- Cycle bar (~10 px): ON segment (50 min) | OFF segment (2 min), marker at cycle position.
- Raster (~160 px): spikes in `[idx − 1000, idx + 1000]` ms, y = neuron id, fixed centre playhead, dots dimmed by distance from centre. Window found by binary search (spikes are sorted on load).
- Between `SHOW_STATE` messages the index is extrapolated at `fps` from the last message's receive time (clamped to `endIndex`), so the raster scrolls smoothly at display rate.
- START SHOW / STOP SHOW; config inputs (range, fps, off s, fade s, the two spread counts).
- No CSV loaded: HUD + cycle bar only; the show still runs (bridge needs no data).
- Bridge disconnected: START disabled, HUD says `BRIDGE OFFLINE`.

**`src/App.tsx`** while `SHOW_STATE.running`:

- `playbackTimeRef = index` on each state (ON); `setPlaybackTime` throttled to ~10 Hz — existing views (Circular, 3D, Real-Time) follow the show.
- Local transport locked: `isPlaying` forced false; PLAY / step / STOP buttons, circular center-tap and scrub disabled; local `OSC_BUNDLE` sends gated; incoming `/row` ignored. Exactly one `/index` sender.
- `/x1../y1` neuron coords are not sent during the show (bridge has no spike data).
- STOP SHOW takes two clicks within 3 s (it blacks out the room).

## EoC-biomes-compute changes (branch `show-sim-off`, own files only — leave the uncommitted 11.3 scene/params/tools edits alone)

**`OSCMapping.cs`** — `/sim_off [fadeSeconds]`, `/sim_on [fadeSeconds]`; optional arg read only if `data.GetElementCount() > 0`, read inside the callback (handle valid only there), action enqueued to the main thread like the resets.

**`SimulationManager.cs`** — master output level:

- Fields under `[Header("Output Level")]`: `outputFadeSeconds = 5`, `pauseWhenDark = true`.
- `SetOutputOn(bool on, float fadeSeconds = -1)` (<0 → `outputFadeSeconds`; 0 → instant); `[Button]`s Output Off / Output On.
- `_outputLevel` ramps toward target in `LateUpdate` on `Time.unscaledDeltaTime`, before `Render()`.
- `FixedUpdate` skips stepping when `pauseWhenDark && level == 0 && target == 0` (separate flag; authored `stepsPerTick` untouched). Resumes the moment `/sim_on` arrives.
- `CompositeInto` sets `masterLevel` **on every dispatch** (shared compute asset; an unset uniform reads 0 → black output). Value is perceptual: `pow(smoothstep(level), 2.2)` since the composite is linear light.
- Nested `BiomeCellRig` managers keep level 1 (never receive the call).

**`SimulationManager.compute`** — `float masterLevel;` and `color.rgb *= masterLevel;` as the last line before the store in `CompositeRenderKernel`. Both render paths (plain and `frameBlend`) go through it; with stepping paused, the blend path recomposites every frame (`alpha >= 1`), so the black frame lands.

Docs (EoC conventions): session log `docs/sessions/2026-10-05-sim-off-blackout.md`, `docs/INDEX.md`, README OSC bullet, `tools/README.md` address list.

## Testing

- **Unit** (`node --test server/`, new `npm test`): passMs 3 000 000 / cycleMs 3 120 000; cue frames match the tester formula; phase boundaries (last ON ms, first OFF ms, wrap to pass 2); `step()` message order at pass start / pass end; cue crossing with skipped frames; long stall across OFF.
- **Integration** (script, not committed to CI): bridge with `0..599 @ 60, off 3 s, fade 1 s` → local node-osc `Server` logs address + time. Expect `resetSimsOnly, sim_on, /index 0..599 (+5 T / 10 P), sim_off, ~3 s silence, repeat`; ≈ 60 msg/s; pass ≈ 10.0 s.
- **Build**: `npm run build` (tsc).
- **EoC (user, in Unity, 11.3 scene in Play)**: `uv run --with python-osc python -c "from pythonosc.udp_client import SimpleUDPClient as C; c=C('127.0.0.1',1234); c.send_message('/sim_off',5.0)"` → fades to black, sims pause; same with `/sim_on` → fades back. Then a short show run from the panel.

## Docs (this repo)

README: Show Mode section (cycle table, OSC contract, operator steps). New `docs/ARCHITECTURE.md`: bridge/frontend/show-clock overview (required before merging to main).

## Out of scope

Show persistence across bridge restarts; auto-start on launch; `/x` `/y` coords during the show; Electron (`electron/main.cjs` references bridge functions it doesn't define — untouched).

## Amendments (during execution)

- **Frame fill.** A late tick sends every frame it skipped, in order, each followed by its cues (≤ 30 frames; a longer gap such as machine sleep jumps and fires the jumped cues once). Receivers see every index at 60/s on average; the pass stays wall-clock locked.
- **Hardening.** The bridge WebSocket (and the serial bridge's) listens on 127.0.0.1 only; `normalizeConfig` caps fps (1000), indices (1e8), seconds (86400), cue counts (1000) and spread-cue entries (32).
- **Audio Mac mini.** Gets the show by being one more Output IP (`ip:port`); every message goes to every destination.
- **LED matrices + sound.** Driven from the show playhead: the bridge broadcasts `SHOW_STATE` every tick; App feeds the spikes since the previous message to the same per-frame output path local playback uses (serial `SERIAL_SYNC`, clicks/bass, recent-neuron trail), capped at 30 ms of data per message so a reconnect never bursts a backlog.
