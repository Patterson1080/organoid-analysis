# Brain Organoid Analysis

A real-time neural activity visualization system for brain organoid multi-electrode array (MEA) recordings. Designed for high-resolution LED projection displays and scientific archival output. Inspired by the aesthetic sensibilities of Ryoji Ikeda and Refik Anadol.

## Getting Started

### Prerequisites

- Node.js 22.18 or newer (the bridge and the tests load TypeScript modules with Node's built-in type stripping)
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev          # Vite dev server only
npm start            # Dev server + OSC bridge (for live MEA data)
npm run electron:dev # Desktop app with Electron
npm test             # unit tests (show schedule/runner, playhead math)
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
npm run build
npm run electron:build  # Windows desktop build
```

---

## Data Format

### Neuron Location CSV

```csv
neuron_id,x,y,is_backbone
1,0.5,0.3,true
2,0.7,0.8,false
```

| Field | Description |
|---|---|
| `neuron_id` | Unique identifier for the neuron |
| `x` | X position (0–1 range recommended) |
| `y` | Y position (0–1 range recommended) |
| `is_backbone` | Boolean — backbone neurons are highlighted in the spatial map |

### Spike Activity CSV

```csv
timestamp_ms,neuron_id
1.5,3
2.3,10
```

| Field | Description |
|---|---|
| `timestamp_ms` | Time of spike in milliseconds |
| `neuron_id` | ID of neuron that fired |

Sample rate: 20 kHz

---

## Components

### Organoid Map (3D)
Interactive Three.js scatter plot of neuron positions. Neurons light up in real-time as spikes are detected. Supports OBJ export for use in external 3D tools.

### Spike Analysis
Raster plots, firing rate distributions, and per-neuron activity breakdowns. Includes spatial, spectral, and temporal heatmaps for identifying active regions over time.

### PCA Trajectory
Principal component analysis of population activity projected into 3D space, showing how the organoid's collective state evolves over time.

### Real-Time Graph
A horizontal timeline visualization that shows spike activity as vertical bars, with automatic burst detection that triggers strobe/focus modes to highlight synchronous firing events. Supports ultra-high-resolution export (15360×2160) as individual frames or ZIP sequences for video compositing.

### Hypergraphs
3D hypergraph visualization of neuron connectivity patterns, rendered with force-directed layout.

---

## Circular Event Topology

A radial network diagram optimized for circular LED projection displays. Renders on a `<canvas>` element with multi-pass compositing. Activated via the **CIRCULAR TOPOLOGY** button in the sidebar.

### What It Shows

Neurons are arranged around the circle's perimeter, indexed by their `neuron_id`. The visualization has three layers of information:

**1. Radial Activity Histogram**
Bars protrude outward from the circle's edge. Each bar represents one neuron; bar length is proportional to cumulative spike count relative to the most active neuron. Color encodes instantaneous activity intensity using a vivid gradient:

- **Electric blue** — low activity / low correlation
- **Magenta** — medium activity
- **Bright red** — high activity / burst peak

This palette (inspired by Marian Bantjes's vein drawings) makes firing intensity immediately readable on high-brightness LED walls.

**2. Dynamic Neural Links**
Curved connections drawn between neurons that fire within the same time window. Each connection fades over 1200 ms, so the web of links reflects recent co-activation patterns. Curves are cubic Béziers routed through the neurons' physical x,y positions in the inner spatial map, so the chord geometry reflects actual organoid topology rather than arbitrary bundling.

**3. Inner Spatial Map (Backbone Neurons)**
The 27 backbone neurons are plotted in their actual x,y MEA coordinates inside the inner circle. Dashed lines connect each backbone node to its perimeter position, linking the topological view to the physical layout. Non-backbone neurons are omitted to avoid clutter.

**4. Symmetric Chaos Mode (Field–Golubitsky)**
During large burst events (instantaneous firing rate > 3× baseline), the visualization enters a symmetry mode inspired by *Symmetry in Chaos* (Field & Golubitsky):

- **Burst detection** — a rolling 200 ms window is compared against a 2-second baseline
- **Symmetry order** — dihedral group D_n chosen by burst size: D3 (small), D5 (medium), D7 (large), D9 (massive). Live display caps at D5 for performance
- **Connection replication** — every neural link is replicated n times, each rotated by 2π/n, using pre-cached rotation matrices (no per-link trig)
- **Chaotic attractor overlay** — a Field–Golubitsky iterated map `f(z) = λz + αz̄^(n-1) + β|z|²z` is computed and rendered as a golden web; parameters are randomised per burst so each event produces a unique geometry
- **Symmetry breaking** — as the burst subsides, copies are progressively perturbed with sinusoidal offsets, dissolving perfect symmetry into near-symmetric remnants

**5. Rotating Zoom Window (Clock Index)**
A thin red annular-sector rotates clockwise around the perimeter, completing one revolution every 12 seconds. It acts as a clock index, framing the currently-sampled arc of neurons. A small red timestamp (`T:9970ms  F:299  L:54`) is arc-rendered beneath the inner curvature of the frame.

**6. Detached Kiosk Mode**
The graph can be popped out into a dedicated, borderless 1920x1920 floating window. In this mode, the HUD elements are hidden and the canvas scales mathematically so the inner neural ring perfectly borders the physical edge of the display, designed specifically for circular LED/LCD installations.

**7. Touch Scrubbing (DJ Jog Wheel)**
The circular graph acts as an interactive jog wheel. Tapping the empty center toggles play/pause without any UI buttons. Grabbing the outer rotating edge allows you to smoothly scrub back and forth through the data timeline, retaining synchronization with OSC outputs and audio synthesis.

### HUD Overlay

Text is rendered along the outer circle perimeter using per-character arc placement, so all labels follow the curve:

| Label | Meaning |
|---|---|
| `NEURAL_TOPOLOGY_V1.0` | Visualization format version (top arc, blue) |
| `DATA_TIME: 4523ms` | Current playback position in the recording |
| `NEURONS: 131` | Total neuron count in the loaded dataset |
| `LINKS: 847` | Number of currently visible connections (fading over 1200 ms) |
| `D5 SYMMETRY [87%]` | Active symmetry mode and ramp-up intensity |
| `BREAKING [42%]` | Symmetry dissolution progress during burst decay |
| `FIELD-GOLUBITSKY SYMMETRIC CHAOS · ORGANOID NEURAL TOPOLOGY` | Credits arc (bottom) |

### Performance Architecture

The renderer is optimized for real-time display of 1000+ neuron datasets:

- **Pre-computed geometry** — per-neuron angle, cos/sin, and inner-map coordinates are cached in a `useMemo` array, eliminating all per-frame trig for static geometry
- **Batched draw calls** — histogram, tick marks, links, and dots are accumulated into `Path2D` buckets (8 activity buckets for histogram, 4 for ticks, 6 for links) and stroked/filled in a small fixed number of GPU calls per frame instead of one per neuron
- **Adaptive frame cap** — 30 fps normally; drops to 20 fps during active symmetry/burst events to keep the main thread responsive
- **No `shadowBlur`** — all glow effects are layered with transparent strokes/fills, avoiding the canvas shadow pipeline which tanks GPU performance

### Export

- **Export Frame** — renders the current state at 2048×2048 as a single PNG
- **Export Sequence (ZIP)** — renders the full recording as a 30 fps PNG sequence at 2048×2048. Frame count is `targetDuration × 30` (e.g. 750 s → 22,500 frames). Uses the File System Access API for direct directory writes when available, with JSZip fallback. A pointer-walk over sorted spikes ensures O(n) accumulation — no per-frame filter scan

---

## Neural Regions

A second circular graph activated via the **NEURAL REGIONS** button. Uses the same rendering engine in `mode="regions"`, adding:

- **Region arcs** — neurons are divided into 7 equal arc-segments along the perimeter. Each segment is drawn as a thick colored arc whose hue follows the activity gradient (blue → magenta → red)
- **Radial tick rays** — a faint ray extends from each region boundary to the label radius
- **Arc-curved region labels** — `REGION_01 [37%]` labels are rendered with the same per-character arc placement used by the HUD, so they follow the circle rather than appearing as flat rotated text. Labels are centred on each region's angular midpoint
- **Same rotating clock-index** as the topology graph, with the timestamp arc inside the wedge

---

## Playback Controls

The transport panel uses a unified 4×2 button grid with no gap between rows:

| Row | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|
| 1 | `<` step | `> PLAY` | `[] STOP` | `>` step |
| 2 | `[ ] LOOP` | `[-] SOUND` | `< REVERSE` | `[ ] SPOUT` |

`[] STOP` (row 1, col 3) is directly above `< REVERSE` (row 2, col 3). Active state inverts the cell to white-on-black. The current timestamp `T: {ms} MS` appears below the grid, unboxed.

**Target Playback Duration** controls playback speed: the data window is stretched or compressed to fit the target duration. Setting 750 s produces a 0.24× slow-motion render of a 180 s dataset.

### Presentation View

`⛶ PRESENT` (top right) shows only the open visualizations, fullscreen when the browser allows it. The header, data loading, transport, settings and OSC panels, and each view's export/settings buttons are hidden; titles, HUDs, legends and stats stay. Wide views (show panel, real-time graph) come first at full width; the other views follow as tiles, 3 per row on a 1920 px screen and 4 on 2560 (`--pres-tile` in `src/index.css`): 3D maps, PCA, circular graphs, neural web, hypergraphs, and Activity Analysis split into separate Network Activity, Top 20 Neurons, Spike Raster and Heatmaps tiles. Hover a tile and click its corner control to make it span 1 column, 2 or the full row; charts, the raster and 3D scenes get wider, not taller. Each tile's span is remembered in that browser. The page scrolls when the views don't fit one screen. Space and ←/→ still drive playback.

Exit with the small icon at the bottom centre or by pressing **Esc twice**. In Chromium (and Electron) a single Esc doesn't leave fullscreen during the presentation (hold Esc to leave fullscreen only); in other browsers the first Esc leaves fullscreen and a second Esc within about a second ends the presentation.

---

## External Hardware Integration

### OSC Bridge
The application includes a WebSocket-to-OSC bridge (`server/osc-bridge.js`) for receiving live spike data from MEA recording systems, and streaming out current playback state/burst coordinates to external visualizers (e.g. TouchDesigner). Configure it from the **OSC Bridge** panel in the app; changes are pushed to the bridge live over the WebSocket connection, no restart needed unless you edit `osc-bridge.js` itself.

**Ports & destinations**
- **Input Port** — UDP port the bridge listens on for incoming OSC (default `3333`).
- **Output Port** — default UDP port used for outgoing OSC (`1234`, EoC-biomes' port).
- **Output IP(s)** — one or more destination IPs, comma-separated, to stream to multiple computers at once: `192.168.1.5, 192.168.1.6:3334`. Append `:port` to a specific IP to override the shared Output Port for just that destination.

Settings are saved in the browser and restored on reload.

**Output Messages** — toggle which values stream out, and rename their OSC address:

| Message | Default address | Sent as |
|---|---|---|
| Row index | `/index` | `/index <rowIndex>` (playback position, ms) |
| Firing neuron coords | `/x`, `/y` prefixes | `/x1 <x>`, `/y1 <y>`, `/x2 <x>`, `/y2 <y>`, … for up to 5 recently-fired neurons |
| Row echo | `/row` | `/row <value>` — echoes an incoming `/row <n>` message back out after driving playback to that row |

Untick a row to stop sending it; edit the address field to rename it (e.g. `/index` → `/timestamp`).

**Networking notes** — since the bridge sends raw UDP, both machines need to be reachable on the same network:
- Use the receiving machine's actual LAN IP (check with `ipconfig`/`ifconfig` on that machine), not `127.0.0.1`.
- Both machines must be on the same subnet (e.g. both `192.168.1.x`).
- The receiving machine's firewall must allow inbound UDP on the port you're sending to.
- Public/campus Wi-Fi (eduroam, guest networks) commonly enables client isolation, blocking device-to-device traffic even on the same SSID — use a private router, wired switch, or hotspot instead if OSC isn't arriving despite correct IP/firewall settings.
- A receiver on Wi-Fi (e.g. the audio Mac mini on the show router) works the same way — add its LAN IP:port to Output IP(s). Each `/index` carries the absolute frame, so an occasional dropped UDP packet over Wi-Fi is harmless; prefer wired for EoC, since `/sim_off` · `/sim_on` are single messages.

### Serial Hardware Bridge
A dedicated serial bridge (`server/serial-bridge.js`) connects the web application to physical microcontrollers (e.g., Arduino Uno R4). It transmits structural firing events and high-order burst flags encoded into a compact byte stream, allowing physical LED matrices or fiber optic sculptures to fire in real-time synchrony with the organoid recordings.

## Show Mode

Runs the EoC-biomes installation by itself: the **SHOW** panel (top of the views) starts a loop that the OSC bridge keeps time for, so a reloaded or backgrounded tab never stalls it.

| When | OSC out (to every Output IP) |
|---|---|
| Pass start | `/sim_resetSimsOnly 1`, then `/sim_on 5.0` (fade in) |
| During the pass (50 min) | `/index` 0 → 179999 at 60/s; `/sim_resetTermites` ×5 and `/sim_resetPhysarum` ×10, evenly spaced |
| Pass end | `/sim_off 5.0` (fade to black), then 2 min of silence |
| STOP SHOW (two clicks) | `/sim_off 5.0` |

- `/index` is data milliseconds = the EoC firing-blob frame. A pass is locked to the wall clock: exactly 50:00; a late tick sends the frames it skipped, so receivers see every index.
- Every message goes to every Output IP — e.g. `192.168.1.5:1234, 192.168.1.7:9000` sends the show to EoC and to the audio Mac mini.
- The Arduino LED matrices follow the show's playhead. With `data/` set up (below) the bridge drives them itself, so they keep going with the tab hidden, reloaded or closed (HUD `LED BRIDGE`); without it the open tab drives them (`LED TAB`). The SOUND clicks always come from the tab. The show sends no LED frames during OFF or before a pass's first spike (the recording is silent for its first 686 ms, ~11 s of show time); after 0.5 s without frames the `DualLED_Currents` sketch shows its bright white idle shimmer.
- Range, index rate, off time, fade and reset counts are editable while stopped.
- While the show runs, local playback, scrubbing and `/row` input are locked; the bridge is the only `/index` sender. The other views follow the show's playhead.
- HUD: `PASS 3 · ▶ ON · IDX 091204 / 179999 · OFF IN 24:47 · → 192.168.1.5:1234` — check the destination before starting.
- Restarting the bridge stops the show; press START SHOW again.
- Reloading the tab keeps the show running (the bridge owns it); the page reloads `data/` by itself and picks up the current playhead. Uploaded CSVs (no `data/`) are lost on reload and must be loaded again.
- The bridges only accept WebSocket connections from this machine's pages (loopback + Origin check).
- `node scripts/show-smoke.mjs` (with no bridges running) checks the whole loop end to end against a local OSC listener and a fake serial bridge.

**Show data (`data/`)** — point the app at the recording once, so neither the bridge nor a reloaded tab needs an upload:

```bash
mkdir -p data
ln -s ~/Developer/Graphics/TD_biomes/data/labels_positions.csv data/neurons.csv
ln -s ~/Developer/Fabrication/PDE_SimulacraNaturae/data/organoid/time_series_data.csv data/spikes.csv
```

The bridge reads both at startup (about a second for the 612 MB matrix) and serves them to the page (`http://127.0.0.1:8080/data/`, local pages only), which loads them on connect when nothing was uploaded. A manual upload still works for other datasets. `data/` is gitignored.

EoC needs the `/sim_off` · `/sim_on` handlers from its `show-sim-off` branch.

## Spout Output

Optional Spout texture sharing for feeding the visualization into TouchDesigner, Resolume, or other real-time video tools. Toggle with the `[ ] SPOUT` button.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| 3D Rendering | Three.js |
| 2D Rendering | Canvas 2D API + Path2D batching |
| Data Processing | D3.js, Recharts, PapaParse |
| Desktop | Electron |
| Live Data | OSC over WebSocket |
| Export | File System Access API + JSZip + file-saver |

---

## Design Philosophy

- **Ryoji Ikeda** — minimal interface, monochromatic palette, data as art, precision typography
- **Refik Anadol** — fluid data visualization, particle aesthetics, dynamic interactions
- **Field & Golubitsky** — symmetric chaos: mathematical beauty emerging from biological complexity
- **Marian Bantjes** — vein-like color gradients that encode intensity as organic warmth

---

## License

MIT
