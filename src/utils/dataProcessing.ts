import Papa from 'papaparse';
import { Neuron, SpikeEvent, FiringRateData, ActivityBin } from '../types';

export const SAMPLING_RATE = 1000; // 1kHz (1 row = 1ms)

/**
 * Helper to find a column name from a list of possible names
 */
const findColumn = (headers: string[], possibleNames: string[]): string | undefined => {
    const lowerHeaders = headers.map(h => h.toLowerCase().trim());
    for (const name of possibleNames) {
        const index = lowerHeaders.indexOf(name.toLowerCase());
        if (index !== -1) return headers[index];
    }
    return undefined;
};

/**
 * Parse neuron location CSV file
 */
export const parseNeuronCSV = (file: File): Promise<Neuron[]> => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const headers = results.meta.fields || [];
                    let idCol = findColumn(headers, ['neuron_id', 'id', 'neuron', 'label', 'unit_id']);
                    let xCol = findColumn(headers, ['x', 'x_pos', 'x_coord', 'x_location', 'pos_x', 'xy_norm_0']);
                    let yCol = findColumn(headers, ['y', 'y_pos', 'y_coord', 'y_location', 'pos_y', 'xy_norm_1']);
                    let backboneCol = findColumn(headers, ['is_backbone', 'backbone', 'type', 'is_anchor']);

                    let neurons: Neuron[] = [];

                    if (xCol && yCol) {
                        neurons = results.data
                            .map((row: any, index: number) => {
                                let id = index + 1;
                                let isBackbone = false;

                                if (idCol && row[idCol] != null) {
                                    const val = Number(row[idCol]);
                                    if (val === 0 || val === 1) {
                                        isBackbone = val === 1;
                                    } else {
                                        id = val;
                                        if (backboneCol) {
                                            isBackbone = (row[backboneCol] === true || row[backboneCol] === 'true' || row[backboneCol] === 1);
                                        }
                                    }
                                } else if (backboneCol) {
                                    isBackbone = (row[backboneCol] === true || row[backboneCol] === 'true' || row[backboneCol] === 1);
                                }

                                if (row[xCol!] == null || row[yCol!] == null) return null;

                                return {
                                    neuron_id: id,
                                    x: Number(row[xCol!]),
                                    y: Number(row[yCol!]),
                                    is_backbone: isBackbone,
                                };
                            })
                            .filter(n => n !== null) as Neuron[];
                    }

                    resolve(neurons);
                } catch (error) {
                    reject(error);
                }
            },
            error: (error) => reject(error),
        });
    });
};

/**
 * Parse spike activity CSV file - MATRIX FORMAT
 * Format: Columns = neurons (t_spk_mat_0, t_spk_mat_1, ...)
 *         Rows = time (1 row = 1ms)
 *         Values = 0 or 1 (binary activity)
 */
export const parseSpikeCSV = (file: File): Promise<SpikeEvent[]> => {
    return new Promise((resolve, reject) => {
        const spikes: SpikeEvent[] = [];
        let rowIndex = 0;
        const MATRIX_COL_LIMIT = 131; // Only read first 131 columns

        console.log('Starting Matrix CSV parse...');

        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            worker: true,
            chunk: (results) => {
                const data = results.data as any[];

                data.forEach((row) => {
                    const currentTime = rowIndex;
                    const values = Object.values(row);

                    // Process only first 131 columns
                    for (let colIndex = 0; colIndex < Math.min(MATRIX_COL_LIMIT, values.length); colIndex++) {
                        if (Number(values[colIndex]) === 1) {
                            spikes.push({
                                timestamp_ms: currentTime,
                                neuron_id: colIndex + 1 // Neuron IDs are 1-based
                            });
                        }
                    }
                    rowIndex++;
                });
            },
            complete: () => {
                console.log(`Matrix parse complete. Rows: ${rowIndex}, Total spikes: ${spikes.length}`);
                spikes.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
                resolve(spikes);
            },
            error: (error) => {
                console.error('CSV Parse Error:', error);
                reject(error);
            }
        });
    });
};

/**
 * Calculate firing rates for neurons
 */
export const calculateFiringRates = (spikes: SpikeEvent[]): FiringRateData[] => {
    if (spikes.length === 0) return [];

    const neuronSpikeCounts = new Map<number, number>();
    let minTime = Infinity;
    let maxTime = -Infinity;

    spikes.forEach(spike => {
        if (spike.timestamp_ms < minTime) minTime = spike.timestamp_ms;
        if (spike.timestamp_ms > maxTime) maxTime = spike.timestamp_ms;
        const count = neuronSpikeCounts.get(spike.neuron_id) || 0;
        neuronSpikeCounts.set(spike.neuron_id, count + 1);
    });

    const durationSeconds = (maxTime - minTime) / 1000;

    const firingRates: FiringRateData[] = [];
    neuronSpikeCounts.forEach((spike_count, neuron_id) => {
        const rate = durationSeconds > 0 ? spike_count / durationSeconds : 0;
        firingRates.push({ neuron_id, rate, spike_count });
    });

    return firingRates.sort((a, b) => b.rate - a.rate);
};

/**
 * Bin spike activity over time for visualization
 */
export const binSpikeActivity = (spikes: SpikeEvent[], binSizeMs: number = 100, fixedDuration?: number): ActivityBin[] => {
    if (spikes.length === 0 && !fixedDuration) return [];

    let minTime = 0;
    let maxTime = 0;

    if (spikes.length > 0) {
        minTime = spikes[0].timestamp_ms;
        maxTime = spikes[0].timestamp_ms;
        for (let i = 1; i < spikes.length; i++) {
            if (spikes[i].timestamp_ms < minTime) minTime = spikes[i].timestamp_ms;
            if (spikes[i].timestamp_ms > maxTime) maxTime = spikes[i].timestamp_ms;
        }
    }

    // Override if fixed duration is provided
    if (fixedDuration !== undefined) {
        minTime = 0;
        maxTime = fixedDuration;
    }

    const bins: ActivityBin[] = [];
    let currentTime = minTime;

    // Ensure we cover the full range
    while (currentTime < maxTime) {
        const time_end = currentTime + binSizeMs;
        const spike_count = spikes.filter(
            s => s.timestamp_ms >= currentTime && s.timestamp_ms < time_end
        ).length;

        bins.push({
            time_start: currentTime,
            time_end,
            spike_count,
        });

        currentTime = time_end;
    }

    return bins;
};

/**
 * Get spike events for a specific neuron
 */
export const getNeuronSpikes = (spikes: SpikeEvent[], neuronId: number): SpikeEvent[] => {
    return spikes.filter(s => s.neuron_id === neuronId);
};

/**
 * Calculate network synchrony
 */
export const calculateNetworkSynchrony = (spikes: SpikeEvent[], binSizeMs: number = 50): number => {
    const bins = binSpikeActivity(spikes, binSizeMs);
    const counts = bins.map(b => b.spike_count);

    if (counts.length === 0) return 0;

    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / counts.length;

    return variance;
};
