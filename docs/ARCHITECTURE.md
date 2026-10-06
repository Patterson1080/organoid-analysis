# Architecture

Brain organoid MEA visualizer + show driver. React/Vite frontend, Node bridges for OSC and serial.

## Processes

| Process | Entry | Role |
|---|---|---|
| Frontend | `src/main.tsx` → `src/App.tsx` (Vite, :5173) | CSV loading, visualizations, transport, OSC/serial panels, show panel |
| OSC bridge | `server/osc-bridge.js` (WS 127.0.0.1:8080, OSC in :3333) | WebSocket ⇄ UDP OSC; owns the show clock |
| Serial bridge | `server/serial-bridge.js` (WS 127.0.0.1:8081) | firing events → microcontroller byte stream (`F:x,y` / `C:x,y`) |

`npm start` runs all three. Both bridges accept WebSocket connections only from loopback and from local pages (`server/local-origin.js` checks the Origin header). Electron (`electron/`) is a packaging shell and does not run the bridges.

## Data

The spike CSV is a binary matrix: one row per millisecond, 131 neuron columns, `1` = spike (`src/utils/dataProcessing.ts`). Spikes are kept sorted by `timestamp_ms` in `App`'s `allSpikesRef`. Playback time is data milliseconds; `/index` = that millisecond = the EoC firing-blob frame (131 neurons × 180000 frames).

## Local playback

`App.tsx` advances `playbackTimeRef` in a `requestAnimationFrame` loop (target-duration speed, burst slow-motion), throttles React state to ~10 Hz, sends `OSC_BUNDLE` (`/index`, `/x1../y1`) per frame to the bridge, and hands the frame's spikes to `emitFrameOutputs` (recent-neuron trail, click/bass sound, `SERIAL_SYNC` to the serial bridge). Views receive `currentTime` and draw from it.

## Show mode

```
ShowPanel ──SHOW_START{config} / SHOW_STOP──▶ osc-bridge.js ──UDP──▶ EoC OSCMapping (:1234), audio Mac mini, …
    ▲                                              │
    └──── SHOW_STATE (every tick, 60 Hz) ──────────┘
```

- `server/show-schedule.js` — pure: config defaults/repair/caps, pass/cycle timing, cue frames, `stateAt(elapsed)`, `step(prev, elapsed)` → OSC messages. Index derives from elapsed time; a late tick fills the frames it skipped (≤ 30, longer gaps jump); cues fire on crossing.
- `server/show-runner.js` — ticks `step()` on absolute deadlines (`t0 + n/fps`), publishes state; injectable clock for tests.
- `osc-bridge.js` — wires the runner to every OSC destination; drops `OSC_BUNDLE`/`OSC_SEND` while the show runs; broadcasts `SHOW_STATE` every tick and to each new tab; ignores a reconnecting tab's initial `CONFIG` mid-show and replies `OSC_CONFIG`.
- `src/components/ShowPanel.tsx` — HUD, firing overview + cue ticks, cycle bar, ±1 s raster; draws from a ref in its own rAF loop, extrapolating the index between messages (`src/show/showMath.ts`).
- `App.tsx` — mirrors `SHOW_STATE` into the playhead for the other views and feeds the spikes since the last message to `emitFrameOutputs` (LED serial, sound, recent-neuron trail); locks local transport and gestures; persists OSC settings (`src/utils/oscSettings.ts`).

Cycle: `/sim_resetSimsOnly`, `/sim_on 5` → `/index` 0→179999 at 60/s (+5 termite, 10 physarum resets) → `/sim_off 5` → 120 s silence. EoC side: `SimulationManager.SetOutputOn` (master composite level, `pauseWhenDark`), on its `show-sim-off` branch.

## Tests

`npm test` — `node --test` over `server/**/*.test.js` and `src/**/*.test.ts` (Node's native type stripping; test files are excluded from `tsc`). `scripts/show-smoke.mjs` — end-to-end through a spawned bridge.
