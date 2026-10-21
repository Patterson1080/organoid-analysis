// What the routing view states about each medium, in one place to edit when a scene, the
// Max patch or a file changes. Numbers are the running system's (the 11.3 scene, the vessel
// G-code, the bridge); paper figures only where no file exists, labelled with their paper.

import { LED_TRAIL_LENGTH } from '../ledFrame.ts';

export type MediumKey = 'visual' | 'sound' | 'solenoids' | 'led' | 'robot' | 'fab';

/** The artist's order of the media; the tour and the rail follow it. */
export const MEDIA: MediumKey[] = ['visual', 'sound', 'solenoids', 'led', 'robot', 'fab'];
/** Fed by the bridge directly. */
export const BRIDGE_FED: MediumKey[] = ['visual', 'led', 'fab'];
/** Hang off the audio computer's Max patch. */
export const AUDIO_COMPUTER: MediumKey[] = ['sound', 'solenoids', 'robot'];

export const CARD_TITLES: Record<MediumKey, { title: string; sub: string }> = {
    visual: { title: 'VISUAL', sub: 'EoC-biomes · Unity' },
    sound: { title: 'SOUND', sub: 'Max/MSP patch · 4 ch' },
    solenoids: { title: 'SOLENOIDS', sub: '27 backbone strikers' },
    led: { title: 'LED', sub: 'serial → 2 × 16×16' },
    robot: { title: 'ROBOT', sub: '3 arms, hung upside down' },
    fab: { title: 'FABRICATION', sub: 'grown from this recording' },
};

/** Required on every visitor-facing screen (business/docs/works-technical-facts.md). */
export const ATTRIBUTION = 'pre-recorded · 180 s · Kosik Neurobiology Lab, UCSB';

export const BACKBONE_COUNT = 27;

/** Scene_BraveNewWork.unity and its 11.3 *Params.asset files. */
export const VISUAL_FACTS = {
    port: 1234,
    blob: 'organoid_firing.f16',
    threshold: 0.1,
    fadeS: 0.5,
    swarms: {
        physarum: { label: 'PHYSARUM', agents: '1,000,000', types: 8, speedMul: 2, deposit: '0.7 (types 0–3) / 1.0 (4–7)' },
        boids: { label: 'BOIDS', agents: '20,000', types: 4, speedMul: 1.5, deposit: '0.5' },
        termites: { label: 'TERMITES', agents: '131', types: 1, speedMul: 2, deposit: 'trail → 4 (white)' },
    },
    drawnNote: 'drawn here: 1 in ~400 physarum, 1 in ~30 boids, every termite',
};

/** What happens to Unity's output after EoC; it changes from show to show. */
export type VisualOutput = 'unity' | 'td' | 'td-sd';
export const VISUAL_OUTPUT_CHAINS: Record<VisualOutput, string[]> = {
    unity: ['Unity', 'projection'],
    td: ['Unity', 'Spout/Syphon/NDI', 'TD projection mapping', 'projection'],
    'td-sd': ['Unity', 'Spout/Syphon/NDI', 'TD projection mapping', '+ StreamDiffusion (TD)', 'projection'],
};

/** The papers' description (SIGGRAPH 2026) and ranges (VISAP 2025), for when the patch's data
 *  files aren't linked into data/; with them the view follows maxPatch.ts and these files. */
export const SOUND_FACTS = {
    patchFile: 'SimulacraNaturae_4ch_realtime.maxpat',
    serialFile: 'SimulacraNaturaeSerialComsCurrents.maxpat',
    descriptionSource: 'SIGGRAPH 2026',
    rangesSource: 'VISAP 2025',
    tone: [0.21, 20.0] as [number, number],
    grains: [5.0, 160.0] as [number, number],
    grainMs: [6.25, 400] as [number, number],
    kick: [0.1, 0.83] as [number, number],
    kickPitch: 'C or D♭',
    harmony: 'C minor · Phrygian',
    channels: 4,
    badge: '≈ computed from spikes · the patch is the authority',
};

/** src/show/ledFrame.ts and server/serial-bridge.js. */
export const LED_FACTS = { trail: LED_TRAIL_LENGTH, burstOver: 5, perFrameCap: 10, baud: 115200, idleMs: 500 };

/** solenoidSerialCommunication.maxpat: /index → line index + 1 of the file → `<27 digits>` to the
 *  board; all zeros 32 ms after the last line. The file isn't on this machine, so strikes stay ≈. */
export const SOLENOID_FACTS = { file: 'backboneSpikes.txt', board: 'Daisy Seed', baud: 9600, releaseMs: 32 };

/** The arms in this show: dev/arms/ProximityServoArms_Currents.ino on one board, read by Max over
 *  serial; the modular rebuild (dev/arms/modular) mirrors arms 1–3 to the bridge as /routing/robot/…. */
export const ROBOT_FACTS = {
    arms: 3,
    sketch: 'ProximityServoArms_Currents.ino',
    rebuild: 'Haptophylla modular',
    badge: "SIMULATED · the firmware's rules, stand-in visitors",
    dormant: '/inject/arm1..3 · off in this show',
};

/** SIGGRAPH 2026 §Biome III: the termite form, from the same agents as Biome I. */
export const FAB_FACTS = {
    termite: { material: 'PLA', lattice: '100³', source: 'SIGGRAPH 2026', heightMm: 700 }, // ≈ 70 cm as built (the team)
    pipeline: '131 agents · 100³ lattice → point cloud → Poisson surface → 4 PLA segments',
};

/** The G-code's own header supplies layers, layer height, nozzle and size; these fill the rest. */
export const VESSEL_FACTS = {
    file: 'single-object-436666.gcode',
    printer: 'Potterbot 10 Super',
    clay: 'B-mix stoneware',
    source: 'SIGGRAPH 2026',
    printedMm: null as number | null, // set when the print stopped below the G-code's height
};
