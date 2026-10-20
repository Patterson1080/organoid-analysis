// What the routing view states about each medium, in one place to edit when a scene, the
// Max patch or a file changes. Numbers are the running system's (the 11.3 scene, the vessel
// G-code, the bridge); paper figures only where no file exists, labelled with their paper.

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
    scene: 'Scene_BraveNewWork',
    port: 1234,
    fps: 60,
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

/** The patch isn't on this machine: the description is SIGGRAPH 2026's, the ranges VISAP 2025's. */
export const SOUND_FACTS = {
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
export const LED_FACTS = { trail: 5, burstOver: 5, perFrameCap: 10, baud: 115200, idleMs: 500 };

export const ROBOT_FACTS = {
    arms: 3,
    sensor: 'HC-SR04',
    servo: 'MG995',
    range: [0, 180] as [number, number],
    badge: 'SIMULATED · sensors go to the audio computer',
    dormant: '/inject/arm1..3 · off in this show',
};

/** The G-code's own header supplies layers, layer height, nozzle and size; these fill the rest. */
export const VESSEL_FACTS = {
    file: 'single-object-436666.gcode',
    printer: 'Potterbot 10 Super',
    clay: 'B-mix stoneware',
    source: 'SIGGRAPH 2026',
    printedMm: null as number | null, // set when the print stopped below the G-code's height
};
