# Architecture

Brain organoid MEA visualizer + show driver. React/Vite frontend, Node bridges for OSC and serial.

## Processes

| Process | Entry | Role |
|---|---|---|
| Frontend | `src/main.tsx` → `src/App.tsx` (Vite, :5173) | CSV loading, visualizations, transport, OSC/serial panels, show panel |
| OSC bridge | `server/osc-bridge.js` (HTTP + WS 127.0.0.1:8080, OSC in :3333) | WebSocket ⇄ UDP OSC; owns the show clock; serves `data/`; drives the LEDs during the show |
| Serial bridge | `server/serial-bridge.js` (WS 127.0.0.1:8081) | firing events → microcontroller byte stream (`F:x,y` / `C:x,y`) |

`npm start` runs all three. Both bridges accept WebSocket connections only from loopback and from local pages (`server/local-origin.js` checks the Origin header). Electron (`electron/`) is a packaging shell and does not run the bridges.

## Data

The spike CSV is a binary matrix: one row per millisecond, 131 neuron columns, `1` = spike (`src/utils/dataProcessing.ts`). The file holds three 131-column blocks, spikes (`t_spk_mat_*`), rates (`rate_mat_*`) and normalized rates (`rates_norm_*`); the parsers read only the spikes. EoC's firing blob (`organoid_firing.f16`) is the normalized-rate block, which the routing view loads separately. Spikes are kept sorted by `timestamp_ms` in `App`'s `allSpikesRef`. Playback time is data milliseconds; `/index` = that millisecond = the EoC firing-blob frame (131 neurons × 180000 frames).

## Local playback

`App.tsx` advances `playbackTimeRef` in a `requestAnimationFrame` loop (target-duration speed, burst slow-motion), throttles React state to ~10 Hz, sends `OSC_BUNDLE` (`/index`, `/x1../y1`) per frame to the bridge, and hands the frame's spikes to `emitFrameOutputs` (recent-neuron trail, click/bass sound, `SERIAL_SYNC` to the serial bridge). Views receive `currentTime` and draw from it.

## Presentation view

`App`'s `presentation` state adds a `.presentation` class to the root and requests fullscreen (Keyboard Lock on Esc in Chromium; Esc twice or the bottom icon exits). CSS in `src/index.css` hides the header, controls and footer and lays the views out as a grid: `full-width` cells go first (`order: -1`) and span the row; the rest are `PresentationTile`s (`src/components/PresentationTile.tsx`) at least `--pres-tile` wide (`auto-fill`, dense). A tile's span (1, 2 or full row) is set from its hover control and kept per browser (`src/utils/tileSpans.ts`); `--pres-span` makes `.pres-box` one column tall at any span, and `--pres-fit` caps a view at one screen height. Activity Analysis renders its charts as their own tiles in presentation, inside a `display: contents` wrapper so its chart toggles survive the switch. Each view also takes a `presentation` prop to drop its own buttons/settings and size its canvas to the box.

## Show mode

```
ShowPanel ──SHOW_START{config} / SHOW_STOP──▶ osc-bridge.js ──UDP──▶ EoC OSCMapping (:1234), audio Mac mini, …
    ▲                                              │  └──SERIAL_SYNC (WS)──▶ serial-bridge.js ──USB──▶ LED matrices
    └──── SHOW_STATE (every tick, 60 Hz) ──────────┘
                  data/neurons.csv, data/spikes.csv ──▶ osc-bridge.js (LEDs) and, over HTTP, the page
```

