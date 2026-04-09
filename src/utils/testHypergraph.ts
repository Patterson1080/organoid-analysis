import { computeHyperedges } from './hypergraphUtils.js';

// Mock Data
const neurons = [
    { neuron_id: 1, x: 0, y: 0, z: 0, xy_norm_0: 0.1, xy_norm_1: 0.1, is_backbone: true },
    { neuron_id: 2, x: 0, y: 0, z: 0, xy_norm_0: 0.15, xy_norm_1: 0.12, is_backbone: false },
    { neuron_id: 3, x: 0, y: 0, z: 0, xy_norm_0: 0.12, xy_norm_1: 0.15, is_backbone: false },

    // far away group
    { neuron_id: 4, x: 0, y: 0, z: 0, xy_norm_0: 0.8, xy_norm_1: 0.8, is_backbone: false },
    { neuron_id: 5, x: 0, y: 0, z: 0, xy_norm_0: 0.82, xy_norm_1: 0.81, is_backbone: false }
];

const spikes = [
    { timestamp_ms: 10, neuron_id: 1, amplitude: 1 },
    { timestamp_ms: 12, neuron_id: 2, amplitude: 1 },
    { timestamp_ms: 15, neuron_id: 3, amplitude: 1 },
    { timestamp_ms: 18, neuron_id: 4, amplitude: 1 },
    { timestamp_ms: 19, neuron_id: 5, amplitude: 1 }
];

// Test clustering
console.log("=== Testing computeHyperedges ===");
const frame = computeHyperedges(spikes, neurons, 0, 20, 0.06, 2);

console.log(`Time Start: 0, Time End: 20`);
console.log(`Active Neurons:`, frame.activeNeurons);
console.log(`Number of Hyperedges found: ${frame.hyperedges.length}`);

frame.hyperedges.forEach((edge, idx) => {
    console.log(`\nHyperedge ${idx}:`, edge.id);
    console.log(`  Neurons:`, edge.neurons);
    console.log(`  Size:`, edge.size);
    console.log(`  Backbone Count:`, edge.backboneCount);
    console.log(`  Hull points:`, edge.hull.length);
});

// Since distance between group 1 and 2 is small (approx 0.05), they should cluster.
// Distance to group 2 is large, they should form second cluster.
