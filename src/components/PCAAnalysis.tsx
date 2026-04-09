import React, { useMemo } from 'react';
import { PCA } from 'ml-pca';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis, Cell } from 'recharts';
import { SpikeEvent, Neuron } from '../types';

interface PCAAnalysisProps {
    spikes: SpikeEvent[];
    neurons: Neuron[];
    binSizeMs?: number;
}

const PCAAnalysis: React.FC<PCAAnalysisProps> = ({ spikes, neurons, binSizeMs = 100 }) => {
    const pcaData = useMemo(() => {
        if (!spikes.length || !neurons.length) return [];

        // 1. Determine Time Range
        const minTime = Math.min(...spikes.map(s => s.timestamp_ms));
        const maxTime = Math.max(...spikes.map(s => s.timestamp_ms));
        const duration = maxTime - minTime;
        const numBins = Math.ceil(duration / binSizeMs);

        // 2. Create Matrix (Rows = Time Bins, Cols = Neurons)
        // Initialize with zeros
        const matrix = Array(numBins).fill(0).map(() => Array(neurons.length).fill(0));

        // Map neuron IDs to column indices (0 to N-1)
        const neuronIdToIndex = new Map<number, number>();
        neurons.forEach((n, i) => neuronIdToIndex.set(n.neuron_id, i));

        // Fill matrix
        spikes.forEach(spike => {
            const binIndex = Math.floor((spike.timestamp_ms - minTime) / binSizeMs);
            const colIndex = neuronIdToIndex.get(spike.neuron_id);

            if (binIndex >= 0 && binIndex < numBins && colIndex !== undefined) {
                matrix[binIndex][colIndex] += 1;
            }
        });

        // 3. Perform PCA
        try {
            const pca = new PCA(matrix);
            const projected = pca.predict(matrix); // Returns 2D array of projected points

            // 4. Format for Recharts
            // projected.data is an array of arrays [[pc1, pc2, ...], ...]
            return projected.to2DArray().map((row: number[], index: number) => ({
                time: minTime + (index * binSizeMs),
                pc1: row[0],
                pc2: row[1],
                index: index // For color gradient
            }));
        } catch (e) {
            console.error("PCA Calculation Failed:", e);
            return [];
        }

    }, [spikes, neurons, binSizeMs]);

    if (!pcaData.length) return <div>No data for PCA</div>;

    return (
        <div className="w-full h-[48rem] bg-gray-800 p-4 rounded-lg">
            <h3 className="text-white text-lg mb-2">PCA Trajectory (PC1 vs PC2)</h3>
            <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                    <XAxis type="number" dataKey="pc1" name="PC1" stroke="#888" label={{ value: 'PC1', position: 'bottom', fill: '#888' }} />
                    <YAxis type="number" dataKey="pc2" name="PC2" stroke="#888" label={{ value: 'PC2', angle: -90, position: 'left', fill: '#888' }} />
                    <ZAxis type="number" dataKey="time" name="Time" range={[0, 1000]} />
                    <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        contentStyle={{ backgroundColor: '#333', border: 'none', color: '#fff' }}
                    />
                    <Scatter name="Trajectory" data={pcaData} line={{ stroke: '#8884d8', strokeWidth: 1 }}>
                        {pcaData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={`hsl(${(index / pcaData.length) * 360}, 70%, 50%)`} />
                        ))}
                    </Scatter>
                </ScatterChart>
            </ResponsiveContainer>
            <div className="text-gray-400 text-xs mt-2 text-center">
                Color gradient represents time (Start &rarr; End)
            </div>
        </div>
    );
};

export default PCAAnalysis;
