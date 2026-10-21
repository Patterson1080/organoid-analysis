# Routing View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live routing view inside the SHOW panel that shows where the show's index goes and how each medium (visual, sound, solenoids, LED, robot, fabrication) maps it, with detail views, an idle auto-tour, and presentation layouts for any aspect.

**Architecture:** Pure, Node-tested modules in `src/show/routing/` hold every rule (layout, firing blob, sound mappings, vessel G-code, tour, telemetry, swarms, per-frame live state). One canvas component, `RoutingView`, reads refs in its own 30 fps rAF loop and draws through small drawing modules in `src/components/routing/`. The bridge only gains two optional `data/` files and stops logging `/routing/*`.

**Tech Stack:** React 18 + TypeScript (Vite), Canvas 2D, Node ≥ 22.18 bridge (`node-osc`, `ws`), `node --test` with native type stripping.

**Spec:** `docs/superpowers/specs/2026-10-20-routing-view-design.md`. Read it first: the copy, the numbers and every **(theirs)** decision come from there.

## Global Constraints

- The routing view only **reads**. No change to the show clock, OSC sends, LED serial, sound or `/row` handling.
- **Modules in `src/show/routing/`** are imported by `node --test`, so they use erasable TypeScript only (no `enum`, `namespace` or parameter properties). Their runtime imports of each other carry explicit `.ts` extensions; `import type` may stay extensionless.
- **Neuron order:** CSV row *k* = `neuron_id` *k*+1 (spikes and `labels_positions.csv` both) = firing-blob column *k*.
- **Numbers rule:** the running system's numbers (11.3 scene, G-code header, bridge). Paper figures only where no file exists, labelled `VISAP 2025` / `SIGGRAPH 2026`.
- **Exact visitor-facing copy:**
  - attribution `pre-recorded · 180 s · Kosik Neurobiology Lab, UCSB`;
  - badges `≈ computed from spikes · the patch is the authority` and `SIMULATED · sensors go to the audio computer`;
  - `drawn here: 1 in ~400 physarum, 1 in ~30 boids, every termite`;
  - fallbacks `spikes · no firing blob` and `no vessel data (data/vessel.gcode)`;
  - placeholders `termite mounds · files to come` and `off in this show`.
- **Visual (11.3 scene):**
  - firing ≥ **0.1**, 0.5 s linear fade, OSC UDP **:1234**, `/index` at **60/s**, **131** neurons × **180 000** frames;
  - physarum **1,000,000 · 8 types**, ×2, deposit 0.7 (types 0–3) / 1.0 (4–7);
  - boids **20,000 · 4 types**, ×1.5, deposit 0.5;
  - termites **131**, ×2, trail → 4.
- **Tour:** stops `overview, visual, sound, solenoids, led, robot, fab`, **20 s** each; any `pointerdown`/`keydown`/`wheel` pauses it; resumes at the overview after **60 s** idle.
- **Telemetry:** `/routing/*` on UDP **:3333** (table in the spec), fresh while < **2000 ms** old.
- **Rendering:** **30 fps** cap; paused when `document.hidden` or off-screen; agents per neuron physarum 18, boids 5, termites 1.
- **Layout:** landscape when w/h ≥ **1.1**; type scale `clamp(min(w, h) / 540, 0.85, 1.8)`, never below **8 px**. Normal view height = width × 9/16, at least **420 px**. Presentation: raster → `RASTER_H` (160 px) while routing shows; routing fills the rest of the viewport, at least **360 px**.
- **Commits:** concise message, no attribution lines (user rule).

## Review Focus

- **Firing blob from another dataset** (neuron count ≠ loaded neurons) → Visual falls back to spikes, never reads out of range. Test in Task 10.
- **Playhead jumps backwards** (new pass, loop, scrub) → glyphs keep reacting from 30 ms before the new index, with no backlog burst and no permanent silence. Test in Task 10.
- **A different or hand-written G-code** (no header, no `;;; ======` marker) → parsed with defaults. An empty file throws, and the card says `no vessel data`. Tests in Task 6.
- **Malformed or foreign OSC on :3333** (strings, NaN, unknown `/routing/…`, slot or arm out of range) → ignored without throwing; `/routing/*` never triggers React state. Tests in Task 8, App guard in Task 11.
- **Extreme areas** (3000 × 500 ultra-wide, 320 × 900 narrow) → cards inside the area, non-overlapping, type ≥ 8 px. Test in Task 3.

---

### Task 1: Backbone flag from `labels_positions.csv`

**Files:**
- Modify: `src/utils/neuronRows.ts` (backbone candidates)
- Test: `src/utils/neuronRows.test.ts`

**Interfaces:**
- Produces: `neuronsFromRows` marks `is_backbone` from a `backbone_labels` column. Later tasks rely on 27 backbone neurons in the show dataset.

- [ ] **Step 1: Extend the failing test.** In the existing `labels_positions rows (backbone_labels, xy_norm_0/1) are numbered by row` test, also assert `assert.deepEqual(ns.map(n => n.is_backbone), [false, true]);`.
- [ ] **Step 2: Run the test and confirm it fails.** `node --test src/utils/neuronRows.test.ts`. Expected: FAIL (`[false, false]`).
- [ ] **Step 3: Add the column.** Add `'backbone_labels'` to the `backboneCol` candidates in `neuronsFromRows`, after `'backbone'`.
- [ ] **Step 4: Check the tests and the real file.** `npm test` → all pass. `awk -F, 'NR>1 && $1+0==1' data/neurons.csv | wc -l` → `27`.
- [ ] **Step 5: Commit.** `git commit -m "Neuron CSV: read backbone flag from backbone_labels"`.

### Task 2: Bridge serves the firing blob and the vessel; quiet `/routing` logs

**Files:**
- Create: `server/data-files.js`, `server/data-files.test.js`
- Modify: `server/osc-bridge.js` (`DATA_FILES`/`DATA_ROUTES`, `serveData`, `loadShowData`, OSC `message` log), `scripts/show-smoke.mjs` (status body), `.gitignore`, `README.md` (Show data section)

