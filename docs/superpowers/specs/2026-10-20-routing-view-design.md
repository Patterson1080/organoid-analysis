# Routing view — design

Date: 2026-10-20 · Branch: `routing-view` (organoid-analysis)

Decisions are marked **(theirs)** when the artist made them and **(my call)** when they were left to the builder and settled here. Mockups that were reacted to: `.superpowers/brainstorm/56590-1792534314/content/` (`layout.html` → radial chosen; `show-routing.html` → current direction). A builder check was run on the first draft; its questions are answered below.

## Intent

The SHOW panel already streams the show's one signal, the organoid recording's index, to every part of *Simulacra Naturae*. This adds a live view of **where that signal goes and how each medium turns it into its outcome**: visuals (EoC-biomes), sound (Max/MSP), solenoids, LED matrices, the robot arms (which feed back into the sound), and the fabricated central artifact.

Audience **(theirs)**: visitors in the room, where it's part of the work, and talks and demos, where it explains the system. Each medium is shown "both, layered" **(theirs)**: the spatial story reads at a glance, and the addresses, rates and numbers sit underneath as annotation.

**Success:** a visitor who watches for a minute can point at a medium and say what part of the organoid's activity drives it. Nothing on screen misstates the wiring. The show's clock, OSC, LEDs and sound are untouched.

**Anti-goals:**
- implying live tissue, or that we recorded the data;
- inventing a mapping the system or the papers don't have;
- any effect on show timing or outputs;
- a dashboard look (it should read as part of the piece: black, monochrome, precise type, like the rest of the app).

**Numbers rule (theirs):** the screen states the **running system's** numbers: the 11.3 scene, the vessel G-code, the bridge's config. The papers fill in only where no file exists (the sound mappings, the printer and clay), and each such figure is labelled with its paper.

## Where it lives

- **SHOW panel (theirs):** a new section inside the SHOW panel, below the existing HUD and timeline (overview strip, cue ticks, cycle bar, ±1 s raster). The timeline stays as it is; the routing view doesn't add another one **(theirs)**.
- **Same tab (theirs):** visitors see the operator's own tab in ⛶ PRESENT on a display attached to the show machine. There is no viewer-only mode and no network feed, and the bridges stay localhost-only.
- **Header:** the section has a `ROUTING` header with three operator controls, all kept per browser like tile spans: **show/hide**, **tour on/off**, and **visual output** (see the Visual detail). In presentation the controls disappear and routing is always shown **(my call)**.

## Overview: radial on the real topology

The overview is radial **(theirs)**. Its geometry adapts to whatever space it gets (see the layout section): the centre is the organoid, the media the bridge feeds directly sit on one side, and the audio computer's group sits on the other.

- **Centre: the organoid.** The 131 neurons at their recorded positions, from the neurons CSV, lit by their **spikes** on the current playhead.
  - Under it: `/index 149737`, plus `show clock · 60/s` or `local playback`.
  - Under that, the attribution line, required on every visitor-facing screen (see `business/docs/works-technical-facts.md`): `pre-recorded · 180 s · Kosik Neurobiology Lab, UCSB` **(my call on wording)**.
- **Fed directly by the bridge.**
  - **Visual**: spoke = moving dashes, `/index · OSC → :1234`.
  - **LED**: spoke = pulses, `SERIAL_SYNC`.
  - **Fabrication**: spoke = faint dotted, `same recording · grown before the show`. It has no live link; the live index only selects which layer to show.
- **The AUDIO COMPUTER group** **(theirs: solenoids and robot hang off the audio computer)**. A faint frame labelled `AUDIO COMPUTER · Max/MSP` holds:
  - **Sound**: spoke from the centre = moving dashes, `/index · OSC`.
  - **Solenoids**: a link from the Sound card carries one pulse per strike, labelled `strikes`.
  - **Robot**: a dashed return line from Robot into Sound, labelled `sensors · serial`. A `VISITORS · proximity, touch` arrow comes into Robot from outside.
- **Each card** has a title, a one-line subtitle, a live glyph, and two to four lines of mapping text. A corner `⤢` marks it as tappable.

