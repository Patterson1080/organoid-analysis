import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import readline from 'node:readline';
import Papa from 'papaparse';
import { neuronsFromRows } from '../src/utils/neuronRows.ts';

// The show dataset as the OSC bridge needs it for the LED matrices, read from the same
// CSVs the page loads: neuron positions, and which neurons fire in each millisecond.

// Same column limit as the page's matrix parser (src/utils/dataProcessing.ts).
const MATRIX_COLUMNS = 131;

export async function loadNeurons(file) {
    const { data, meta } = Papa.parse(await readFile(file, 'utf8'), { header: true, dynamicTyping: true, skipEmptyLines: true });
    return neuronsFromRows(meta.fields || [], data);
}

// Spike matrix CSV (header row, then one row per ms, 1 = that neuron fired) → the neuron
// ids firing in frame f are ids[offsets[f] .. offsets[f + 1]). Streams the file line by
// line: the real matrix is ~600 MB.
export async function loadSpikeFrames(file) {
    const offsets = [0];
    const ids = [];
    let header = true;
    const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
        if (header) {
            header = false;
            continue;
        }
        if (line === '') continue;
        const cells = line.split(',', MATRIX_COLUMNS);
        for (let c = 0; c < cells.length; c++) {
            if (Number(cells[c]) === 1) ids.push(c + 1);
        }
        offsets.push(ids.length);
    }
    return { frameCount: offsets.length - 1, offsets: Int32Array.from(offsets), ids: Uint16Array.from(ids) };
}

// Neuron ids that fired in frames (after, upTo], clipped to the recording.
export function spikeIdsBetween({ frameCount, offsets, ids }, after, upTo) {
    const from = Math.max(0, Math.floor(after) + 1);
    const to = Math.min(frameCount - 1, Math.floor(upTo));
    if (to < from) return [];
    return Array.from(ids.subarray(offsets[from], offsets[to + 1]));
}