**Interfaces:**
- Produces:
  - `DATA_FILES: { key: 'neurons'|'spikes'|'firing'|'vessel'; name: string; type: string }[]`, in that order, with names `neurons.csv`, `spikes.csv`, `organoid_firing.f16`, `vessel.gcode` and types `text/csv`, `text/csv`, `application/octet-stream`, `text/plain`;
  - `dataRoutes(dir: string): Map<string, { path: string; type: string }>`, keyed `/data/<name>`;
  - `dataStatus(dir: string, exists = existsSync): Record<key, boolean>`.
  - `/data/status` returns `{"neurons":…,"spikes":…,"firing":…,"vessel":…}`.

- [ ] **Step 1: Write the failing tests** (`server/data-files.test.js`):
  - `status lists every data file` — in a temp dir holding only `neurons.csv` and `vessel.gcode`: `assert.deepEqual(dataStatus(dir), { neurons: true, spikes: false, firing: false, vessel: true })`;
  - `routes carry their content type` — `dataRoutes(dir).get('/data/organoid_firing.f16')` deep-equals `{ path: join(dir, 'organoid_firing.f16'), type: 'application/octet-stream' }`, and `.get('/data/vessel.gcode').type === 'text/plain'`;
  - `status keys keep their order` — `Object.keys(dataStatus(dir)).join() === 'neurons,spikes,firing,vessel'`.
- [ ] **Step 2: Run and confirm failure.** `node --test server/data-files.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `server/data-files.js`.** Then use it in `osc-bridge.js`:
  - `serveData` looks routes up in `dataRoutes(DATA_DIR)`, sets `Content-Type` from the route, and answers `/data/status` with `dataStatus(DATA_DIR)`;
  - `loadShowData` takes the neurons and spikes paths from the same map;
  - in the OSC server's `message` handler, log only when `!String(msg[0]).startsWith('/routing/')`.
- [ ] **Step 4: Update the smoke test and the repo files.**
  - `scripts/show-smoke.mjs`: the expected status body becomes `'{"neurons":true,"spikes":true,"firing":false,"vessel":false}'`.
  - `.gitignore`: add `data/` under `# Data`.
  - README, `Show data (data/)`: add the optional files.
    ```bash
    ln -s ~/Developer/Graphics/EoC-biomes-compute/Assets/StreamingAssets/biomes11/organoid_firing.f16 data/organoid_firing.f16
    ln -s ~/Developer/Fabrication/PDE_SimulacraNaturae/data/gcodes/single-object-436666.gcode data/vessel.gcode
    ```
    Add one line saying the routing view uses them, and that `/routing/*` OSC isn't logged.
- [ ] **Step 5: Verify.** `npm test` → pass. `node scripts/show-smoke.mjs` (no bridges running) → exits 0.
- [ ] **Step 6: Create the two symlinks locally** (commands above). `git status --short` shows no `data/` entries.
- [ ] **Step 7: Commit.** `git commit -m "Bridge: serve organoid_firing.f16 and vessel.gcode from data/, skip logging /routing/*"`.

### Task 3: Routing facts and responsive layout

**Files:**
- Create: `src/show/routing/facts.ts`, `src/show/routing/layout.ts`, `src/show/routing/layout.test.ts`

**Interfaces:**
- Produces from `facts.ts`:
  - `type MediumKey = 'visual'|'sound'|'solenoids'|'led'|'robot'|'fab'`.
  - `MEDIA: MediumKey[]` (that order: tour + rail), `BRIDGE_FED = ['visual','led','fab']`, `AUDIO_COMPUTER = ['sound','solenoids','robot']`.
  - `CARD_TITLES: Record<MediumKey, { title; sub }>`:
    - visual `VISUAL` / `EoC-biomes · Unity`;
    - sound `SOUND` / `Max/MSP patch · 4 ch`;
    - solenoids `SOLENOIDS` / `27 backbone strikers`;
    - led `LED` / `serial → 2 × 16×16`;
    - robot `ROBOT` / `3 arms, hung upside down`;
    - fab `FABRICATION` / `grown from this recording`.
  - `ATTRIBUTION`.
  - `VISUAL_FACTS`: scene `Scene_BraveNewWork`, port 1234, fps 60, blob `organoid_firing.f16`, threshold 0.1, fadeS 0.5, and the per-swarm agents, types, speed multipliers and deposits from Global Constraints, plus the `drawn here…` note.
  - `type VisualOutput = 'unity'|'td'|'td-sd'` and `VISUAL_OUTPUT_CHAINS`:
    - unity `['Unity','projection']`;
    - td `['Unity','Spout/Syphon/NDI','TD projection mapping','projection']`;
    - td-sd adds `'+ StreamDiffusion (TD)'` before `'projection'`.
  - `SOUND_FACTS`: tone [0.21, 20.0], grains [5.0, 160.0], grainMs [6.25, 400], kick [0.1, 0.83], kickPitch `C or D♭`, harmony `C minor · Phrygian`, channels 4, plus the badge. The source labels go on the paper figures.
  - `LED_FACTS { trail: 5, burstOver: 5, perFrameCap: 10, baud: 115200, idleMs: 500 }`.
  - `ROBOT_FACTS` (arms 3, `HC-SR04`, `MG995`, range [0, 180], badge, dormant `/inject/arm1..3 · off in this show`).
  - `VESSEL_FACTS` (file `single-object-436666.gcode`, `Potterbot 10 Super`, `B-mix stoneware`, source `SIGGRAPH 2026`, `printedMm: null as number | null`).
  - `BACKBONE_COUNT = 27`.
- Produces from `layout.ts`:
  - `interface Box { x; y; w; h }`;
  - `interface RoutingLayout { orientation: 'landscape'|'portrait'; centre: { cx; cy; r }; cards: Record<MediumKey, Box>; audioFrame: Box; scale: number }` and `routingLayout(w, h): RoutingLayout`;
  - `interface DetailLayout { orientation; header: Box; source: Box; story: Box; chain: Box; rail: Box; railTiles: Record<MediumKey, Box>; scale }` and `detailLayout(w, h): DetailLayout`;
  - `hitBox<K extends string>(boxes: Record<K, Box>, x, y): K | null`;
  - `typeScale(w, h): number`;
  - `fontPx(base: number, scale: number): number`, which is `max(8, round(base × scale))`.