The pulse and dash animation is decorative timing, not a packet log. Pulses are emitted on the events they stand for: an LED frame sent, a backbone spike.

## Detail views

Tapping or clicking a card opens that medium full-size inside the routing area, laid out like mockup option C **(theirs)**:
- the source on one side and the medium's story drawn large;
- below them, the signal chain as boxes with live values, the cues and the destination;
- a **compact live rail of all six media** along the bottom **(my call: option C had it)**, with the open one outlined. Tapping a rail tile switches detail.

Tapping the story, or `× ROUTING`, returns to the overview. There are no new keyboard shortcuts **(my call)**: Space, ←/→ and the presentation's Esc handling stay exactly as they are.

### 1 · Visual: EoC-biomes (Unity)

**What EoC actually reads** (builder check, verified): `/index` selects a row of `organoid_firing.f16`.
- **The blob:** `TFR1` header, 131 neurons × 180 000 frames, half floats. Its values are the recording's **normalized firing rates**, the `rates_norm_*` columns of `spikes.csv`, not the spikes.
- **Firing:** a neuron counts as firing at **≥ 0.1**. That's about 9.8 % of neuron-frames, against 0.13 % for spikes.
- **So the card reads that same file** **(my call)**: `data/organoid_firing.f16`, served by the bridge, decoded per frame. If the file is absent the card falls back to spikes and says so (`spikes · no firing blob`).

The numbers below are the 11.3 Brave New Work scene's (`Scene_BraveNewWork.unity`, `11.3 …/assets/*Params.asset`, read from the EoC working tree).

- **Story:** three swarm panels seeded on the neuron positions, physarum, boids and termites. A neuron whose rate crosses 0.1 excites the agents sitting on it in all three, brighter with its value. Firing termites stamp Dispersal, and the other two flee it.
  - The panels are **our drawing, not the Unity render**, labelled `drawn here: 1 in ~400 physarum, 1 in ~30 boids, every termite`.
- **Contrast strip** (detail only): the spikes as dots, over the smoothed rate EoC responds to, for the same neurons. It shows the one mapping step visitors can't otherwise see.
- **Chain:** `/index i` (OSC int, 60/s) → `OSCMapping` UDP :1234 → `NeuronFiringSource.SetFrame` → row *i* of `organoid_firing.f16` (131 normalized rates) → `≥ 0.1 = firing` (0.5 s linear fade when `/index` stops) → agent *i* reads neuron *i* % 131 → speed × and deposit.
- **Per swarm:**

  | Swarm | Agents | Firing response |
  |---|---|---|
  | Physarum | 1,000,000 · 8 types | speed ×2 · deposit 0.7 (types 0–3) / 1.0 (4–7) · flees Dispersal |
  | Boids | 20,000 · 4 types | speed ×1.5 · deposit 0.5 · flees Dispersal |
  | Termites | 131, one per neuron at its recorded position | speed ×2 · trail → 4 (renders white) · builds mound walls only while firing · stamps Dispersal |

- **Cues:** `/sim_resetSimsOnly` → `/sim_on 5` → `/sim_resetTermites` ×5 · `/sim_resetPhysarum` ×10 → `/sim_off 5` → 2 min dark, sims paused (`pauseWhenDark`).
- **Also:** one `/index` pass is one day, because the diurnal sun sweeps the temperature field once per pass.
- **Output chain (theirs: it varies by show):** Unity → projection directly, *or* Unity → Spout/Syphon/NDI → TouchDesigner projection mapping, *optionally* + a StreamDiffusion TouchDesigner patch overlaid on the final visual.
  - The operator picks the current setup in the routing header (`Unity direct` / `+ TD mapping` / `+ TD mapping + StreamDiffusion`), default `Unity direct` **(my call)**.
  - The chain draws the chosen stages. TouchDesigner never receives `/index`.

### 2 · Sound: audio computer, Max/MSP

In this show Max reads the matrix itself at each `/index` and composes in a custom patch **(theirs)**. The patch isn't available yet, so the description comes from the papers **(theirs)**, and the card says so.

