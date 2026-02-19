import React, { useRef, useEffect, useMemo } from 'react';
import { Neuron, SpikeEvent } from '../types';

interface SpectralHeatmapProps {
    spikes: SpikeEvent[];
    neurons: Neuron[];
    width?: number;
    height?: number;
}

// Helper: Jet Colormap (Blue -> Cyan -> Yellow -> Red)
const getJetColor = (v: number) => {
    let r = 0, g = 0, b = 0;
    if (v < 0.25) {
        // Blue -> Cyan
        b = 255;
        g = Math.floor(255 * (v / 0.25));
    } else if (v < 0.5) {
        // Cyan -> Green
        g = 255;
        b = Math.floor(255 * (1 - (v - 0.25) / 0.25));
    } else if (v < 0.75) {
        // Green -> Yellow
        g = 255;
        r = Math.floor(255 * ((v - 0.5) / 0.25));
    } else {
        // Yellow -> Red
        r = 255;
        g = Math.floor(255 * (1 - (v - 0.75) / 0.25));
    }
    return `rgb(${r},${g},${b})`;
};

export const SpectralHeatmap: React.FC<SpectralHeatmapProps> = ({
    spikes,
    neurons,
    width = 600,
    height = 400
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // 1. Calculate Spectral Power (Heavy computation, memoize!)
    const spectralData = useMemo(() => {
        if (spikes.length === 0 || neurons.length === 0) return null;

        const FREQ_MIN = 1;
        const FREQ_MAX = 100;
        const FREQ_STEP = 1;
        const frequencies: number[] = [];
        for (let f = FREQ_MIN; f <= FREQ_MAX; f += FREQ_STEP) frequencies.push(f);

        // Group spikes by neuron
        const spikesByNeuron = new Map<number, number[]>();
        neurons.forEach(n => spikesByNeuron.set(n.neuron_id, []));
        spikes.forEach(s => {
            const list = spikesByNeuron.get(s.neuron_id);
            if (list) list.push(s.timestamp_ms / 1000); // Convert to seconds
        });

        // Compute Power Spectrum for each neuron
        const neuronSpectra: { id: number; power: number[]; peakFreq: number; maxPower: number }[] = [];

        spikesByNeuron.forEach((times, id) => {
            if (times.length < 5) {
                // Ignore inactive neurons
                return;
            }

            const power: number[] = [];
            let maxP = 0;
            let peakF = 0;

            frequencies.forEach(f => {
                let sumCos = 0;
                let sumSin = 0;
                const omega = 2 * Math.PI * f;

                // Point Process DFT
                for (let i = 0; i < times.length; i++) {
                    const t = times[i];
                    sumCos += Math.cos(omega * t);
                    sumSin += Math.sin(omega * t);
                }

                const p = (sumCos * sumCos + sumSin * sumSin) / times.length; // Normalize by count
                power.push(p);

                if (p > maxP) {
                    maxP = p;
                    peakF = f;
                }
            });

            neuronSpectra.push({ id, power, peakFreq: peakF, maxPower: maxP });
        });

        // Sort neurons by Peak Frequency
        neuronSpectra.sort((a, b) => a.peakFreq - b.peakFreq);

        return { frequencies, neuronSpectra };

    }, [spikes, neurons]); // Re-compute only when data changes (might be slow for large datasets)

    // 2. Render
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !spectralData) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { frequencies, neuronSpectra } = spectralData;

        // Clear
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        if (neuronSpectra.length === 0) return;

        const numFreqs = frequencies.length;
        const numNeurons = neuronSpectra.length;

        const cellWidth = width / numFreqs;
        const cellHeight = height / numNeurons;

        // Draw Heatmap
        neuronSpectra.forEach((neuron, rowIdx) => {
            // Normalize power for this neuron (0-1) for better visualization of tuning
            // Or normalize globally? Local normalization shows tuning better.
            const maxP = neuron.maxPower || 1;

            neuron.power.forEach((p, colIdx) => {
                const normP = p / maxP;
                ctx.fillStyle = getJetColor(normP);
                // Invert Y axis (Rank 0 at bottom)
                const y = height - (rowIdx * cellHeight) - cellHeight;
                const x = colIdx * cellWidth;

                // Use slightly larger rect to avoid gaps
                ctx.fillRect(x, y, cellWidth + 0.5, cellHeight + 0.5);
            });
        });

        // Draw Axes Labels
        ctx.fillStyle = '#FFF';
        ctx.font = '10px monospace';

        // X-Axis (Frequency)
        ctx.fillText('0 Hz', 5, height - 5);
        ctx.fillText('50 Hz', width / 2, height - 5);
        ctx.fillText('100 Hz', width - 40, height - 5);

        // Y-Axis (Rank)
        ctx.save();
        ctx.translate(10, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('Neuron Rank (Sorted by Peak Freq)', 0, 0);
        ctx.restore();

    }, [spectralData, width, height]);

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
                SPECTRAL POWER (DFT)
            </div>
            {(!spectralData || spectralData.neuronSpectra.length === 0) && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: '#666'
                }}>
                    Insufficient Data for Spectrum
                </div>
            )}
        </div>
    );
};
