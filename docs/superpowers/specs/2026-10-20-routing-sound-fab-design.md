# Routing view: sound from the Max patch, central artifacts in 3D — design

**Date:** 2026-10-20 · **Branch:** `routing-sound-fab` (off `routing-view`, PR #1) · **Builds on:** `docs/superpowers/specs/2026-10-20-routing-view-design.md`

## Intent

The routing view's SOUND card currently comes from the VISAP 2025 and SIGGRAPH 2026 papers and is computed from spikes, labelled "≈". The user has now handed over the Max patches (`dev/audio/`): "can you use these max patches to make the audio visualization better?" They also gave the termite form's mesh (`dev/termites/Final_Scaled_Artifact.obj`) with this note: "as you're checking the documentation footage, you can see how we used the digital fabricated objects and make something cooler in the fabrication part."

Visitors hear the sound and stand next to the objects. The view should therefore show what Max does at this moment, and the artifacts as they stand in the room, not a summary of a paper.

Audience, screen and interaction are unchanged from the parent spec:

- **Audience:** room visitors and talks.
- **Screen:** the SHOW tab, presented at any aspect ratio.
- **Interaction:** auto-tour, with a 60 s idle resume.

## Goals

1. **SOUND states the patch's own rules.** The card and detail state the patch's rules and their values at the playhead:
   - what Max reads at `/index` (activity level, burst flags);
   - the interval, chance and length tables;
   - the 17-step chord progression and its notes;
   - the 16 positions over 4 speakers;
   - the arm-1 arpeggio from the serial patch.
2. **FAB shows both central artifacts in 3D.**
   - **Termite form:** rendered from the real mesh as its 4 print segments, standing lit in its frame as documented.
   - **Clay vessel:** its spiral toolpath, growing layer by layer ≈ with the index.
3. **Every value carries its status:**
   - exact (a pure function of the data and the patch);
   - ≈ (it depends on Max state this machine can't see);
   - LIVE (telemetry).

## Non-goals

- The ROBOT card and the arms; the user is collecting that information. Only arm 1's distance, which drives the arpeggio, appears here.
- Audio in the browser, or any message to Max or the Arduinos.
- Termite form dimensions; its units are unverified.
- Changes to the show clock, OSC sends or serial.

## Anti-goals

These count as failure even if the code works:

- Presenting Max's random draws as known: sample picks, output channels, `decide` coin flips, the grain LFO phase, and the chord counter's history before this pass.
- Implying that the termite form grows live, or that the index drives a printer.
- Loading the 868 MB OBJ, or any multi-MB mesh, into the page.
- Testing against the user's running app or bridge (5174/8080/8081). No connections, restarts or OSC.

## Sources

Read for this design:

- `dev/audio/SimulacraNaturae_4ch_realtime.maxpat` (saved 2026-06-10); main patch.
- `SimulacraNaturaeSerialComsCurrents.maxpat` (2026-06-10); arm serial and arpeggio.
- `solenoidSerialCommunication.maxpat` (2026-06-11).
- `neuralGuitarB.maxpat`, `neuralGuitarC.maxpat`, `termiteKick.maxpat`.
- `tentacleRevision/tentacleRevision.ino` (2026-06-12).
- Data WAVs: `activitylevel.wav`, `burstflags.wav`. Each is 1 kHz, 16-bit mono, 180 000 samples, one per index.
- `dev/termites/Final_Scaled_Artifact.obj`. A Blender 5.2 export: 4 objects, 4.6 M vertices, 9.3 M triangles, 868 MB.
- SIGGRAPH 2026 paper, §Biome III and its termite figure (point cloud → mesh).
- `2026_SIGGRAPH/Simulacra-Naturae_entangled-biomes.mp4` (fabrication section at about 58–90 s) and `images/mainFigure.pdf`.

**Checked and ruled out:** deriving the WAVs from `spikes.csv`.

- `activitylevel` correlates 0.996 with a centred 50 ms spike count, but is not identical to it.
- `stepBurst` finds 92 burst ends against the WAV's 46 flags.
- So the WAVs are the authority.

---

## Part A — SOUND

### What the patch does (the facts the view states)

**Input.** `udpreceive 1234 → route /index → s dataframeIndex → peek~` on two buffers:

- `v = activitylevel.wav[index]`. This is 0…0.99997, and 0 for 22 % of the recording.
- `a = v / 0.966766`. Max's `scale` doesn't clip, so a ≤ 1.0344. Above 1 for 21 samples.
- `flag = burstflags.wav[index] > 0`. 46 single-sample flags, the first at index 2947.

**Hold rule.** Every table below is a `select 1 2 …` whose reject outlet is unwired. A bin outside the table therefore changes nothing: the previous interval holds. It is not clamped.

| Voice | Rule (exact unless marked) |
|---|---|
| **Chords** | **Counter:** `counter 17` counts 0…17. At load it is set to 1 and outputs it: `[msg 1]` goes to the right-middle inlet, "set and output immediately". Each flag bangs it to the next count. **`coll chords`:** keys 1–17 → A B A B C D C D E F E F G H I J K. Count 0 has no key, so K holds. Step after N flags = (1 + N) mod 18; chord = step 0 ? K : step. **`coll notes`:** gives each step's 5 notes (semitones from C), in the table below. |
| **Tones** | **Interval:** k = trunc(12 − 11√a) → [50, 100, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200, 4800][k−1] ms. **Per tick:** a random sample 1–5 of the current chord goes to `poly~ neuralGuitarB 256`. |
| **Grains** | **Tick:** k = trunc(1 + 5·a^⅛) → [6.25, 12.5, 25, 50, 100, 200][k−1] ms. Quiet means fast: 160 ticks/s at a = 0. **Length:** k = trunc(1 + 5·a^¼) → the same bins, then a coin flip keeps the bin or doubles it (max 400). **Playback:** the grain plays the sample's first 400 ms over its length, so speed = 400 / length (×1…×64). **Chance per tick:** (1 − L) · (100 − ⌈10 + 80√a⌉) / 100. L is a 0.007984 Hz LFO (≈125 s) whose phase is unknown. **Envelope:** a triangle peaking at √a of the grain. Voice: `poly~ neuralGuitarC 128`. |
| **Kick** | **Interval:** k = trunc(7 − 6a) → [1200, 1600, 2400, 3200, 6400, 9600][k−1] ms. a = 0 gives k = 7, which holds. Outlet 4 also wires 4800, but Max sends right-to-left by box position, so 3200 lands last. **Per tick:** 50 % chance of a kick; then up to 3 echoes at +1200 ms, each 50 %. That is 0.9375 kicks per tick expected. **Sound:** a sine at C1 32.70 Hz or D♭1 34.65 Hz (random), 5 ms attack, 6 s decay. |
| **Drones** | 6 voices. Each voice: 1. plays a random chord sample into `fzero~` (not to the speakers); 2. 1 s later a sine takes the detected pitch; 3. envelope (line²) rises over T, falls over T, rests for T, with T random in 5–10 s; ×0.1. |
| **Arpeggio** (serial patch) | **Input:** the arm Arduino prints `sensordata: <id>,<cm>` (HC-SR04-style echo, 0–100 cm, 100 when nothing is in range) at 115200 baud. Only id 1 drives the arpeggio; id 2 is displayed in Max; id 3 isn't read. **Interval:** 15 + 1000·(d/100)² ms: 1015 ms with nobody near, 265 ms at 50 cm, 25 ms at 10 cm. int(d) = 0 stops it. **Notes:** steps up through the current 5 notes (`r currentNotes`), each at MIDI 48, 60 or 72 (random) + note. A sine with 5 ms attack, decaying over the interval, through a reverb. |
| **Output** | **Positions:** tones, grains and drones each pick `random 17 → gate~ 16`, which is out1–16; position 0 (1 in 17) is silent. out1–8 go through `mc.pack~ 9 → mc.stereo~` at pans 0, 1/7 … 1 to speakers 3–4. out9–16 do the same to speakers 5–6. **Kick:** out17 or out18 (random), at pan 0.5 of pair A or B. **Arpeggio:** speakers 1–2. |

`coll notes` (semitones from C), by step 1–17:

```
1 0 0 3 7 8    2 0 1 5 8 8    3 0 0 3 7 8    4 0 1 5 8 8    5 0 0 5 7 8    6 3 3 8 10 10
7 0 0 5 7 8    8 3 3 8 10 10  9 0 1 5 10 10  10 0 3 7 8 8   11 0 1 5 10 10 12 0 3 7 8 8
13 0 0 5 5 8   14 1 1 1 5 8   15 2 6 6 6 9   16 0 3 7 7 7   17 2 7 7 7 11
```

**Metros run on wall-clock time.** Max's metros are wall-clock; only the activity value moves with `/index`. While `/index` is still (paused, OFF phase), the metros keep running at the last values.

### Exact, ≈, LIVE

**Exact** (functions of `a` and the tables): v, a, flag, every interval and bin, the grain chance's activity factor, threshold T = 10 + 80√a, playback speed, and expected kicks per tick.

**≈**, labelled as such:

- **Chord, in the show.** Max's counter never resets between passes. Assume Max loaded right before pass 1: N = (pass − 1)·F + flags at or before the index, where F = flags in the show's [startIndex, endIndex]. The first-bang semantics carry a ±1 risk, also covered by "≈".
- **Chord, in local playback.** Unknown, so nothing is highlighted. Local playback sends one `/index` per animation frame, about 300 indices apart at the default speed, so Max misses almost every single-index flag. Caption: "the chord steps on burst flags Max receives; local playback skips most indices".
- **Held values in local playback.** Holds (kick at a = 0, tones at a > 1) show the full-sequence value, marked "(held)".
- **The grain LFO.** Drawn at its midpoint (L = 0.5) and captioned "125 s swell, phase unknown".
- **Individual events.** Samples, channels, coin flips and drone pitches are drawn here with a seeded random generator, at the patch's rates and odds; captioned "drawn like Max draws them".
- **Pitches.** The builder check found that each chord folder's 5 samples are ordered low to high, not in `coll notes` order. The multiset of pitch classes is the same, so a uniform draw over `coll notes` gives the same pitch-class odds. The score's rows are pitch classes, so no per-sample table is needed.
- **Drone pitch.** Taken as the chord note of the picked sample; `fzero~` measures it in Max.

**The arpeggio is drawn only from arm 1 telemetry.** With no arm on serial there is no arpeggio: the metro starts on the first non-zero distance and has no loadbang. The arms are being rebuilt. Without fresh `/routing/robot/1/proximity`, the arpeggio lane shows its rule and "waiting for arm 1 · no arm, no arpeggio", and draws no notes. The ROBOT card keeps its own labelled simulation; that is unchanged.

**OFF phase and paused playback.** The patch has no stop: it reads only `/index`, and the output's `r cueAudio` fade has no sender in the patches given. So the live state keeps the last activity value while the playhead is held or null. Events keep drawing, dimmed like the rest of OFF, with the caption "Max plays on at the last values".

**LIVE**, which overrides:

- the existing `/routing/sound/{tones,grains,kick}` (events/s);
- `/routing/sound/harmony`, read as the counter's step 0–17;
- the existing `/routing/robot/1/proximity` (cm) for the arpeggio.

### Data

Two optional files go in `data/`, symlinked to `dev/audio/` like the other data files:

| Key | File | Type |
|---|---|---|
| `activity` | `activitylevel.wav` | `audio/wav` |
| `bursts` | `burstflags.wav` | `audio/wav` |

- **Parser.** A WAV parser for 16-bit PCM mono: walk the RIFF chunks (odd sizes padded) and return samples / 32768. Anything else throws.
- **`PatchData`.** Built from the two WAVs:
  - `activity`;
  - sorted flag indices;
  - precomputed hold-aware tone and kick intervals per index. Two sweeps, so index 0 holds from the end of the recording.
- **Without the WAVs,** the card and detail fall back to today's ≈ view (population rate, VISAP mappings), with one added line: "link activitylevel.wav + burstflags.wav into data/ for the patch's own values". That gives no second rules path to maintain.

### Live state (per frame, in `advanceLive`)

New input fields: `patch: PatchData | null`, `pass: number`, and the show's `startIndex`/`endIndex`.

**Values at the playhead:**

- the exact values listed above;
- flags so far, and the index of the next flag;
- chord step, chord name and notes, plus where they come from: `computed` or `live`.

**Event simulation** runs in wall-clock time (dt from the caller's clock), with a seeded generator kept in state so tests are deterministic:

- tone ticks;
- grain ticks with the chance at L = 0.5;
- kick ticks with the echo chain, modelled as Max's three shared `delay 1200` objects (scheduling a pending one reschedules it);
- 6 drone voices (rise / fall / rest, T 5–10 s);
- arpeggio ticks from arm 1's distance, only while `/routing/robot/1/proximity` (cm) is fresh, clamped to 0–100.

**Buffering.** Events go into a capped ring with timestamps. The cap is 4096: 160 grains/s over a 10 s window fits.

### SOUND card (overview)

- **Glyph:**
  - the whole pass's activity curve, with the 46 flags as ticks and the playhead;
  - under it, the 17-step chord strip with the current step lit;
  - at its right, the current chord letter, large, with its 5 notes as note names.
- **Text** (3 lines):
  - `Max reads activity + burst flags at /index`;
  - `chord E · tones 0.4/s · grains 31/s · kick 1/9.6 s`;
  - the status badge: `PATCH RULES · chord ≈`, `LIVE` when telemetry is fresh, or today's badge in the fallback.
- **Loop line:** the robot→Max loop on the overview gets the tag "arm 1 → arpeggio".

### SOUND detail

In landscape the story area splits in four. In portrait the same four panels stack.

1. **Score** (left, top). The last 10 s of wall-clock time, scrolling right to left. It is a 12-row pitch-class staff (C at the bottom):
   - tone events as dots at the note's row;
   - arpeggio events as small dots, shaded by octave;
   - drone voices as swelling bars at their row;
   - grains as sparkles in a band above the staff, their height set by playback speed;
   - kicks as pulses on a band below it;
   - the current chord's notes highlighted on the staff.
2. **Rules** (left, bottom). Three small step charts, each with the current value marked and its number printed:
   - tone interval against √a (12 steps);
   - grain tick against a^⅛, with the chance against √a under it;
   - kick interval against a (6 steps, with "hold" at 0).
3. **Harmony** (right, top):
   - the 17 steps as a strip (A B A B C D C D E F E F G H I J K), the current one lit;
   - the notes, as names;
   - "flag 12 / 46 · next at index 044905 (≈ 34 s)";
   - "chord ≈ · if Max loaded before pass 1", or LIVE.
4. **Output** (right, bottom):
   - speaker pairs 3–4 and 5–6, each with its 8 positions as a row of cells;
   - each event lights its cell and fades;
   - kicks light the pair's centre;
   - the arpeggio pair 1–2 is drawn apart, with arm 1's distance and the interval when LIVE, else "waiting for arm 1";
   - a counter of "unrouted" events (position 0).

**Chain:** `/index` → `peek~ activity · flags` → `a = v / 0.9668` → `tones · grains · kick · drones` → `speakers 3–6 · arp 1–2`.

Captions name the source files:

- `SimulacraNaturae_4ch_realtime.maxpat`;
- `SimulacraNaturaeSerialComsCurrents.maxpat`;
- the attribution line from the parent spec.

### SOLENOIDS copy (small)

These are facts from `solenoidSerialCommunication.maxpat`, which change only the copy and the chain:

- `/index` → line index + 1 of `backboneSpikes.txt`;
- `<` + 27 digits + `>` at 9600 baud to a Daisy Seed;
- `<0…0>` 32 ms after the last line;
- the strikes stay computed from the 27 backbone columns, still "≈": the file isn't on this machine.

---

## Part B — FAB

### Facts

**From SIGGRAPH 2026 §Biome III:**

- **Agents:** the termite form comes from the same agents as Biome I. That is 131, one per neuron, seeded at neuron positions; a spike makes its agent deposit.
- **Pipeline:** across a 100 × 100 × 100 voxel lattice → the deposits exported as a point cloud → Poisson surface reconstruction → a watertight mesh → edited to sit with the ceramic vessel → 4 print segments in PLA.
- **Laser-cut parts** frame the construction.

**From the OBJ.** The 4 objects, bottom to top in Y:

| Segment | Object | Y |
|---|---|---|
| 1 | `Cylinder_Org_P_Solid_02.stl_B` | −98.6 … 92.3 |
| 2 | `…Solid_02.stl_A` | 92.5 … 176.6 |
| 3 | `…New.stl_B` | 175.5 … 310.6 |
| 4 | `…New.stl_A` | 310.8 … 472.8 |

The footprint is about 190 × 189. Units aren't stated, so the view shows proportions, never millimetres.

**From the documentation and the parent spec:**

- **Frame (parent spec, approved):** the laser-cut parametric frame holds the vessel, the termite form and the two LED matrices. Fibres carry the matrices' light into the glassware with the hydroponic plants.
- **SIGGRAPH video at about 79–91 s:**
  - the white PLA print, made on a Bambu Lab printer;
  - a ruffled clay vessel planted with live plants in moss;
  - the rod frame holding flasks, plants and cables, with a white object at its base;
  - an inset of the white PLA form nested against a ruffled clay piece.
- **SIGGRAPH paper:** the mesh was "refined … to integrate compositionally with the ceramic vessel".
- **The paper's `mainFigure`:** a lit convoluted column inside a rod frame, with glowing strands. Lighting and staging change from show to show.
- **Unknown:** which clay piece this G-code is; how the two objects pair in this show; their relative scale.

So the view draws each object true to its own geometry. The arrangement appears only as a labelled schematic, never as a staged scene.

### Asset

`scripts/termite-form.mjs <obj> [out=data/termite_slices.bin] [step=2] [tolerance=0.25]` makes the page's asset: horizontal slice contours, the way a slicer sees the form and the way the documentation draws it (stacked white contours).

**Why slices, not points.** Two throwaway prototypes rendered sampled surface points:

- **Whole surface:** reads as noise, because most of the form's area is inner convolution and it shows through.
- **Outer shell only, depth-tested:** better, but still speckled at detail size and noise at card size.

Slices read at every size, cost little to draw, and match the documentation footage.

**Reading:** it reads vertices and faces, holding about 170 MB of typed arrays; the OBJ takes about 6 s.

**Slicing.** Each object (= print segment) is sliced on one global grid of heights:

- **Heights:** yMin + (s + ½)·step over the whole form, so the segments' slices line up.
- **Contours:**
  1. Each triangle crossing a height gives one segment between its two crossed edges.
  2. Segments are chained into polylines through shared edges (the key is the sorted vertex pair).
  3. Each polyline is simplified with Ramer–Douglas–Peucker at the tolerance.
- **Segment order:** numbered bottom to top by minimum Y.
- **Size:** at step 4 and tolerance 0.4, the prototype gave 142 slices, 18 841 polylines and 940 k raw points, simplified to 41 k points (0.16 MB). At step 2 and tolerance 0.25, expect about 3× that.

**Output:** writes `TSL1`, little-endian:

- magic `TSL1`, uint32 segmentCount, float32 step, 6 × float32 bounds (x, y, z min/max);
- per segment: float32 yMin, float32 yMax, uint32 sliceCount;
- per slice: float32 y, uint32 lineCount;
- per line: uint32 n, then n × (int16 x, int16 z), quantized over the x and z bounds.

**Location:** the pure parts live in `src/show/routing/` and are Node-tested: triangle–plane crossing, chaining, RDP, and the `TSL1` encode/parse. The script only reads the file and wires them together, the same pattern the bridge uses with `ledFrame.ts`.

**Serving:** `data/termite_slices.bin`, key `termite`, optional, gitignored.

### Rendering (Canvas 2D, no new dependencies)

**One slice renderer for both objects.** Input is a stack of `{ y, lines: Float32Array[] (x, z pairs) }`.

- **Sources:** the termite form's slices come from `TSL1`. The vessel's G-code layers are already this shape: one loop per layer at z = layer × layerMm, centred.
- **Projection:** orthographic, with yaw about the vertical axis and about 14° of elevation. One turn per 48 s.
- **Strokes:** one stroke per polyline, its alpha set by the polyline's mean depth (front brighter), on a dark ground.
- **Thinning:** a stride over slices keeps about 3–5 px between slices in the box, so a card draws fewer slices than the detail.
- **Render rate:** into an offscreen canvas at most 10 times a second (yaw moves 0.75° per render), with `drawImage` from the cache in between.
- **Tests:** the projection and the stride and alpha choice are pure and Node-tested; the strokes aren't.

**Termite form, turning.** The slices in lavender-white, assembled, turning.

**As installed: a schematic, not to scale.** It draws what the parent spec states, and nothing more:

- a thin-line rectangle for the laser-cut frame;
- inside it, small glyphs for the vessel and the termite form, side by side and labelled;
- the two LED matrices;
- fibres running from the matrices to flask outlines with plants.

The fibres' glow follows the live share of lit LED cells (the LED card's frame); the pixel-to-fibre mapping is unknown. The caption reads "schematic · not to scale".

**Termite form, segments.** The slices, exploded vertically with gaps between the 4 segments, labelled 1–4. A highlighted slice sweeps up through each segment in turn, with a top-view inset of that slice's contour: "PLA print · segment 2 · slice 31 / 68". This is a print preview, not tied to `/index`.

**Vessel.**

- **Layers up to the current (≈ index):** clay-coloured, the current layer white.
- **Later layers:** faint.
- **Above `printedMm`, when set:** dotted.

### FAB card (overview)

- **Glyph, left:** the termite form, turning.
- **Glyph, right:** the vessel spiral growing ≈ with the index.
- **Text:**
  - `termite form · PLA · 4 segments · made before the show`;
  - `vessel · clay · layer 123 / 283 ≈`.
- **Missing files:** with one file missing, that object is replaced by a one-line "link … into data/" note. With both missing, today's note shows.

### FAB detail

- **Left, about 55 %:** the termite form, large.
  - **Views:** "turning" and "4 print segments", cross-fading every 12 s.
  - **Inset:** the "as installed" schematic sits small in a corner.
  - **Caption:** the pipeline line "131 termite agents · 100³ lattice → point cloud → Poisson surface → 4 PLA segments (SIGGRAPH 2026)".
- **Right, about 45 %:** the vessel spiral, large, growing ≈ with the index, with today's info lines (layer, z, file, clay, printer) plus this line: "each neuron's firing locally speeds the contour's growth; sampled layers stack into one spiral".
- **Chain:**
  1. `organoid · 180 s`
  2. `termites · growth`
  3. `100³ lattice · contour`
  4. `4 PLA segments · 283-layer spiral`
  5. `frame · installed`

---

## Testing

All tests are `node --test` with explicit `.ts` imports, and every new module is pure.

**WAV parser:**

- built-in-test WAVs: mono 16-bit;
- an odd-sized chunk before `data` (padding);
- rejects 8-bit, stereo, or no `data` chunk.

**Patch rules:**

- tone, grain and kick bins at the boundaries: a = 0, 1/6, 0.5, 1, 1.03;
- holds: a = 0 for the kick, a > 1 for tones;
- kick bin 4 = 3200;
- grain chance at (a = 0, L = 0) = 0.9 and at (a = 1, L = 0) = 0.10;
- speed 400 / len;
- 0.9375 kicks per tick;
- chord step for N = 0, 1, 16, 17, 18;
- notes per step;
- arpeggio interval at d = 100, 50, 10, and stopped at 0.

**`PatchData`:**

- flag extraction;
- flags at or before an index (binary search);
- hold-aware interval arrays, including the wrap;
- chord at (pass, index) with a show range.

**Events:**

- tone ticks land exactly on the interval cadence;
- grain counts match the chance within tolerance over a long seeded run;
- the kick echo chain never exceeds 3 echoes, and a pending delay reschedules;
- drone envelopes stay within [0, 1];
- the ring cap holds.

**Live:**

- patch values replace the fallback when `patch` is set;
- a fresh `harmony` telemetry gives a LIVE chord;
- in local playback, without telemetry, the chord is unknown;
- arm 1 telemetry in cm drives the arpeggio, and without it no arpeggio events appear;
- a held or null playhead keeps the last activity, and events continue.

**`TSL1`:**

- encode → parse round trip within the quantization error;
- bad magic, truncation and zero segments throw.

**Slicer** (tiny meshes):

- a tetrahedron cut through its middle gives one closed triangle contour;
- a triangle touching the plane only at a vertex gives no segment;
- two triangles sharing an edge chain into one polyline;
- RDP keeps a square's corners and drops collinear points;
- segments are numbered bottom to top;
- the slice heights are shared across segments.

**Projection:**

- a point on the axis lands at the box centre;
- a 90° yaw maps +x to the depth axis;
- the front polyline gets the higher alpha;
- the stride keeps slice spacing at 3 px or more.

**Data files:**

- `DATA_FILES` / `dataStatus` include the 3 new keys;
- `scripts/show-smoke.mjs`'s `/data/status` expectation is updated.

## Verification without the user's app

The page under test must never connect to `127.0.0.1:8080/8081`. Visual checks use a standalone harness page in the scratchpad:

- **Server:** served by a separate Vite instance on a free port, `--strictPort`.
- **Imports:** only the pure modules and the drawing functions; no WebSocket code.
- **Data:** the real data files.
- **Checks:** screenshots at 1920×1080 and 1080×1920, and 0 console errors.

## Calls I made (for the user to check)

1. **FAB drawing.**
   - Both objects are drawn as slice stacks, as in the documentation, after two point-render prototypes read as noise.
   - Each object is drawn true to its own geometry.
   - The arrangement appears only as a schematic, not to scale, following the parent spec's frame description.
   - Left out: show-specific lighting, strands and moss, and a "deposits accumulate over the pass" illustration, whose spatial order would be invented.
2. **Grain LFO.** Drawn at its midpoint, rather than with an invented phase.
3. **Chord.**
   - **In the show:** it assumes Max loaded before pass 1; LIVE `harmony` corrects it.
   - **In local playback:** unknown, because Max misses the single-index flags there.
4. **Events.** They are simulated at the patch's odds for the score and the speakers, labelled as drawn here.
5. **Arpeggio.** Drawn only from live arm 1 telemetry. No arm means no arpeggio, and the arms are being rebuilt.
6. **OFF phase.** Max plays on at the last values (the patch has no stop); the view shows that, dimmed.
7. **WAVs.** They ship as optional `data/` symlinks (the formula check failed), with today's view as the fallback.
8. **Branch and PR.** New branch `routing-sound-fab`; its PR targets `routing-view`, so PR #1 stays as accepted.

## Unresolved questions

- Termite OBJ units?
- Were all 4 segments printed, numbered bottom to top?
- Which clay piece is `single-object-436666.gcode`? How does it pair with the termite form in this show?
- Is arm 1 on serial, with `SimulacraNaturaeSerialComsCurrents.maxpat` open, in this show?
- Does anything fade the sound in OFF? `r cueAudio` has no sender in the patches given.
- Is `backboneSpikes.txt` the 27 backbone columns of `spikes.csv`?
- Should Max send `/routing/sound/harmony` (counter 0–17) to make the chord exact?