- [ ] **Step 1: Write the failing tests** (`layout.test.ts`; helpers `inside(b, w, h)` and `overlap(a, b)`):
  - `landscape puts bridge-fed media left and the audio computer right` — at 1600 × 600: orientation `landscape`; every card `inside`; no pair overlaps; each `BRIDGE_FED` card centre x < `centre.cx` < each `AUDIO_COMPUTER` card centre x; `audioFrame` contains the three audio cards.
  - `portrait stacks them above and below` — at 600 × 1200: `portrait`; bridge-fed cards end above `cy − r`; audio cards start below `cy + r`.
  - `orientation switches at w/h 1.1` — `routingLayout(1100, 1000)` is landscape; `routingLayout(1090, 1000)` is portrait.
  - `extreme areas stay inside and apart` — both checks at 3000 × 500 and 320 × 900; `fontPx(11, typeScale(320, 900)) >= 8`.
  - `hitBox finds each card and misses the centre` — each card's centre point returns its key; (`cx`, `cy`) returns `null`.
  - `typeScale clamps` — 540 × 540 → `1`, 300 × 300 → `0.85`, 2000 × 2000 → `1.8`.
  - `detail layouts` — landscape 1600 × 900: `source.x + source.w <= story.x`; the rail is below `story` and holds six non-overlapping `railTiles`. Portrait 900 × 1600: `source.y + source.h <= story.y`.
- [ ] **Step 2: Run and confirm failure.** `node --test src/show/routing/layout.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Margin `m = 12 × scale`, gap `g = 10 × scale`.
  - **Landscape:**
    - centre `r = min(0.42h, 0.16w)` at (w/2, h/2);
    - left column `[m, w/2 − r − g]`, with visual 45 %, led 25 %, fab 30 % of its height (minus gaps);
    - right column `[w/2 + r + g, w − m]` = `audioFrame`, with a 16 × scale label band; inside it, sound 34 %, solenoids 26 %, robot 40 %.
  - **Portrait:** the same with axes swapped (`r = min(0.16h, 0.42w)`); the bands are rows, using the same percentages as widths.
  - **Detail:** header band 36 × scale; rail `max(64, 0.16h)` at the bottom; landscape source = left 28 % of the rest; portrait source = top 30 %; chain = bottom 22 % of `story`; six equal rail tiles with `g` between.
- [ ] **Step 4: Run and confirm it passes.** `node --test src/show/routing/layout.test.ts` → PASS. `npm run build` → no type errors.
- [ ] **Step 5: Commit.** `git commit -m "Routing: facts and responsive layout"`.

### Task 4: Firing blob reader

**Files:**
- Create: `src/show/routing/firingBlob.ts`, `src/show/routing/firingBlob.test.ts`

**Interfaces:**
- Produces:
  - `interface FiringBlob { neurons: number; frames: number; data: Uint16Array }`;
  - `parseFiringBlob(buf: ArrayBuffer): FiringBlob`;
  - `halfToFloat(h: number): number`;
  - `firingRow(blob, index: number, out: Float32Array): Float32Array`, which floors the index, clamps it to `[0, frames − 1]`, and fills `out[0..neurons)`.
- File format: ASCII `TFR1`, then uint32 LE neurons at byte 4, uint32 LE frames at 8, then half floats frame-major from byte 12. Value (f, n) = `data[f × neurons + n]`.

- [ ] **Step 1: Write the failing tests.** Test helper `blob(neurons, frames, values)` writes the header with a `DataView` (little-endian).
  - `half floats decode` — `0x3C00 → 1`, `0x3800 → 0.5`, `0x0000 → 0`, `0xC000 → -2`, `0x2E66 → 0.0999755859375`, `0x7C00 → Infinity`, `0x0001 → 2 ** -24`.
  - `rows are frame-major and clamped` — `blob(2, 3, [0x3C00,0, 0,0x3800, 0x3C00,0x3C00])`:
    - `firingRow(b, 1, out)` → `[0, 0.5]`;
    - index `-5` → row 0 `[1, 0]`;
    - `99` → row 2 `[1, 1]`;
    - `1.7` → row 1.
  - `bad files throw` — wrong magic `'TFR0'` throws `/TFR1/`; a buffer shorter than 12 + 2·n·f throws `/size/`.
- [ ] **Step 2: Run and confirm failure.** `node --test src/show/routing/firingBlob.test.ts` → FAIL.
- [ ] **Step 3: Implement.** The data is `new Uint16Array(buf, 12, neurons × frames)`; offset 12 is aligned. `halfToFloat` is the standard IEEE 754 binary16 decode (sign, 5-bit exponent, 10-bit mantissa, with subnormals and ±Infinity/NaN).
- [ ] **Step 4: Run and confirm it passes.** Then check the real file: `node -e "import('./src/show/routing/firingBlob.ts').then(m => { const b = m.parseFiringBlob(new Uint8Array(require('fs').readFileSync('data/organoid_firing.f16')).buffer); console.log(b.neurons, b.frames) })"` → `131 180000`.
- [ ] **Step 5: Commit.** `git commit -m "Routing: firing blob reader (TFR1 half floats)"`.

### Task 5: Sound features

**Files:**
- Create: `src/show/routing/soundFeatures.ts`, `src/show/routing/soundFeatures.test.ts`

**Interfaces:**
- Consumes: `SpikeEvent` (`src/types.ts`), `lowerBound` (`src/show/showMath.ts`, imported with `.ts`).
- Produces:
  - `RATE_WINDOW_MS = 100`, `BURST_FRACTION = 0.2`;
  - `populationRate(spikes, index, windowMs?): number`, the count in `(index − windowMs, index]`;
  - `peakRate(spikes, windowMs?): number`, the maximum over the recording and at least 1;
  - `interface BurstState { inBurst: boolean; ends: number }` and `stepBurst(prev, rate, threshold): BurstState`;
  - `interface PaperMappings { toneDensity; grainDensity; grainMs; kickDensity }` and `paperMappings(norm: number): PaperMappings`, with `norm` clamped to [0, 1].
- **Mappings (my call, from the VISAP text):**
  - tone = `0.21 + 19.79·√n`;
  - grains = `5 + 155·(1 − n^(1/6))`;
  - grainMs = `6.25 + 393.75·n`;
  - kick = `0.83 − 0.73·n`.

- [ ] **Step 1: Write the failing tests.** Spikes at `[1, 50, 99, 100, 101, 250]`.
  - `rate counts the window ending at the index` — `populationRate(s, 100) === 4`, `populationRate(s, 200) === 1`.
  - `peak is the busiest window` — `peakRate(s) === 4`; `peakRate([]) === 1`.
  - `a burst end is counted once` — `stepBurst({inBurst:false,ends:0}, 50, 40)` → `{inBurst:true, ends:0}`; then rate 30 → `{false, 1}`; then 30 again → `{false, 1}`.
  - `mappings hit the published ranges` — `paperMappings(0)` deep-equals `{toneDensity:0.21, grainDensity:160, grainMs:6.25, kickDensity:0.83}`, `paperMappings(1)` → `{20, 5, 400, 0.1}`. `paperMappings(0.25).toneDensity` ≈ 10.105 (±1e-9); `paperMappings(-1)` equals `paperMappings(0)`.
- [ ] **Step 2: Run and confirm failure.** `node --test src/show/routing/soundFeatures.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `peakRate` is a two-pointer sweep over the sorted spikes.
- [ ] **Step 4: Run and confirm it passes.** `node --test src/show/routing/soundFeatures.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Routing: sound features with the paper mappings"`.

