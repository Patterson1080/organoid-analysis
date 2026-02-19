import Papa from 'papaparse';
import { SpikeEvent } from '../types';

const SAMPLING_RATE = 20000; // 20kHz

// Helper to find a column name
const findColumn = (headers: string[], possibleNames: string[]): string | undefined => {
    const lowerHeaders = headers.map(h => h.toLowerCase().trim());
    for (const name of possibleNames) {
        const index = lowerHeaders.indexOf(name.toLowerCase());
        if (index !== -1) return headers[index];
    }
    return undefined;
};

self.onmessage = (e: MessageEvent) => {
    const file = e.data as File;
    const spikes: SpikeEvent[] = [];
    let isMatrix = false;
    let timeCol: string | undefined;
    let idCol: string | undefined;
    let headersChecked = false;
    let dt = 0;
    let globalRowIndex = 0;

    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        chunk: (results, parser) => {
            try {
                const headers = results.meta.fields || [];
                const data = results.data as any[];

                // 1. Determine Format (only on first chunk)
                if (!headersChecked) {
                    // Check for Matrix Format
                    isMatrix = headers.some(h => h.includes('t_spk_mat')) ||
                        (headers.length > 2 && headers.every(h => h.trim() === '' || h.includes('col') || h.includes('Var') || h.includes('t_spk_mat')));

                    if (isMatrix) {
                        dt = 1000 / SAMPLING_RATE;
                    } else {
                        // Check for Long Format
                        timeCol = findColumn(headers, ['timestamp_ms', 'timestamp', 'time', 't', 'time_ms', 'timepoint']);
                        idCol = findColumn(headers, ['neuron_id', 'neuron', 'id', 'unit', 'unit_id', 'label']);
                    }
                    headersChecked = true;
                }

                // 2. Process Chunk
                if (isMatrix) {
                    // Dense Matrix
                    data.forEach((row, rowIndex) => {
                        const currentTime = (globalRowIndex + rowIndex) * dt;
                        Object.values(row).forEach((val: any, colIndex: number) => {
                            if (Number(val) > 0) {
                                spikes.push({
                                    timestamp_ms: currentTime,
                                    neuron_id: colIndex + 1
                                });
                            }
                        });
                    });
                    globalRowIndex += data.length;
                } else {
                    // Long Format
                    if (timeCol && idCol) {
                        for (const row of data) {
                            if (row[timeCol] !== null && row[timeCol] !== undefined) {
                                spikes.push({
                                    timestamp_ms: Number(row[timeCol]),
                                    neuron_id: Number(row[idCol])
                                });
                            }
                        }
                    } else {
                        // Fallback Index-based
                        for (const row of data) {
                            const vals = Object.values(row);
                            if (vals.length >= 2 && vals[0] !== null) {
                                spikes.push({
                                    timestamp_ms: Number(vals[0]),
                                    neuron_id: Number(vals[1])
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Worker parsing error:', err);
                parser.abort();
                self.postMessage({ error: err });
            }
        },
        complete: () => {
            // Sort spikes by timestamp before returning
            // This offloads the expensive sort from the main thread
            spikes.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
            self.postMessage({ spikes });
        },
        error: (error) => {
            self.postMessage({ error });
        }
    });
};