- `server/show-schedule.js` — pure: config defaults/repair/caps, pass/cycle timing, cue frames, `stateAt(elapsed)`, `step(prev, elapsed)` → OSC messages. Index derives from elapsed time; a late tick fills the frames it skipped (≤ 30, longer gaps jump); cues fire on crossing.
- `server/show-runner.js` — ticks `step()` on absolute deadlines (`t0 + n/fps`), publishes state; injectable clock for tests.
- `server/show-data.js` — loads `data/` for the bridge: neuron positions (`src/utils/neuronRows.ts`, shared with the page's uploader) and the spike matrix streamed into neuron ids per ms (first 131 columns, as the page reads it).
- `src/show/ledFrame.ts` — the LED frame (recent-5 trail, burst when > 5 neurons fire at once, 0–15 grid cells, ≤ 30 ms of data per tick). Imported by the page and by the bridge (Node strips the TypeScript types natively), so both light the LEDs the same way. During the show the bridge sends it to the serial bridge when it has `data/` (`SHOW_STATE.leds`); the page then sends none.
- `osc-bridge.js` — wires the runner to every OSC destination; drops `OSC_BUNDLE`/`OSC_SEND` while the show runs; broadcasts `SHOW_STATE` every tick and to each new tab; ignores a reconnecting tab's initial `CONFIG` mid-show and replies `OSC_CONFIG`.
- `src/components/ShowPanel.tsx` — HUD, firing overview + cue ticks, cycle bar, ±1 s raster; draws from a ref in its own rAF loop, extrapolating the index between messages (`src/show/showMath.ts`). The routing view sits below it (next section).
- `App.tsx` — mirrors `SHOW_STATE` into the playhead for the other views and feeds the spikes since the last message to `emitFrameOutputs` (sound, recent-neuron trail, and LED serial unless the bridge drives it); loads `data/` from the bridge on connect; locks local transport and gestures; persists OSC settings (`src/utils/oscSettings.ts`).

Cycle: `/sim_resetSimsOnly`, `/sim_on 5` → `/index` 0→179999 at 60/s (+5 termite, 10 physarum resets) → `/sim_off 5` → 120 s silence. EoC side: `SimulationManager.SetOutputOn` (master composite level, `pauseWhenDark`), on its `show-sim-off` branch.

## Routing view

A depiction of where the signal goes, inside the SHOW panel; it only reads, and never sends OSC, serial or sound.

```
SHOW_STATE / playbackTimeRef ─┐
emitFrameOutputs → ledFramesRef ─────┤
OSC_MSG /routing/* → applyTelemetry ─┼─▶ RoutingView (30 fps rAF) ─ advanceLive ─▶ drawOverview | drawDetail
data/organoid_firing.f16, vessel.gcode, ─┤          (src/show/routing/live.ts)   (src/components/routing/)
  activitylevel.wav + burstflags.wav,  ─┤
  termite_slices.bin                   ─┘
```

**Rules** live in `src/show/routing/`. They're pure, Node-tested modules with explicit `.ts` imports:
- `facts.ts`: every number and label shown, from the running system: the 11.3 scene, the G-code, the bridge.
- `layout.ts`: boxes from the area's size, landscape at w/h ≥ 1.1, else portrait; type scale. It also leaves a channel around the organoid (0.28 of its radius) and computes the overview's cables there, once per size.
- `cables.ts`: the overview's cables as cubic Béziers. Each leaves the rim radially, spread round toward the open space beside the cards, and meets the middle of the card edge that faces the organoid, square to it. It also draws Max's short lead to the solenoids, which bows out on that side.
- `firingBlob.ts`: EoC's `TFR1` half-float blob of normalized rates, one row per index.
- `soundFeatures.ts`: population rate, burst ends, the VISAP mappings (the SOUND fallback without the patch's data).
- `wav.ts`: the patch's data buffers (16-bit PCM mono, one sample per index).
- `maxPatch.ts`: the sound patch's own rules, from `dev/audio/*.maxpat`.
  - **Tables:** tone, grain and kick intervals; grain length and odds; kick echoes; the 17-step chord counter with its notes; arm 1's arpeggio interval.
  - **`PatchData`:** the activity and flags, with hold-aware intervals: a table miss keeps the last value, as Max does.
- `soundEvents.ts`: the voices played forward in wall-clock time, at the patch's rates and odds, with a seeded generator. Covers tones, grains, kicks through Max's three echo `delay`s and its half-closed output gate, 6 drones and the arpeggio, into a 4096-event ring.
- `soundLayout.ts`: the SOUND detail's panels; the activity envelope per pixel column.
- `slicer.ts` · `termiteSlices.ts`: mesh → horizontal contours (chained, RDP-simplified) → `TSL1`, per print segment. `scripts/termite-slices.mjs` runs them on the OBJ.
- `sliceView.ts`: both artifacts as layer stacks (vessel layers, termite slices with exploded segments), slice stride and depth alpha, the FAB panels, and the pair layout that stands them side by side at one scale.
- `vessel.ts`: G-code → layers centred on the axis; layer ≈ linear in the index; printed cut-off.
- `tour.ts`: 20 s stops, 60 s idle resume.
- `telemetry.ts`: the `/routing/*` contract and freshness.
- `swarm.ts`: stand-in agents seeded on the neuron positions.
- `arms.ts`: the arms' firmware rule: Arduino `map` to a servo target, 10° deadband, 200°/s slew, 100 ms settle, 2 s cooldown; and the stand-in visitors.
- `playhead.ts`: which clock to follow: the show's while it runs and the bridge is connected, else local playback.
- `captions.ts`: state-dependent copy (the playhead line, where the firing comes from, the attribution under every detail source).
- `live.ts`: per-frame state from the playhead.
  - **Spikes:** a forward step up to 250 ms keeps all its spikes; a bigger or backwards jump keeps 30 ms; a step back of up to 30 ms (the show playhead re-anchoring, or falling back to the last index sent) replays nothing. A show pass slices nothing before its first index.
  - **Held playhead:** after 150 ms still, the playhead counts as stopped. The firing fades like EoC's 0.5 s and the `/index` dashes stop.
  - **Also held:** glows, strikes, the rate and burst state (fresh telemetry wins), the LED pixels as `DualLED_Currents.ino` draws `F:`/`C:`, the serial lines, and the arms.
  - **Sound view:** the patch at the last index Max heard; its values hold through pauses and OFF.
    - **Chord step:** LIVE `harmony` when fresh; else in the show, flags counted from pass 1 over the show's range; else unknown (local playback skips most indices).
    - **Arpeggio:** from arm 1's distance, LIVE or simulated.
    - **Events:** the event sim steps only while `/index` flows; with the recording stopped nothing triggers and nothing is drawn as sounding (the room's behaviour). Drones whose cycle ended meanwhile pick up out of phase; echoes that came due meanwhile are dropped.
    - **OFF:** in the show a null index is OFF, and the bridge sends `endIndex` last, so that's what Max holds (also for the vessel layer).
  - **Arms:** each runs `arms.ts` on its distance: the arm's own via `/routing/robot/<id>/proximity`, else a stand-in visitor. LIVE servo and touch override; touch fades the fibres in over 1 s; the drawn spine curls with the angle and lags toward the tip.

**View:** `src/components/RoutingView.tsx` owns the canvas, the loop, the tour and the operator settings (`src/utils/routingSettings.ts`). The loop is paused when hidden or off-screen.

Drawing lives in `src/components/routing/`:

- `glyphs.ts`, `overview.ts`, `details.ts`. Text wraps at spaces and hard-breaks a word wider than its box. `fit` shortens a title with an ellipsis. `linesKeepLast` keeps a card's LIVE / SIMULATED / ≈ badge in view when its rows overflow, and a card's text area is sized from its wrapped rows;
- `soundGlyphs.ts`: the activity strip, chord strip, score, rule charts, harmony and speakers;
- `armGlyphs.ts`: the arms as built (pod, spine through its vertebrae, leaves, tendon, touch-lit fibres, the tip's sensor cone with the visitor) and the distance → angle rule chart.
- `artifactGlyphs.ts`: slice stacks on a turntable, the print-preview plan view, and the schematic. The stacks render into offscreen canvases at most every 100 ms (`ArtifactCache`, owned by RoutingView).

**Inputs** come through ShowPanel:
- the show snapshot, or `playbackTimeRef` when no show runs;
- `ledFramesRef`: every frame `emitFrameOutputs` computes, sent or not, queued (at most 64) and drained each draw; a frame older than 100 ms is a backlog and isn't drawn. During the show the bridge runs the same `ledStep` on the same slices;
- `routingTelemetryRef`: `OSC_MSG` for `/routing/*`, applied before `setLastOscMessage` so telemetry never re-renders App;
- the firing blob, the vessel, the patch's two WAVs (as `PatchData`) and the termite slices, fetched once from the bridge's `data/` (`server/data-files.js`) when `/data/status` lists them;
- the playhead's `pass`, `range`, `fps` and the bridge's show config: the show's, or pass 1 over the whole recording.
- telemetry strikes older than 100 ms are a backlog (a new state, a hidden tab), and Max's report of a strike just computed here is that strike.

**Sizing:** outside presentation the canvas is width × 9/16, at least 420 px. In presentation the raster stays at 160 px and the routing canvas takes `innerHeight` minus its top and the padding below it, at least 360 px, refitted when the panel above it resizes.

## Tests

`npm test` — `node --test` over `server/**/*.test.js` and `src/**/*.test.ts` (Node's native type stripping; test files are excluded from `tsc`). `scripts/show-smoke.mjs` — end-to-end through a spawned bridge.