### Task 6: Vessel G-code reader

**Files:**
- Create: `src/show/routing/vessel.ts`, `src/show/routing/vessel.test.ts`

**Interfaces:**
- Produces:
  - `interface VesselLayer { pts: Float32Array /* x,y mm, centred on the axis */; radius: number }`;
  - `interface Vessel { layers: VesselLayer[]; layerMm: number; heightMm: number; maxRadius: number; header: Record<string, string> }`;
  - `parseVesselGcode(text, pointsPerLayer = 200): Vessel`, which throws `Error('no toolpath moves')` when there are none;
  - `layerForIndex(v, index, frames = 180000): number` = `floor(index / frames × layers)`, clamped to `[0, layers − 1]`;
  - `printedLayers(v, printedMm: number | null): number` = `null` → all layers, else `clamp(floor(printedMm / layerMm), 0, layers)`.
- **Parse rules:**
  - header pairs come from `; k=v, k=v` comment lines before the first move;
  - `layerMm` = header `layerHeight`, default 1.6;
  - moves start after the line starting `;;; ======`, or from the top if there's no such line;
  - X, Y and Z are modal across G0/G1;
  - the centre is the mean XY of the parsed moves;
  - layer = `floor(z / layerMm)`, keeping only layers that have points;
  - `pointsPerLayer` evenly spaced points per layer;
  - `radius` = max distance from the centre; `heightMm` = max z.

- [ ] **Step 1: Write the failing tests.** Test helper `spiral(turns, perTurn, layerMm, r, cx, cy)` emits:
  - the header `; layers=…`, `; layerHeight=1.6, nozzle=4.0`;
  - priming `G1 X205.00 Y202.50 F10000`, `G1 Z20`;
  - `;;; ======`;
  - then `G1 F1200 X… Y… Z… E…` around a circle, z rising `layerMm` per turn.

  The tests:
  - `a spiral splits into layers centred on its axis` — `parseVesselGcode(spiral(3, 40, 1.6, 10, 100, 50), 20)`:
    - `layers.length === 3`, each `pts.length === 40`;
    - every `radius` within 10 ± 0.01;
    - mean of all x within ±0.5 (priming moves ignored);
    - `header.layerHeight === '1.6'`, `header.nozzle === '4.0'`;
    - `heightMm` ≈ 4.76 (±0.001).
  - `a bare G-code parses with defaults` — `'G1 X0 Y10 Z0.2\nG1 X10 Y0 Z0.2\nG1 X0 Y-10 Z0.2\n'` → `layerMm === 1.6`, `layers.length === 1`.
  - `no moves throws` — `parseVesselGcode('; nothing\n')` throws `/no toolpath moves/`.
  - `the index walks the layers linearly` — a 283-layer vessel: `0 → 0`, `90000 → 141`, `179999 → 282`, `-5 → 0`, `200000 → 282`.
  - `printed cut-off` — `printedLayers(v, null) === 283`, `(v, 3.2) === 2`, `(v, 0) === 0`, `(v, 9999) === 283`.
- [ ] **Step 2: Run and confirm failure.** `node --test src/show/routing/vessel.test.ts` → FAIL.
- [ ] **Step 3: Implement** to the parse rules above.
- [ ] **Step 4: Run and confirm it passes.** Then check the real file: `parseVesselGcode(readFileSync('data/vessel.gcode','utf8'))` → `layers.length === 283`, `header.layers === '283'`. Use a `node -e` import like Task 4's.
- [ ] **Step 5: Commit.** `git commit -m "Routing: vessel G-code reader with linear layer mapping"`.

### Task 7: Tour state machine

**Files:**
- Create: `src/show/routing/tour.ts`, `src/show/routing/tour.test.ts`

**Interfaces:**
- Consumes: `MEDIA`, `MediumKey` (facts).
- Produces:
  - `type TourStop = 'overview' | MediumKey`, `TOUR_STOPS: TourStop[] = ['overview', ...MEDIA]`;
  - `TOUR_DWELL_MS = 20_000`, `TOUR_IDLE_MS = 60_000`;
  - `interface TourState { enabled: boolean; stop: number; stopStartedAt: number; pausedUntil: number | null }`;
  - `createTour(now, enabled = true)`, `tourTick(s, now)`, `tourInteract(s, now)`, `setTourEnabled(s, enabled, now)`. All four return a new state.
  - `tourCurrent(s): TourStop`, `tourPaused(s, now): boolean`, `tourProgress(s, now): number` (0..1, 0 while paused).

- [ ] **Step 1: Write the failing tests.**
  - `dwell walks the stops and wraps` — from `createTour(0)`: at 19_999 still `overview`; 20_000 → `visual`; 40_000 → `sound`; 140_000 → `overview`.
  - `interaction pauses for 60 s, then restarts at the overview` — `tourInteract(at 30_000)` → `tourPaused(s, 89_999) === true`. `tourTick(s, 90_000)`: not paused, `tourCurrent === 'overview'`, `stopStartedAt === 90_000`.
  - `interaction while paused extends the pause` — interact at 30_000 and again at 80_000 → still paused at 139_999.
  - `a disabled tour never moves` — `createTour(0, false)`, tick at 500_000 → `overview`. `setTourEnabled(s, true, 500_000)` → `stopStartedAt === 500_000`.
  - `progress` — `tourProgress(createTour(0), 10_000) === 0.5`; while paused → `0`.
