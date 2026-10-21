import { existsSync } from 'node:fs';
import path from 'node:path';

// The show dataset in data/: the CSVs the page and the bridge read, plus two optional files
// the routing view draws from (EoC's firing blob and the vessel's G-code). All usually symlinks.
export const DATA_FILES = [
    { key: 'neurons', name: 'neurons.csv', type: 'text/csv' },
    { key: 'spikes', name: 'spikes.csv', type: 'text/csv' },
    { key: 'firing', name: 'organoid_firing.f16', type: 'application/octet-stream' },
    { key: 'vessel', name: 'vessel.gcode', type: 'text/plain' },
];

/** GET routes for the data files: '/data/<name>' → { path, type }. */
export function dataRoutes(dir) {
    return new Map(DATA_FILES.map(f => [`/data/${f.name}`, { path: path.join(dir, f.name), type: f.type }]));
}

/** Which data files exist, by key, in DATA_FILES order. */
export function dataStatus(dir, exists = existsSync) {
    return Object.fromEntries(DATA_FILES.map(f => [f.key, exists(path.join(dir, f.name))]));
}