- **What the patch listens to** (SIGGRAPH 2026): population firing rate, and the boundaries of network bursts. Rate drives synthesis density and spatialization; burst endpoints cue harmonic transitions. C minor with Phrygian inflections, distorted electric guitar samples, four channels, a reverb per channel.
- **Live values, computed here** **(my call)**: population rate from the spikes, and burst on/off with a count of burst ends.
  - Labelled `≈ computed from spikes · the patch is the authority`. Which block of the CSV the patch reads (spikes, rates or normalized rates) is a later question.
- **The paper mappings**, labelled `VISAP 2025` because the 2026 paper gives no numbers:
  - sustained-tone density = √rate → 0.21–20.0 events/s;
  - grain density = inverted sixth root → 5.0–160.0 events/s;
  - grain duration linear in rate, 6.25–400 ms;
  - kick density inverse in rate, 0.1–0.83 events/s, pitch C or D♭.
- **Normalization** **(my call)**: rate is divided by the recording's peak population rate over the same window, so each mapping spans its published range across this recording.
- **Inputs it also shows:** the robot's sensor stream entering the patch. The solenoid strikes leave from it.

### 3 · Solenoids

- **Mapping:** the 27 backbone neurons (the strongly coordinated subset), one solenoid each, embedded in the ceramic vessels and suspended glassware. Max on the audio computer strikes each one when its neuron fires, after receiving the index **(theirs)**.
- **Story:** the neuron map with only the 27 backbone neurons bright, and a 27-striker array that flashes per strike, with a short strike log (neuron id, time).
- **Values (my call):** strikes are computed from backbone **spikes** in the same spike slice the page emits per frame. Labelled `≈ computed from spikes · the patch is the authority`. If the patch strikes on the normalized rate instead, the card changes source (a later question).
- Needs the backbone fix below.

### 4 · LED matrices

- **Mapping:**
  - shared `ledStep` (`src/show/ledFrame.ts`): trail of the 5 most recent neurons; a burst (> 5 distinct neurons in one frame) lights every firing neuron; positions normalized to 16 × 16 cells;
  - → `SERIAL_SYNC` → serial bridge → `F:x,y` (trail) or `C:x,y` (burst), at most 10 per frame → USB 115200 → Arduino → two 16 × 16 RGB matrices in custom frames → fiber optics threaded through the glassware;
  - 0.5 s without frames → the sketch's white idle shimmer.
- **Source of truth (my call):** the card draws the **last `LedFrame` that `emitFrameOutputs` computed**, exposed on a ref. It's the frame the page sends, and during the show the same `ledStep` runs on the same slices in the bridge. So the card can't drift from the matrices into a re-simulation. The `F:`/`C:` lines are rendered from it, applying the serial bridge's 10-cell cap.
- **Physical note:** two matrices in laser-cut frames; fibers carry the light into the glassware with the hydroponic plants.

### 5 · Robot arms

- **Mapping (theirs + paper):** three artificial muscles (carbon-fiber spine, acrylic vertebrae, mylar leaves, Spectra cable) **hung upside down**, so gravity swings them as the motors turn.
  - Per muscle: HC-SR04 proximity → MG995 servo 0–180° on the Arduino, plus capacitive touch on the leaves.
  - The Arduino also sends the sensor values to Max over serial, where they shape the composition: **the feedback into the sound**.
- **Story:** three hanging arms that trail their servo with a gravity lag, proximity and servo readouts per arm, and the line into Sound.
- **Values are simulated** (slow sine "visitors") **until telemetry arrives**, and the card says `SIMULATED · sensors go to the audio computer`.
- **Dormant route, detail only:** EoC listens on `/inject/arm1..3`, but those sources are off in 11.3 and the artist confirmed the robot doesn't reach the visuals **(theirs)**. Drawn as a dim dotted line labelled `off in this show`.

### 6 · Fabrication: the central artifact

- **Vessel (theirs: real G-code layer):** `single-object-436666.gcode`.
  - Its header: 283 layers × 1.6 mm, one continuous spiral, nozzle 4.0, 332 × 323 × 451 mm.
  - Grown by the differential-growth sketch (`PDE_SimulacraNaturae`) from this same 180 s recording: a neuron's position and firing intensity set the local growth; a spike is an impulse with quadratic falloff.
  - Printed in B-mix stoneware on a Potterbot 10 Super (`SIGGRAPH 2026`).