- [ ] **Step 2: Run and confirm failure.** `node --test src/show/routing/tour.test.ts` → FAIL.
- [ ] **Step 3: Implement.** A tick that crosses several dwells advances by the whole number of dwells elapsed.
- [ ] **Step 4: Run and confirm it passes.** `node --test src/show/routing/tour.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Routing: auto-tour state machine"`.

### Task 8: Telemetry contract

**Files:**
- Create: `src/show/routing/telemetry.ts`, `src/show/routing/telemetry.test.ts`

**Interfaces:**
- Produces:
  - `TELEMETRY_FRESH_MS = 2000`;
  - `interface Reading { value: number; at: number }`;
  - `interface Telemetry { sound: Partial<Record<'rate'|'burst'|'harmony'|'tones'|'grains'|'kick', Reading>>; strikes: { slot: number; velocity: number; at: number }[]; robot: Partial<Record<'proximity'|'servo'|'touch', Reading>>[] }`, with 3 robot entries and strikes capped at the newest 64;
  - `createTelemetry(): Telemetry`;
  - `applyTelemetry(t, address: string, args: unknown[], now): boolean`, which mutates `t` and returns true only for a well-formed `/routing/*` message;
  - `fresh(r: { at: number } | undefined, now): boolean`, true while `now − at < 2000`.

- [ ] **Step 1: Write the failing tests.**
  - `sound readings` — `/routing/sound/rate [12.5]` at 1000 → `t.sound.rate` deep-equals `{value:12.5, at:1000}`; `fresh(…, 2999) === true`, `fresh(…, 3000) === false`.
  - `robot readings are per arm, 1-3` — `/routing/robot/2/servo [90]` → `t.robot[1].servo.value === 90`; `/routing/robot/4/servo [90]` → returns `false`.
  - `a strike, velocity defaults to 1` — `/routing/solenoid [3, 0.8]` → last strike `{slot:3, velocity:0.8}`; `[5]` → velocity 1; `[27]` → returns `false`.
  - `malformed and foreign messages are ignored` — each returns `false` and leaves `t` deep-equal to a fresh `createTelemetry()`: `/row [5]`, `/routing/sound/rate ['x']`, `/routing/sound/rate []`, `/routing/sound/rate [NaN]`, `/routing/unknown [1]`.
  - `strikes keep the newest 64` — 70 strikes → `strikes.length === 64`, first slot from strike 7.
- [ ] **Step 2: Run and confirm failure.** `node --test src/show/routing/telemetry.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Numbers come in through `Number(arg)` and must be finite.
- [ ] **Step 4: Run and confirm it passes.** `node --test src/show/routing/telemetry.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Routing: /routing/* telemetry contract"`.

### Task 9: Swarm stand-ins

**Files:**
- Create: `src/show/routing/swarm.ts`, `src/show/routing/swarm.test.ts`

**Interfaces:**
- Produces:
  - `interface SwarmSpec { perNeuron; step; turn; spread; speedMul; align?: boolean }`, in normalized units (canvas = 1 × 1);
  - `SWARM_SPECS`:
    - physarum `{18, 0.00175, 0.6, 0.07, 2}`;
    - boids `{5, 0.004, 0.12, 0.12, 1.5, align: true}`;
    - termites `{1, 0.0011, 0.9, 0.045, 2}`;
  - `FLEE_RADIUS = 0.06`, `HOME_PAD = 0.06`;
  - `interface Swarm { spec; count; x; y; h: Float32Array; home: Float32Array /* xy per neuron */; nh: Float32Array }`;
  - `createSwarm(positions: {x;y}[] /* 0..1 */, spec, rand = Math.random): Swarm`, where agent *i* belongs to neuron *i* % N and home = `HOME_PAD + p × (1 − 2·HOME_PAD)`;
  - `stepSwarm(s, firing: Float32Array, threshold, frames, flee: number[] | null, rand = Math.random): void`;
  - `fleeSources(termites: Swarm, firing, threshold, out: number[]): number[]`, the xy of each firing termite.
- **Step rule:**
  - heading += (rand − 0.5)·turn·frames;
  - with `align`, it also turns toward the neuron heading;
  - past `spread` from home, it turns home by 0.25;
  - within `FLEE_RADIUS` of a flee source, it turns away by 0.5, at ×2 speed;
  - speed = `step × (firing[n] >= threshold ? speedMul : 1) × frames`. The speed is threshold-based like EoC; brightness is graded in the drawing.

- [ ] **Step 1: Write the failing tests** (deterministic `rand` via a small LCG; for exactness, specs with `turn: 0` and a large `spread`):
  - `agents start near their neuron` — 2 neurons, `perNeuron: 3` → `count === 6`; every agent within `spread` of `home[i % 2]`.
  - `firing neurons' agents move speedMul times as far` — one step, `frames 1`, firing `[1, 0]`, threshold 0.1 → displacement of agent 0 = `step × 2` and of agent 1 = `step` (±1e-9).
  - `agents flee a firing termite` — an agent 0.01 from a flee source → its distance grows after one step.
  - `fleeSources returns firing termites only` — firing `[0.2, 0.05]`, threshold 0.1 → two numbers, agent 0's xy.
