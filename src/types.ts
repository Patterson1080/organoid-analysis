// Type definitions for brain organoid data

export interface Neuron {
    neuron_id: number;
    x: number;
    y: number;
    is_backbone: boolean;
}

export interface SpikeEvent {
    timestamp_ms: number;
    neuron_id: number;
}

export interface NeuronData {
    neurons: Neuron[];
}

export interface SpikeData {
    spikes: SpikeEvent[];
    samplingRate: number; // 20000 Hz
}

export interface FiringRateData {
    neuron_id: number;
    rate: number; // Hz
    spike_count: number;
}

export interface ActivityBin {
    time_start: number;
    time_end: number;
    spike_count: number;
}