- **Story:**
  - **side profile** from per-layer radius, grown layers bright, the current layer as a line;
  - **top view** of the current layer's real contour, over the previous ~24 layers;
  - **chain:** `recording 0–180 s → growth sim (5 min) → layer on firing → 283 × 1.6 mm spiral → G-code → Potterbot · stoneware`.
- **Layer ↔ index (my call):** linear and labelled `≈`: `layer = floor(index / 180000 × layerCount)`.
  - The sketch only adds a layer when a neuron fires (within ±15 ms) and at most once per N growth iterations, so quiet stretches add none.
  - An exact mapping needs the sketch's capture log; that's a future swap behind the same function.
- **Printed cut-off:** the artist thinks the print was stopped early **(theirs)**. Optional `vesselPrintedMm` in `facts.ts`: layers above it are drawn as `not printed`. Default: the whole G-code.
- **Termite mounds:** PLA, from the termite pheromone field on a 100³ voxel lattice. Files come later **(theirs)**. The detail keeps a second slot titled `termite mounds · files to come`; nothing is drawn there yet.
- **Frame:** the laser-cut parametric frame holding the vessel, mounds and LED matrices is mentioned as context only. It isn't signal-mapped.

## Layout: any aspect, all the space (theirs)

The presentation screen changes between shows, landscape or portrait, and presentation "should use whatever screen real estate we have" **(theirs)**. So the routing view is laid out from its actual size, not a fixed canvas **(my call on the rules)**.

- **Pure layout function** (`layout.ts`): (width, height) → boxes for the centre, the six cards, the audio-computer frame, the spoke anchors, and the detail regions.
  - **Landscape (w/h ≥ 1.1):** centre column in the middle; the bridge-fed media stacked on the left; the audio-computer group on the right.
  - **Portrait (w/h < 1.1):** centre band in the middle; bridge-fed media as a row above; the audio-computer group as a row below.
  - **Within a card**, the glyph sits beside its text on a wide card and above it on a tall one.
  - **Detail:** landscape puts the source left and the story right, rail at the bottom. Portrait puts the source top and the story below, rail at the bottom.
- **Type** scales with the area: base 11 px × clamp(min(w, h) / 540, 0.85, 1.8). It never goes below 8 px.
- **Normal view:** routing is full panel width × 9/16 of it (at least 420 px tall).
- **Presentation:**
  - the raster drops to `RASTER_H` (160 px) while routing is shown;
  - routing takes the rest of the viewport height below the timeline, at least 360 px. The SHOW panel is one screen; other open views follow below, as today.
- **Hit-testing** uses the same layout boxes, so taps land at any size.
- **Touch:** not used yet but wanted later **(theirs)**. Taps arrive as pointer events and nothing depends on hover. Hiding the presentation exit icon and tile toggles from visitors waits for the touchscreen.

## Auto-tour

**(theirs)** When nobody touches the interface, the routing view tours by itself. Any interaction stops the tour, and **60 s** without interaction starts it again.

