// Type definitions for brain organoid data

export interface Neuron {
    neuron_id: number;
    x: number;
    y: number;
    is_backbone: boolean;
    xy_norm_0: number; // For hypergraph calculation
    xy_norm_1: number; // For hypergraph calculation
    z?: number; // Optional Z for 3D mapping
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

// Show mode — mirrors the bridge's SHOW_STATE (server/show-runner.js).
export interface ShowCue {
    address: string;
    frame: number;
}

export interface ShowConfig {
    startIndex: number;
    endIndex: number; // inclusive
    fps: number;
    offSeconds: number;
    fadeSeconds: number;
    indexAddress: string;
    passStartCue: string;
    onAddress: string;
    offAddress: string;
    spreadCues: { address: string; count: number }[];
}

export interface ShowState {
    running: boolean;
    pass: number;
    phase: 'on' | 'off' | 'stopped';
    index: number | null;
    phaseElapsedMs: number;
    phaseDurationMs: number;
    config: ShowConfig;
    cues: ShowCue[];
    timing: { passFrames: number; passMs: number; cycleMs: number };
    destinations: string[];
}
