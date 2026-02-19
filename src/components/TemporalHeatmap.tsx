import React, { useRef, useEffect } from 'react';
import { Neuron, SpikeEvent } from '../types';

interface TemporalHeatmapProps {
    spikes: SpikeEvent[];
    neurons: Neuron[];
    currentTime: number;
    width?: number;
    height?: number;
}

export const TemporalHeatmap: React.FC<TemporalHeatmapProps> = ({
    spikes,
    currentTime,
    width = 600,
    height = 300
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Configuration
        const timeWindow = 5000; // 5 seconds history
        const binSize = 50; // 50ms bins
        const startTime = currentTime - timeWindow;
        const endTime = currentTime;

        // Clear canvas
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        // Filter spikes in window
        const activeSpikes = spikes.filter(s =>
            s.timestamp_ms >= startTime &&
            s.timestamp_ms <= endTime
        );

        if (activeSpikes.length === 0) return;

        // Dimensions
        const numBins = Math.ceil(timeWindow / binSize);
        const binWidth = width / numBins;
        const maxNeuronId = 131; // Assuming 0-131 range
        const rowHeight = height / maxNeuronId;

        // Binning Data: Map<binIndex, Map<neuronId, count>>
        // Or simpler: just draw directly?
        // Drawing directly might be faster than building a huge map structure if sparse.
        // But we need to accumulate counts for color intensity.

        // Let's use a flat array for the grid: [neuronId][binIndex] = count
        // Actually, a Map is better for sparsity.
        // Key: `${binIndex}_${neuronId}` -> count
        const grid = new Map<string, number>();

        activeSpikes.forEach(s => {
            const timeOffset = s.timestamp_ms - startTime;
            const binIndex = Math.floor(timeOffset / binSize);
            if (binIndex >= 0 && binIndex < numBins) {
                const key = `${binIndex}_${s.neuron_id}`;
                const count = grid.get(key) || 0;
                grid.set(key, count + 1);
            }
        });

        // Draw
        grid.forEach((count, key) => {
            const [binIndexStr, neuronIdStr] = key.split('_');
            const binIndex = parseInt(binIndexStr);
            const neuronId = parseInt(neuronIdStr);

            const x = binIndex * binWidth;
            // Neuron 0 at top or bottom? Usually raster plots have 0 at bottom.
            // Let's put 0 at bottom to match raster plot.
            const y = height - (neuronId * rowHeight) - rowHeight;

            // Color Mapping
            // 1 -> Blue (#0000FF)
            // 2 -> Cyan (#00FFFF)
            // 3+ -> White (#FFFFFF)
            let color = '#0000FF';
            if (count === 2) color = '#00FFFF';
            if (count >= 3) color = '#FFFFFF';

            ctx.fillStyle = color;
            // Use slightly larger rect to avoid gaps
            ctx.fillRect(x, y, binWidth + 0.5, rowHeight + 0.5);
        });

        // Draw Time Grid (every 1s)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        for (let t = 0; t < timeWindow; t += 1000) {
            const binIndex = Math.floor(t / binSize);
            const x = binIndex * binWidth;
            ctx.fillRect(x, 0, 1, height);
        }

        // Draw Labels
        ctx.fillStyle = '#FFF';
        ctx.font = '10px monospace';
        ctx.fillText(`-${timeWindow / 1000}s`, 5, height - 5);
        ctx.fillText(`Now`, width - 25, height - 5);

    }, [spikes, currentTime, width, height]);

    return (
        <div style={{
            width: width,
            height: height,
            border: '1px solid #333',
            background: '#000',
            position: 'relative'
        }}>
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                style={{ display: 'block' }}
            />
            <div style={{
                position: 'absolute',
                top: 5,
                right: 5,
                color: '#666',
                fontSize: '10px',
                fontFamily: 'monospace'
            }}>
                TEMPORAL WATERFALL
            </div>
        </div>
    );
};