- **Sequence (my call):** overview 20 s → Visual → Sound → Solenoids → LED → Robot → Fabrication, 20 s each (the artist's order of the media) → overview → …
- **Resume (my call):** restarts at the overview.
- **Interaction = any `pointerdown`, `keydown` or `wheel` on the page** **(my call)**. A presenter scrubbing elsewhere pauses it too.
- The tour only changes what the routing area shows. It never sends keys, never moves the playhead, and never touches fullscreen.
- **Header indicator:** a thin progress tick for the current stop, plus `TOUR` / `TOUR PAUSED · 0:42`.
- **Tour off** (operator toggle) → stays where it is.

## Signal sources and states (my call)

- **Playhead.**
  - While the show runs: the panel's extrapolated show index (`extrapolateIndex`), the same as the raster.
  - Otherwise: App's local `playbackTimeRef`. Local playback also sends `/index`, LEDs and sound, so the routing is still true. The centre label says which.
- **Per-frame spikes:** `(lastDrawnIndex, index]` from the sorted spike array, by binary search, capped at 30 ms like `showOutputAfter`, so a jump or reconnect never floods the glyphs.
- **Firing blob:** row `clamp(floor(index), 0, frames − 1)`, decoded on demand: 131 half-float conversions per frame.
- **States:**
  - **ON:** live.
  - **OFF** (2 min dark): everything dims to ~30 %, as the raster does, and the centre shows `■ OFF · ON IN 1:23`. No pulses. The tour keeps going, dim.
  - **Stopped and paused:** last state held; swarms idle (wander, no firing).
  - **Bridge offline:** still animates from local playback if data is loaded; header `BRIDGE OFFLINE`.
  - **No data loaded:** the topology and text are drawn, with no live values, and the centre reads `load data/ or upload CSVs`.
  - **A missing optional file** (`organoid_firing.f16`, `vessel.gcode`): only that card degrades, and says which file.

## Telemetry contract: designed now, used later

**(theirs: "design for it, later")** The audio computer can report what it actually did. The bridge already forwards every inbound OSC message (UDP :3333) to the page as `OSC_MSG`, so Max only needs `[udpsend <show-machine-ip> 3333]`. Addresses **(my call)**:

| Address | Args | Card |
|---|---|---|
| `/routing/sound/rate` | float, the rate the patch uses | Sound |
| `/routing/sound/burst` | int 0/1 | Sound |
| `/routing/sound/harmony` | int, harmonic step | Sound |
| `/routing/sound/tones` · `/grains` · `/kick` | float events/s | Sound |
| `/routing/solenoid` | int slot 0–26 [, float velocity] | Solenoids (one strike) |
| `/routing/robot/<1-3>/proximity` | float cm | Robot |
| `/routing/robot/<1-3>/servo` | float degrees | Robot |
| `/routing/robot/<1-3>/touch` | int 0/1 | Robot |

- **Freshness:** a card shows `LIVE` and uses telemetry while its last message is < 2 s old. Otherwise it falls back to `COMPUTED` / `SIMULATED`. No UI change is needed when Max starts sending.
- **Bridge:** `osc-bridge.js` logs every inbound OSC message (`console.log('OSC IN: …')`). At 10 Hz+ telemetry that floods the terminal during a 50 min show, so it skips `/routing/*`. Other addresses still log.
- `/row` handling is unchanged, and `/routing/*` never moves the playhead.

## Fix: backbone flag from `labels_positions.csv`

`neuronsFromRows` doesn't recognize the show CSV's `backbone_labels` column. Every neuron loads with `is_backbone = false`, although the file marks 27.

- **Fix:** add `backbone_labels` to the backbone column candidates. Extend `neuronRows.test.ts` so the labels_positions case asserts the flag.
- **Side effect** (intended, matches the README): with the show dataset, the circular graph's inner map, the neural web's backbone set and Organoid3D's backbone colors start showing the 27 backbone neurons. The bridge's LED path is unaffected, because it doesn't use the flag.

## Performance

- **One rAF loop** for the routing canvas, capped at **30 fps**, the same cap the circular graph uses.
- **Paused** when the canvas isn't intersecting the viewport (IntersectionObserver) or `document.hidden`.
- **Agent caps** for the drawing: physarum 18 per neuron (~2.4k), boids 5 per neuron (~650), termites 131. Each swarm is drawn to its own offscreen canvas (512 px), then scaled into cards and details.
- **No React state at frame rate.** Everything is read from refs, as ShowPanel does.
- **Memory:** the firing blob stays as a `Uint16Array` (47 MB), decoded per row. The vessel is parsed once, down to ~200 points per layer (≈ 0.5 MB).

## Architecture (my call)

- **`src/show/routing/` — pure modules, Node-testable** like `showMath.ts`:
  - `facts.ts`: every number, address and label the view shows, per medium, with its source (scene, G-code, paper), in one place to edit when a scene changes. Also holds `vesselPrintedMm`.
  - `layout.ts`: the responsive layout described above.
  - `firingBlob.ts`: parse `TFR1` (magic, uint32 neurons, uint32 frames, then half floats, frame-major), `rowAt(index)`, and half → float.
  - `soundFeatures.ts`: population rate over a window, burst on/off and end counting, and the VISAP mappings with their ranges.
  - `vessel.ts`: G-code text → layers (spiral split by the header's layer height; points re-centred on the axis; ~200 per layer), `layerForIndex` (linear), and the printed cut-off.
  - `tour.ts`: the tour state machine (sequence, 20 s dwell, 60 s idle resume), with an injectable clock.
  - `telemetry.ts`: `/routing/*` parsing into per-card values with timestamps, and freshness.
  - `swarm.ts`: stand-in agents (seeded on the positions; firing value → speed and brightness; flee firing termites). Pure step; the draw stays in the component.
- **`src/components/RoutingView.tsx`:** canvas, rAF loop, overview and detail drawing (glyphs draw into layout boxes), hit-testing, the tour, and the header controls.
- **`src/components/ShowPanel.tsx`:** renders `RoutingView` below its canvas and passes the show snapshot ref. Shrinks the raster in presentation while routing shows.
- **`src/App.tsx`:**
  - `lastLedFrameRef`, set in `emitFrameOutputs`;
  - `routingTelemetryRef`, fed by `OSC_MSG` with `/routing/` addresses;
  - passes `neurons` and `playbackTimeRef` through ShowPanel;
  - on bridge connect, fetches `organoid_firing.f16` (ArrayBuffer) and `vessel.gcode` (text) when `/data/status` lists them.
- **`server/osc-bridge.js`:**
  - routes `/data/organoid_firing.f16` (`application/octet-stream`) and `/data/vessel.gcode` (`text/plain`), both listed in `/data/status`;
  - skips logging `/routing/*`.
- **`data/` symlinks**, like the CSVs:
  - `organoid_firing.f16` → `~/Developer/Graphics/EoC-biomes-compute/Assets/StreamingAssets/biomes11/organoid_firing.f16`;
  - `vessel.gcode` → `~/Developer/Fabrication/PDE_SimulacraNaturae/data/gcodes/single-object-436666.gcode`;
  - add `data/` to `.gitignore`, since only `*.csv` is ignored today.
- **`src/utils/neuronRows.ts`:** the backbone fix.

## Testing

- **Unit** (`npm test`, `node --test`):
  - `layout`: landscape and portrait boxes stay inside the area and don't overlap; hit-test round trip;
  - `firingBlob`: header parse, half → float on known bit patterns, row bounds;
  - `soundFeatures`: rate window, burst edges, mapping ranges and endpoints;
  - `vessel`: layer split on a small synthetic spiral, the real header fields, cut-off, `layerForIndex` bounds;
  - `tour`: dwell advance, interaction pause, 60 s resume to the overview, tour-off;
  - `telemetry`: address parsing, freshness;
  - `neuronRows`: the backbone fix;
  - bridge: `/data/status` lists the new files.
- **Build:** `npm run build` (tsc).
- **Manual:** in the browser, with `data/` loaded:
  - a short show (`0..599 @ 60`, off 3 s): ON / OFF dimming, the tour cycling, interaction pause and 60 s resume, each detail view and the rail;
  - presentation at 1920 × 1080 and at 1080 × 1920 (both layouts, one screen);
  - LED card cells vs the matrices;
  - Visual with and without the blob; Fabrication with and without the G-code.

## Docs

- README: a `Routing view` section under Show Mode (what each card shows, the tour, the `data/` files, the telemetry addresses for the Max patch).
- `docs/ARCHITECTURE.md`: routing modules, data flow and telemetry path (required before merging to main).
- This spec.

## Out of scope

- Implementing telemetry in Max.
- Termite mound geometry (until files arrive).
- The real EoC render in the page.
- Editing routes from the UI: this is a depiction, not a router.
- An exact layer schedule (needs the sketch's capture log).
- Touchscreen hardening.
- A viewer-only tab or a network feed.
- Electron.

## Later questions (for when the patch and files are at hand)

1. Which block of `spikes.csv` the Max patch reads (spikes, rates, normalized rates), and its exact solenoid trigger rule.
2. Whether `single-object-436666.gcode` is the cut-off version, or the height the print stopped at (`vesselPrintedMm`).
3. The termite mound files.
4. The growth sketch's layer capture log, for an exact layer schedule.
