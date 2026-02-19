import React, { useMemo, useState } from 'react';
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell
} from 'recharts';
import { Neuron, SpikeEvent } from '../types';
import { calculateFiringRates, binSpikeActivity, SAMPLING_RATE } from '../utils/dataProcessing';
import { SpatialHeatmap } from './SpatialHeatmap';
import { TemporalHeatmap } from './TemporalHeatmap';
import { SpectralHeatmap } from './SpectralHeatmap';

interface CanvasRasterPlotProps {
    spikes: SpikeEvent[];
}

const CanvasRasterPlot: React.FC<CanvasRasterPlotProps> = ({ spikes }) => {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const draw = React.useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || spikes.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Handle high DPI displays
        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        ctx.scale(dpr, dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;

        // Clear canvas
        ctx.clearRect(0, 0, rect.width, rect.height);

        // Find actual data range
        let minTime = spikes[0].timestamp_ms;
        let maxTime = spikes[0].timestamp_ms;
        let minNeuron = spikes[0].neuron_id;
        let maxNeuron = spikes[0].neuron_id;

        for (let i = 1; i < spikes.length; i++) {
            if (spikes[i].timestamp_ms < minTime) minTime = spikes[i].timestamp_ms;
            if (spikes[i].timestamp_ms > maxTime) maxTime = spikes[i].timestamp_ms;
            if (spikes[i].neuron_id < minNeuron) minNeuron = spikes[i].neuron_id;
            if (spikes[i].neuron_id > maxNeuron) maxNeuron = spikes[i].neuron_id;
        }

        const duration = maxTime - minTime;
        const padding = { left: 50, right: 20, top: 20, bottom: 40 };
        const plotWidth = rect.width - padding.left - padding.right;
        const plotHeight = rect.height - padding.top - padding.bottom;

        // Draw Axes
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;

        // Y-Axis line
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, rect.height - padding.bottom);
        ctx.stroke();

        // X-Axis line
        ctx.beginPath();
        ctx.moveTo(padding.left, rect.height - padding.bottom);
        ctx.lineTo(rect.width - padding.right, rect.height - padding.bottom);
        ctx.stroke();

        // Draw Spikes
        ctx.fillStyle = '#4cc9f0'; // var(--color-accent)

        const totalNeurons = 131; // Fixed for Y-axis scaling
        const neuronHeight = plotHeight / totalNeurons;

        spikes.forEach(spike => {
            const x = padding.left + ((spike.timestamp_ms - minTime) / duration) * plotWidth;
            // Neuron 1 at bottom
            const y = (rect.height - padding.bottom) - ((spike.neuron_id / totalNeurons) * plotHeight);

            // Draw a small tick
            ctx.fillRect(x, y - (neuronHeight * 0.8), 1.5, neuronHeight * 0.8);
        });

        // Draw Labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        // Y-Axis Labels (Neurons)
        [1, 32, 64, 96, 131].forEach(n => {
            const y = (rect.height - padding.bottom) - ((n / totalNeurons) * plotHeight);
            ctx.fillText(`${n}`, padding.left - 8, y);
        });

        // Y-Axis Title
        ctx.save();
        ctx.translate(15, rect.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText("Neuron ID", 0, 0);
        ctx.restore();

        // X-Axis Labels (Time in ms)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const timeSteps = 6;
        for (let i = 0; i <= timeSteps; i++) {
            const t = minTime + (duration * (i / timeSteps));
            const x = padding.left + (plotWidth * (i / timeSteps));
            ctx.fillText(`${t.toFixed(0)}`, x, rect.height - padding.bottom + 8);
        }

        // X-Axis Title
        ctx.fillText("Time (ms)", padding.left + plotWidth / 2, rect.height - 15);

    }, [spikes]);

    // Initial Draw & Resize Observer
    React.useEffect(() => {
        draw();

        const container = containerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver(() => {
            draw();
        });

        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
        };
    }, [draw]);

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
            <canvas ref={canvasRef} />
        </div>
    );
};

interface SpikeActivityGraphsProps {
    spikes: SpikeEvent[];
    neurons: Neuron[];
    currentTime?: number; // Current playback time in ms (for moving indicator)
}