- [ ] **Step 2: Run and confirm failure.** `node --test src/show/routing/swarm.test.ts` → FAIL.
- [ ] **Step 3: Implement** to the step rule above.
- [ ] **Step 4: Run and confirm it passes.** `node --test src/show/routing/swarm.test.ts` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "Routing: swarm stand-ins seeded on neuron positions"`.

### Task 10: Live state per frame

**Files:**
- Create: `src/show/routing/live.ts`, `src/show/routing/live.test.ts`

**Interfaces:**
- Consumes:
  - `showOutputAfter`, `LedFrame` (`src/show/ledFrame.ts`), `spikesBetween` (`showMath.ts`);
  - `firingRow`, `FiringBlob` (Task 4);
  - `populationRate`, `peakRate`, `stepBurst`, `BURST_FRACTION` (Task 5);
  - `fresh`, `Telemetry` (Task 8); `LED_FACTS`, `BACKBONE_COUNT` (Task 3).
- Produces:
  - `interface LiveNeuron { x; y /* 0..1 within the neuron bounds */; backbone: boolean; id: number }`;
  - `interface LiveInput { index: number | null; spikes: SpikeEvent[]; blob: FiringBlob | null; ledFrame: LedFrame | null; telemetry: Telemetry | null; dtMs: number; now: number }`;
  - `interface LiveState` with these fields:
    - `neurons: LiveNeuron[]`, `idToIdx: Map<number, number>`, `slotOf: Int16Array /* −1 or 0..26 */`, `backboneSlots: number[]`;
    - `lastIndex: number | null`, `fired: number[]`;
    - `spikeGlow: Float32Array`, `firing: Float32Array`, `firingSource: 'blob'|'spikes'`;
    - `strikeGlow: Float32Array(27)`, `strikeLog: { slot; neuronId; t }[] /* ≤ 8, newest last */`, `strikes: number`, `strikeSource: 'computed'|'live'`;
    - `rate`, `peak`, `burst: BurstState`, `rateHistory: Float32Array(160)`, `rateHead: number`, `rateSource: 'computed'|'live'`;
    - `ledCells: Float32Array(256)`, `ledCyan: Uint8Array(256)`, `ledLines: string[]`, `lastLedFrame: LedFrame | null`, `ledFrames: number`, `ledAgeMs: number`;
    - `arms: { th: number[]; proximity: number; servo: number; live: boolean }[] /* 3 */`.
  - `createLiveState(neurons: Neuron[], spikes: SpikeEvent[]): LiveState`;
  - `advanceLive(s, input): void`.
- **Rules (my calls from the spec):**
  - `dt = min(dtMs, 100)`.
  - **Slice:** `(showOutputAfter(lastIndex, index, 0), index]`. A `null` index → no slice and `lastIndex = null`.
  - **Decay:** spike glow τ 350 ms; strike glow τ 180 ms; LED cells τ 260 ms.
  - **Firing:** the blob row when `blob.neurons === neurons.length` and index ≠ null; otherwise a copy of `spikeGlow`, with `firingSource: 'spikes'`.
  - **Strikes:** backbone spikes in the slice. If any telemetry strike is fresh, only telemetry strikes (newer than the last applied) light, and `strikeSource: 'live'`.
  - **Rate:** `populationRate` at the index, or a fresh telemetry rate. Burst threshold `BURST_FRACTION × peak`. History sampled every 40 ms.
  - **LED:** when `ledFrame !== lastLedFrame`, apply up to `perFrameCap` firings:
    - the cell → cyan 1.0, its 8 neighbours → white 0.55;
    - on a burst, its row and column → white 0.3 (only raising values);
    - `ledLines` = `` `${isBurst ? 'C' : 'F'}:${floor(x)},${floor(y)}` ``.
  - **Arms:**
    - simulated proximity `0.5 + 0.5·sin(now/1000·0.45 + k·2.1)` → servo `(1 − p)·180`, unless that arm's telemetry is fresh;
    - chain `th[0]` → `((servo − 90)/90)·π/5` at rate 5/s, `th[1]` → `0.8·th[0]` at 2.5/s, `th[2]` → `0.8·th[1]` at 1.2/s (exponential approach).

- [ ] **Step 1: Write the failing tests.** Fixture: 3 neurons, ids 1–3, neuron 2 backbone; spikes `[{10, 2}, {95, 1}, {5, 3}]` sorted.
  - `a spike lights its neuron, then decays` — index 10, dt 16 → `spikeGlow[1] === 1`, `fired` contains 1. Next index 11, dt 350 → `spikeGlow[1]` ≈ `Math.exp(-1)` (±1e-3).
  - `backbone spikes strike their slot` — after index 10: `slotOf[1] === 0`, `strikeGlow[0] === 1`, `strikeLog.at(-1)` deep-equals `{slot:0, neuronId:2, t:10}`.
  - `a backwards jump re-slices from 30 ms before the new index` — index 100 lights neuron 0 (t 95) but not t 5; then index 50 lights nothing new; then index 6 lights neuron 2 (t 5).
  - `a long gap decays as 100 ms` — after a spike, `dtMs 60000` → `spikeGlow` ≈ `Math.exp(-100/350)` (±1e-3).
  - `the blob drives firing only when it matches` — a 3-neuron blob → `firingSource === 'blob'` and `firing` equals the row. A 131-neuron blob → `'spikes'`, with no throw.
  - `an LED frame becomes cells and serial lines` — `{isBurst:false, firings:[{x:2,y:3}]}` → `ledCyan[3*16+2] === 1`, `ledCells[3*16+3]` ≈ 0.55, `ledLines` deep-equals `['F:2,3']`. A burst of 12 firings → 10 lines, all starting with `C:`.
  - `fresh telemetry strikes replace computed ones` — a telemetry strike at slot 4 at `now` → `strikeSource === 'live'`, `strikeGlow[4] === 1`, `strikeGlow[0] === 0` despite a backbone spike in the slice.
- [ ] **Step 2: Run and confirm failure.** `node --test src/show/routing/live.test.ts` → FAIL.
- [ ] **Step 3: Implement** to the rules above. Positions are normalized to the neuron bounds, as `ledFrame.ts` does.
- [ ] **Step 4: Run and confirm it passes.** `npm test` → all pass.
- [ ] **Step 5: Commit.** `git commit -m "Routing: per-frame live state"`.

### Task 11: RoutingView overview, wired into the SHOW panel

**Files:**
- Create: `src/components/routing/glyphs.ts`, `src/components/routing/overview.ts`, `src/components/RoutingView.tsx`
- Modify: `src/components/ShowPanel.tsx` (props, render below the canvas), `src/App.tsx` (refs, data fetch, OSC guard, props)

**Interfaces:**
- Consumes: everything from Tasks 3–10, `extrapolateIndex`/`formatClock`/`phaseRemainingMs` (`showMath.ts`), `ShowStateSnapshot` (`ShowPanel.tsx`, as `import type`, because ShowPanel imports RoutingView).
- Produces:
  - `RoutingView` props:
    ```ts
    {
      neurons: Neuron[]; spikes: SpikeEvent[];
      showLatestRef: MutableRefObject<ShowStateSnapshot | null>;
      playbackTimeRef: MutableRefObject<number>;
      ledFrameRef: MutableRefObject<LedFrame | null>;
      telemetryRef: MutableRefObject<Telemetry>;
      firingBlob: FiringBlob | null; vessel: Vessel | null;
      connected: boolean; presentation: boolean; height?: number;
    }
    ```
  - `interface DrawInput { live; swarms: Record<'physarum'|'boids'|'termites', HTMLCanvasElement>; vessel; vesselLayer; index; mode: 'show'|'local'; phase: 'on'|'off'|'stopped'; offRemainingMs; dim; hover: MediumKey | null; visualOutput: VisualOutput; scale; now }`, exported from `overview.ts` and reused by Task 12;
  - `drawOverview(g, layout, input): void`.

- [ ] **Step 1: App plumbing.**
  - `lastLedFrameRef = useRef<LedFrame | null>(null)`, set to every non-null `frame` in `emitFrameOutputs` (sent or not).
  - `routingTelemetryRef = useRef(createTelemetry())`. In `ws.onmessage`'s `OSC_MSG` branch, first `if (applyTelemetry(routingTelemetryRef.current, data.payload.address, data.payload.args, performance.now())) return;`, so `/routing/*` never calls `setLastOscMessage`.
  - `firingBlob` and `vessel` state. In the data autoload effect, right after reading `status` and before the `!status.neurons && !status.spikes` return, fetch each optional file independently:
    - `status.firing` → `arrayBuffer()` → `parseFiringBlob`;
    - `status.vessel` → `text()` → `parseVesselGcode`;
    - each `.catch(e => console.warn(…))`.
  - Pass `neurons`, `playbackTimeRef`, `ledFrameRef`, `telemetryRef`, `firingBlob` and `vessel` through `ShowPanel` to `<RoutingView>`, which renders below the panel canvas.
- [ ] **Step 2: `RoutingView` loop.**
  - Width comes from a ResizeObserver; height is `props.height ?? max(420, width × 9/16)`; DPR-scaled canvas.
  - rAF capped at 30 fps; skipped while `document.hidden` or not intersecting (IntersectionObserver).
  - **Playhead:** with the show running, `extrapolateIndex(state, now − receivedAt)` (null in OFF), phase from the state, mode `show`. Otherwise `playbackTimeRef.current`, phase `stopped`, mode `local`.
  - `createLiveState` when neurons or spikes change; `advanceLive` each frame.
  - **Swarms:** three `createSwarm` from `SWARM_SPECS`, each with a 512 px offscreen canvas, stepped then drawn.
    - The fade per frame is `1 − (1 − f)^frames`, with f = physarum 0.06, boids 0.18, termites 0.012.
    - The dim colours are `rgba(140,140,140,0.22)`, `rgba(160,160,160,0.5)` and `rgba(190,190,190,0.35)`, with firing agents in white.
    - Flee sources come from `fleeSources`.
  - Recompute `routingLayout` on resize. `pointermove` sets `hover` via `hitBox`.
  - `dim` = 0.3 in OFF, else 1.
- [ ] **Step 3: `glyphs.ts` + `overview.ts`.** Draw everything into layout boxes, with text through `fontPx` and `JetBrains Mono`.
  - **Centre:** the neuron map lit by `spikeGlow`; `/index 000000`; `show clock · 60/s` or `local playback`; `ATTRIBUTION`; in OFF, `■ OFF · ON IN m:ss`. With no neurons loaded, the topology and copy still draw and the centre reads `load data/ or upload CSVs`.
  - **Spokes:** dashes to Visual and Sound (`/index · OSC → :1234`, `/index · OSC`); pulses to LED on each new frame (`SERIAL_SYNC`); dotted to Fabrication (`same recording · grown before the show`).
  - **Audio computer:** the frame labelled `AUDIO COMPUTER · Max/MSP`; Sound → Solenoids pulses per strike (`strikes`); the Robot → Sound dashed return (`sensors · serial`); `VISITORS · proximity, touch` into Robot.
  - **Cards:** `CARD_TITLES`, a `⤢` corner (brighter on hover), and the glyph and lines from the spec's overview section:
    - **Visual:** the three swarm canvases, plus `SetFrame → 131 intensities · N ≥ 0.1`, or `spikes · no firing blob`;
    - **LED:** `ledCells`;
    - **Solenoids:** `strikeGlow` on 27 strikers;
    - **Sound:** the `rateHistory` line;
    - **Robot:** hanging arms from `arms[].th`;
    - **Fabrication:** the profile + top view of `vesselLayer`, or `no vessel data (data/vessel.gcode)`.
- [ ] **Step 4: Verify.**
  - `npm test` and `npm run build` → pass.
  - `npm start`, open `http://localhost:5173`. The SHOW panel shows the routing overview below the timeline.
  - Press play (local): centre neurons, LED cells and strikers react.
  - Start a show with Start idx 0, End idx 599, Idx/s 60, Off 3, Fade 1 → dashes flow; OFF dims and counts down.
  - Screenshot at 1440 × 900 (Playwright) and check that nothing overlaps.
- [ ] **Step 5: Commit.** `git commit -m "Routing view: radial overview in the SHOW panel"`.

### Task 12: Detail views and rail

**Files:**
- Create: `src/components/routing/details.ts`
- Modify: `src/components/RoutingView.tsx` (detail state, hit-testing)

**Interfaces:**
- Consumes: `DrawInput`, glyph helpers (Task 11), `detailLayout`, `hitBox` (Task 3), the facts (Task 3).
- Produces:
  - `drawDetail(g, layout: DetailLayout, key: MediumKey, input: DrawInput): void`;
  - `drawRail(g, layout, input, active: MediumKey): void`;
  - the close target is `layout.header`'s right end, labelled `× ROUTING`.

- [ ] **Step 1: Interaction.**
  - Tapping a card opens its detail.
  - In a detail, tapping a rail tile switches to it; tapping the header's `× ROUTING` or the story returns to the overview.
  - There are no keyboard handlers.
- [ ] **Step 2: The six details** (content from the spec's detail sections, numbers from facts). Each draws the source box, the story, the chain boxes with live values, and the rail.
  - **Visual:**
    - three large swarm panels with the per-swarm lines;
    - the contrast strip: spike dots over the blob value for the same neurons;
    - the chain `/index i → OSCMapping :1234 → NeuronFiringSource → ≥ 0.1 = firing → agent i → i % 131`;
    - the cue line; `one pass = one day`;
    - `VISUAL_OUTPUT_CHAINS[visualOutput]`;
    - the `drawn here…` note.
  - **Sound:** the rate line and burst state; the four `paperMappings` values, labelled `VISAP 2025`; the SIGGRAPH 2026 description; the badge (`LIVE` when telemetry is fresh); the robot input and solenoid output arrows.
  - **Solenoids:** the neuron map with only the backbone neurons bright; 27 strikers; the strike log (neuron id, t); the badge.
  - **LED:** two 16 × 16 grids; the last `ledLines`; the chain `ledStep → SERIAL_SYNC → F:/C: ≤10 → 115200 → Arduino → 2 × 16×16 → fiber`; the idle note.
  - **Robot:** three arms; per-arm proximity and servo; the badge (`LIVE` per arm when fresh); the line into Sound; the dormant `/inject/arm1..3 · off in this show` dotted.
  - **Fabrication:**
    - the tall profile with mm labels (`heightMm`, current layer z) and `not printed` above `printedLayers` when `printedMm` is set;
    - the top view of the current layer over the previous 24;
    - `layer k / N ≈` and the chain steps;
    - the `termite mounds · files to come` slot.
- [ ] **Step 3: Verify.**
  - `npm run build` → pass.
  - In the browser, open each card, step through all six via the rail, and close.
  - Screenshot each detail at 1440 × 900 and at 900 × 1400 (portrait). Text stays inside its box.
- [ ] **Step 4: Commit.** `git commit -m "Routing view: detail views with live rail"`.

### Task 13: Tour, operator controls, presentation sizing, docs

**Files:**
- Create: `src/utils/routingSettings.ts`, `src/utils/routingSettings.test.ts`
- Modify: `src/components/RoutingView.tsx`, `src/components/ShowPanel.tsx`, `README.md`, `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: the tour API (Task 7), `VisualOutput` (Task 3).
- Produces:
  - `interface RoutingSettings { visible: boolean; tour: boolean; visualOutput: VisualOutput }`, default `{ visible: true, tour: true, visualOutput: 'unity' }`;
  - `loadRoutingSettings(storage?)`, `saveRoutingSettings(s, storage?)`, with key `organoid-analysis.routing` and the same try/catch pattern as `tileSpans.ts`.

- [ ] **Step 1: Write the failing tests** (`routingSettings.test.ts`, the memory store from `tileSpans.test.ts`):
  - `defaults` — an empty store → `{visible:true, tour:true, visualOutput:'unity'}`;
  - `round trip` — save `{false, false, 'td-sd'}` → load returns it;
  - `corrupt or unknown values fall back per field` — stored `{"visible":"yes","visualOutput":"vhs"}` → the defaults for both, other fields kept.
- [ ] **Step 2: Run, fail, implement, pass.** `node --test src/utils/routingSettings.test.ts`.
- [ ] **Step 3: Header and tour in `RoutingView`.**
  - **Header:** a DOM row above the canvas: `ROUTING`, `BRIDGE OFFLINE` while `!connected`, the tour indicator (`TOUR` + a progress tick from `tourProgress`, or `TOUR PAUSED · 0:42` from `pausedUntil`), and the operator controls: show/hide, tour on/off, and a visual-output select with labels `Unity direct` / `+ TD mapping` / `+ TD mapping + StreamDiffusion`. The controls are styled like ShowPanel's (`btn`, `data-label`), hidden in presentation, and persisted with `saveRoutingSettings`.
  - **Interaction:** `window` listeners for `pointerdown`/`keydown`/`wheel` (passive) call `tourInteract`.
  - **What shows:**
    - while running, the overview or detail comes from `tourCurrent`;
    - while paused, the manual choice;
    - when the pause ends, the overview;
    - with the tour off, the manual choice only.
  - The tour never calls `preventDefault`.
- [ ] **Step 4: Presentation sizing in `ShowPanel`.**
  - With routing visible and `presentation`, the raster height is `RASTER_H`.
  - `RoutingView` gets `height = max(360, window.innerHeight − routingTop − 16)`, where `routingTop` is the routing container's `getBoundingClientRect().top` after layout, recomputed on resize.
  - Outside presentation, there's no height prop (width × 9/16, at least 420).
  - Hidden routing renders nothing, and its loop stops.
- [ ] **Step 5: Docs.**
  - **README:** a `Routing view` section under Show Mode covering:
    - what each card shows and its source (computed, simulated or live);
    - tap → detail, the rail, the tour (20 s stops, 60 s idle) and the operator controls;
    - the optional `data/` files;
    - the `/routing/*` table for the Max patch.
  - **`docs/ARCHITECTURE.md`:** a `Routing view` section: modules under `src/show/routing/`, `RoutingView` and its refs (show snapshot, `playbackTimeRef`, `lastLedFrameRef`, telemetry), the firing blob and vessel loads, the `/routing/*` path (`:3333 → OSC_MSG → applyTelemetry`, not logged by the bridge), and the presentation sizing.
- [ ] **Step 6: Full verification.**
  - `npm test` and `npm run build` → pass. `node scripts/show-smoke.mjs` → exits 0.
  - `npm start` with the `data/` symlinks:
    - a short show (`0..599 @ 60`, off 3 s) → ON, then OFF dims, then ON again;
    - leave it untouched for 40 s → the tour reaches `sound`;
    - click → `TOUR PAUSED · 1:00` counts down; resumes at the overview after 60 s.
  - ⛶ PRESENT at 1920 × 1080 and at 1080 × 1920 (Playwright resize): the SHOW panel fits one screen, and the layout is landscape and portrait respectively.
  - `git status --short` is clean apart from the intended files.
- [ ] **Step 7: Commit.** `git commit -m "Routing view: auto-tour, operator controls, presentation sizing, docs"`.
