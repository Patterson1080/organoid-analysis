import React, { useRef, useEffect } from 'react';
import { Neuron, SpikeEvent } from '../types';

interface SpatialHeatmapProps {
    spikes: SpikeEvent[];
    neurons: Neuron[];
    currentTime: number;
    width?: number;
    height?: number;
}

export const SpatialHeatmap: React.FC<SpatialHeatmapProps> = ({
    spikes,
    neurons,
    currentTime,
    width = 400,
    height = 400
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || neurons.length === 0) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 1. Calculate Bounds
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        neurons.forEach(n => {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
        });

        // Add padding (10%)
        const paddingX = (maxX - minX) * 0.1;
        const paddingY = (maxY - minY) * 0.1;
        minX -= paddingX;
        maxX += paddingX;
        minY -= paddingY;
        maxY += paddingY;

        const rangeX = maxX - minX;
        const rangeY = maxY - minY;

        // 2. Clear Canvas
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        // Helper to map neuron pos to canvas
        const mapX = (x: number) => ((x - minX) / rangeX) * width;
        const mapY = (y: number) => height - ((y - minY) / rangeY) * height; // Flip Y for canvas

        // 3. Draw Neurons (Base Layer)
        ctx.fillStyle = '#222';
        neurons.forEach(n => {
            const cx = mapX(n.x);
            const cy = mapY(n.y);
            ctx.beginPath();
            ctx.arc(cx, cy, 2, 0, Math.PI * 2);
            ctx.fill();
        });

        // 4. Draw Heatmap (Active Layer)
        // Filter spikes in the last 1000ms (1s)
        const windowMs = 1000;
        const activeSpikes = spikes.filter(s =>
            s.timestamp_ms > currentTime - windowMs &&
            s.timestamp_ms <= currentTime
        );

        // Count spikes per neuron in this window
        const activityMap = new Map<number, number>();
        activeSpikes.forEach(s => {
            const count = activityMap.get(s.neuron_id) || 0;
            activityMap.set(s.neuron_id, count + 1);
        });

        // Use additive blending for "glow" effect
        ctx.globalCompositeOperation = 'screen';

        activityMap.forEach((count, neuronId) => {
            const neuron = neurons.find(n => n.neuron_id === neuronId);
            if (neuron) {
                const cx = mapX(neuron.x);
                const cy = mapY(neuron.y);

                // Radius depends on activity count
                // Base radius 20px, max 60px
                const radius = Math.min(60, 20 + count * 5);

                // Create radial gradient
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);

                // Color: Red/Orange glow
                // Center is bright, edge is transparent
                // Alpha scales with count
                const alpha = Math.min(1.0, 0.2 + count * 0.1);

                grad.addColorStop(0, `rgba(255, 50, 50, ${alpha})`);   // Core
                grad.addColorStop(0.4, `rgba(255, 100, 0, ${alpha * 0.5})`); // Mid
                grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Edge

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Reset composite operation
        ctx.globalCompositeOperation = 'source-over';

        // 5. Draw Legend / Info
        ctx.fillStyle = '#FFF';
        ctx.font = '10px monospace';
        ctx.fillText(`Active Neurons (1s): ${activityMap.size}`, 10, 20);
        ctx.fillText(`Total Spikes (1s): ${activeSpikes.length}`, 10, 35);

    }, [spikes, neurons, currentTime, width, height]);

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
                bottom: 5,
                right: 5,
                color: '#666',
                fontSize: '10px',
                fontFamily: 'monospace'
            }}>
                SPATIAL HEATMAP
            </div>
        </div>
    );
};