// Memoized Static Charts Component
const StaticCharts = React.memo(({ activityData, firingRateData, CustomTooltip, children, showNetworkActivity, showFiringRate }: any) => {
    return (
        <div className="grid" style={{ gridTemplateColumns: (showNetworkActivity && showFiringRate) ? '1fr 1fr' : '1fr' }}>
            {/* Network Activity Timeline */}
            {showNetworkActivity && (
                <div className="viz-canvas" style={{ padding: 'var(--space-md)', position: 'relative' }}>
                    <div className="data-label" style={{ marginBottom: 'var(--space-md)' }}>Network Activity (100ms bins)</div>
                    <div style={{ height: '200px', width: '100%' }}>
                        <ResponsiveContainer>
                            <LineChart data={activityData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                <XAxis
                                    dataKey="timeMs"
                                    type="number"
                                    domain={[0, 180000]}
                                    hide={true}
                                />
                                <YAxis
                                    hide={true}
                                    domain={['auto', 'auto']}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <Line
                                    type="monotone"
                                    dataKey="count"
                                    stroke="var(--color-accent)"
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 4, fill: 'var(--color-text-primary)' }}
                                    isAnimationActive={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    {children}
                </div>
            )}

            {/* Firing Rate Distribution */}
            {showFiringRate && (
                <div className="viz-canvas" style={{ padding: 'var(--space-md)' }}>
                    <div className="data-label" style={{ marginBottom: 'var(--space-md)' }}>Top 20 Active Neurons (Hz)</div>
                    <div style={{ height: '200px', width: '100%' }}>
                        <ResponsiveContainer>
                            <BarChart data={firingRateData}>
                                <XAxis
                                    dataKey="id"
                                    stroke="var(--color-text-secondary)"
                                    fontSize={10}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    stroke="var(--color-text-secondary)"
                                    fontSize={10}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <Bar dataKey="rate">
                                    {firingRateData.map((entry: any, index: number) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.isBackbone ? 'var(--color-backbone)' : 'var(--color-neuron)'}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </div>
    );
});

export const SpikeActivityGraphs: React.FC<SpikeActivityGraphsProps> = ({ spikes, neurons, currentTime }) => {
    // 1. Network Activity (Spikes over time)
    const [showNetworkActivity, setShowNetworkActivity] = useState(true);
    const [showFiringRate, setShowFiringRate] = useState(true);
    const [showRaster, setShowRaster] = useState(true);
    const [showHeatmaps, setShowHeatmaps] = useState(false);

    const heatmapContainerRef = React.useRef<HTMLDivElement>(null);
    const [heatmapSize, setHeatmapSize] = useState(300);

    React.useEffect(() => {
        if (!showHeatmaps || !heatmapContainerRef.current) return;

        const updateSize = () => {
            if (heatmapContainerRef.current) {
                const width = heatmapContainerRef.current.clientWidth;
                setHeatmapSize(Math.floor(width / 2));
            }
        };

        // Initial size
        updateSize();

        const resizeObserver = new ResizeObserver(() => {
            updateSize();
        });

        resizeObserver.observe(heatmapContainerRef.current);

        return () => resizeObserver.disconnect();
    }, [showHeatmaps]);

    const activityData = useMemo(() => {
        return binSpikeActivity(spikes, 100, 180000).map(bin => ({
            time: (bin.time_start / 1000).toFixed(1),
            count: bin.spike_count,
            timeMs: bin.time_start // Keep raw ms for cursor calculation
        }));
    }, [spikes]);

    // 2. Firing Rate Distribution (Top 20 active neurons)
    const firingRateData = useMemo(() => {
        const rates = calculateFiringRates(spikes);
        return rates.slice(0, 20).map(d => ({
            id: `N${d.neuron_id}`,
            rate: d.rate.toFixed(1),
            count: d.spike_count,
            isBackbone: neurons.find(n => n.neuron_id === d.neuron_id)?.is_backbone
        }));
    }, [spikes, neurons]);

    if (spikes.length === 0) return null;

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    padding: '8px',
                    fontSize: '12px'
                }}>
                    <p style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
                    <p style={{ color: 'var(--color-accent)' }}>
                        {payload[0].value} {payload[0].name === 'rate' ? 'Hz' : ''}
                    </p>
                </div>
            );
        }
        return null;
    };

    // Calculate Cursor Position %
    // Assuming activityData covers the full range from 0 to end
    const totalDuration = 180000; // Fixed 180s
    const cursorLeft = currentTime !== undefined ? (currentTime / totalDuration) * 100 : 0;

    return (
        <div className="data-panel">
            <h2 style={{ marginBottom: 'var(--space-lg)' }}>Spike Activity Analysis</h2>

            {/* Toggle Buttons */}
            <div className="flex gap-sm" style={{ marginBottom: 'var(--space-md)' }}>
                <button className={`btn ${showNetworkActivity ? 'active' : ''}`} onClick={() => setShowNetworkActivity(!showNetworkActivity)}>
                    {showNetworkActivity ? 'Hide Network' : 'Show Network'}
                </button>
                <button className={`btn ${showFiringRate ? 'active' : ''}`} onClick={() => setShowFiringRate(!showFiringRate)}>
                    {showFiringRate ? 'Hide Rates' : 'Show Rates'}
                </button>
                <button className={`btn ${showRaster ? 'active' : ''}`} onClick={() => setShowRaster(!showRaster)}>
                    {showRaster ? 'Hide Raster' : 'Show Raster'}
                </button>
                <button className={`btn ${showHeatmaps ? 'active' : ''}`} onClick={() => setShowHeatmaps(!showHeatmaps)}>
                    {showHeatmaps ? 'Hide Heatmaps' : 'Show Heatmaps'}
                </button>
            </div>

            <div style={{ position: 'relative' }}>
                {(showNetworkActivity || showFiringRate) && (
                    <StaticCharts
                        activityData={activityData}
                        firingRateData={firingRateData}
                        CustomTooltip={CustomTooltip}
                        showNetworkActivity={showNetworkActivity}
                        showFiringRate={showFiringRate}
                    >
                        {/* Overlay Cursor for Network Activity Chart */}
                        {showNetworkActivity && currentTime !== undefined && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: '45px', // Below label
                                    left: 'var(--space-md)', // Match padding
                                    right: 'var(--space-md)', // Match padding
                                    height: '200px',
                                    pointerEvents: 'none',
                                    overflow: 'hidden'
                                }}
                            >
                                <div
                                    style={{
                                        position: 'absolute',
                                        left: `${cursorLeft}%`,
                                        top: 0,
                                        bottom: 0,
                                        width: '2px',
                                        background: '#ff6b6b',
                                        opacity: 0.8,
                                        boxShadow: '0 0 4px rgba(255, 107, 107, 0.5)'
                                    }}
                                />
                            </div>
                        )}
                    </StaticCharts>
                )}
            </div>

            {/* Raster Plot (Canvas-based for performance) */}
            {showRaster && (
                <div className="viz-canvas" style={{ marginTop: 'var(--space-lg)', padding: 'var(--space-md)' }}>
                    <div className="data-label" style={{ marginBottom: 'var(--space-md)' }}>Spike Raster Plot (All Data)</div>
                    <div style={{ height: '600px', width: '100%', position: 'relative' }}>
                        <CanvasRasterPlot spikes={spikes} />

                        {/* Raster Plot Cursor */}
                        {currentTime !== undefined && (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: `calc(50px + (100% - 70px) * ${cursorLeft / 100})`,
                                    top: '20px',
                                    bottom: '40px',
                                    width: '2px',
                                    background: '#ff6b6b',
                                    opacity: 0.8,
                                    pointerEvents: 'none'
                                }}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Heatmap Section */}
            {showHeatmaps && (
                <div className="viz-canvas" style={{ marginTop: 'var(--space-lg)', padding: 'var(--space-md)' }}>
                    <div ref={heatmapContainerRef} style={{ width: '100%', maxWidth: '100%' }}>
                        <div className="grid" style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: '0px', // Zero gap so they touch
                            width: '100%',
                            margin: '0 auto'
                        }}>
                            {/* Spatial Heatmap (Top Left) */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0' }}>
                                <div className="data-label" style={{ marginBottom: '4px', fontSize: '0.8em', color: '#888' }}>Spatial Activity (Last 1s)</div>
                                <SpatialHeatmap
                                    spikes={spikes}
                                    neurons={neurons}
                                    currentTime={currentTime || 0}
                                    width={heatmapSize}
                                    height={heatmapSize}
                                />
                            </div>

                            {/* Temporal Waterfall Heatmap (Top Right) */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0' }}>
                                <div className="data-label" style={{ marginBottom: '4px', fontSize: '0.8em', color: '#888' }}>Temporal Waterfall (Last 5s)</div>
                                <TemporalHeatmap
                                    spikes={spikes}
                                    neurons={neurons}
                                    currentTime={currentTime || 0}
                                    width={heatmapSize}
                                    height={heatmapSize}
                                />
                            </div>

                            {/* Spectral Power Heatmap (Bottom Left) */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0' }}>
                                <SpectralHeatmap
                                    spikes={spikes}
                                    neurons={neurons}
                                    width={heatmapSize}
                                    height={heatmapSize}
                                />
                                <div className="data-label" style={{ marginTop: '4px', fontSize: '0.8em', color: '#888' }}>Spectral Power (0-100Hz)</div>
                            </div>

                            {/* Empty Slot (Bottom Right) */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0' }}>
                                <div style={{
                                    width: heatmapSize,
                                    height: heatmapSize,
                                    border: '1px solid #222',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#050505'
                                }}>
                                    <span style={{ color: '#333', fontSize: '0.8em' }}>[EMPTY SLOT]</span>
                                </div>
                                {/* Placeholder label to match height if needed, or just empty space */}
                                <div className="data-label" style={{ marginTop: '4px', fontSize: '0.8em', color: 'transparent' }}>.</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex gap-lg" style={{ marginTop: 'var(--space-md)' }}>
                <div>
                    <div className="data-label">Total Spikes</div>
                    <div className="data-value">{spikes.length}</div>
                </div>
                <div>
                    <div className="data-label">Duration</div>
                    <div className="data-value">
                        180.00s
                    </div>
                </div>
                <div>
                    <div className="data-label">Sampling Rate</div>
                    <div className="data-value">{SAMPLING_RATE / 1000} kHz</div>
                </div>
            </div>
        </div >
    );
};
