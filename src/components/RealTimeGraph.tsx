import React, { useRef, useEffect, useState } from 'react';
import { Neuron, SpikeEvent } from '../types';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';

interface RealTimeGraphProps {
    spikes: SpikeEvent[];
    neurons: Neuron[];
    currentTime: number;
    isPlaying: boolean;
    threshold: number;
    width?: number;
    height?: number;
    targetDuration?: number; // In seconds
}

type GraphMode = 'NORMAL' | 'STROBE_IN' | 'FOCUS' | 'STROBE_OUT';

interface FocusData {
    neuronIds: number[];
    timeStart: number;
    timeEnd: number;
    label: string;
}

// --- Pure Rendering Function ---
const drawGraphFrame = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    spikes: SpikeEvent[],
    neurons: Neuron[],
    currentTime: number,
    mode: GraphMode,
    focusData: FocusData | null,
    timestamp: number,
    modeTimer: number,
    enableStrobe: boolean
) => {
    // Helper: Random integer
    const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);

    // Clear background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Calculate max neuron ID for normalization
    const maxNeuronId = neurons.length > 0 ? Math.max(...neurons.map(n => n.neuron_id)) : 131;

    // 1. Draw Main Graph (Top Section)
    const graphHeight = height * 0.6;

    // Draw time cursor
    const x = (currentTime % 10000) / 10000 * width; // Wrap every 10s for visual
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = width > 2000 ? 4 : 1; // Thicker line for high-res
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, graphHeight);
    ctx.stroke();

    // Draw Timestamp next to cursor
    ctx.fillStyle = '#FF0000';
    ctx.font = width > 2000 ? '27px monospace' : '7px monospace';
    ctx.fillText(`${Math.round(currentTime)} ms`, x + (width > 2000 ? 10 : 4), width > 2000 ? 27 : 7);

    // Draw spikes
    // Draw spikes within the current 10s page
    const pageIndex = Math.floor(currentTime / 10000);

    spikes.forEach(s => {
        const spikePageIndex = Math.floor(s.timestamp_ms / 10000);

        if (spikePageIndex === pageIndex) {
            const sx = ((s.timestamp_ms % 10000) / 10000) * width;
            const sy = (s.neuron_id / maxNeuronId) * graphHeight;

            // Determine visibility/alpha based on distance from current time
            const timeDiff = Math.abs(s.timestamp_ms - currentTime);
            const isCurrent = timeDiff < 2000;

            if (isCurrent) {
                ctx.fillStyle = '#FFFFFF';
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            }
            const size = width > 2000 ? 8 : 2;
            ctx.fillRect(sx, sy, size, size);
        }
    });

    // 2. Zoom Window (Middle Section) - Sliding / Scrolling
    const zoomY = graphHeight;
    const zoomHeight = height * 0.2;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = width > 2000 ? 2 : 1;
    ctx.strokeRect(0, zoomY, width, zoomHeight);

    // Sliding Window Logic:
    // Show a window of [currentTime - 500, currentTime] (0.5 seconds history)
    const zoomWindowDuration = 500;
    const zoomWindowStart = currentTime - zoomWindowDuration;
    const zoomWindowEnd = currentTime;

    spikes.forEach(s => {
        if (s.timestamp_ms >= zoomWindowStart && s.timestamp_ms <= zoomWindowEnd) {
            // Map time to X: (time - start) / duration * width
            const sx = ((s.timestamp_ms - zoomWindowStart) / zoomWindowDuration) * width;
            // Scientifically accurate mapping: ID / MaxID
            const sy = zoomY + (s.neuron_id / maxNeuronId) * zoomHeight;

            // Draw Circle for High Activity / Zoomed View
            ctx.fillStyle = '#FF0000';
            const radius = width > 2000 ? 6 : 2;
            ctx.beginPath();
            ctx.arc(sx, sy, radius, 0, 2 * Math.PI);
            ctx.fill();

            // Draw Tiny Tag (Neuron ID)
            ctx.fillStyle = '#AAAAAA';
            ctx.font = width > 2000 ? '12px monospace' : '5px monospace';
            ctx.fillText(s.neuron_id.toString(), sx, sy - (radius + 2));
        }
    });

    // Draw indicator
    ctx.fillStyle = '#FF0000';
    ctx.font = width > 2000 ? '27px monospace' : '7px monospace';
    ctx.fillText("LIVE ZOOM (SLIDING)", width > 2000 ? 20 : 5, zoomY + (width > 2000 ? 33 : 8));


    // 3. Text Area (Bottom Section)
    const textY = zoomY + zoomHeight;
    const textHeight = height - textY;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, textY, width, textHeight);

    // Only show text if we are in an active event mode (STROBE_IN, FOCUS, STROBE_OUT)
    // AND we have focus data.
    const isEventActive = mode !== 'NORMAL';

    if (isEventActive && focusData) {
        ctx.fillStyle = '#FFF';
        ctx.font = width > 2000 ? '27px monospace' : '7px monospace';
        const neurons = focusData.neuronIds;

        // Typewriter effect logic
        let visibleChars = 10000;
        if (mode === 'FOCUS' || mode === 'STROBE_IN') {
            const charsPerMs = 0.5;
            const elapsed = timestamp - modeTimer;
            visibleChars = Math.floor(elapsed * charsPerMs);
        }

        let text = `EVENT: ${focusData.label} | NEURONS: ${neurons.join(', ')}`;
        if (text.length > visibleChars) {
            text = text.substring(0, visibleChars) + '_';
        }

        // Word wrap / Multi-line render
        const words = text.split(' ');
        let line = '';
        let y = textY + (width > 2000 ? 40 : 10);
        const lineHeight = width > 2000 ? 33 : 8;
        const margin = width > 2000 ? 40 : 10;

        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > width - (margin * 2) && n > 0) {
                ctx.fillText(line, margin, y);
                line = words[n] + ' ';
                y += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, margin, y);

    }

    // --- Effects ---
    if (mode === 'STROBE_IN' || mode === 'STROBE_OUT') {
        // Background Strobe (Controlled by toggle)
        // if (enableStrobe) {
        //     if (Math.floor(timestamp / 50) % 2 === 0) {
        //         ctx.fillStyle = 'rgba(85, 85, 85, 0.5)'; // Grey strobe
        //         ctx.fillRect(0, 0, width, height);
        //     }
        // }

        // Glitch rectangles / Passing lines (Always visible in this mode)
        for (let i = 0; i < 5; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 0, 0, 0.5)';
            ctx.fillRect(randomInt(0, width), randomInt(0, height), randomInt(10, 100), width > 2000 ? 8 : 2);
        }

        // Add vertical passing lines for "scan" effect
        if (Math.random() > 0.7) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fillRect(randomInt(0, width), 0, 1, height);
        }
    }
};


export const RealTimeGraph: React.FC<RealTimeGraphProps> = ({
    spikes,
    neurons,
    currentTime,
    isPlaying,
    threshold,
    width = 800,
    height = 400,
    targetDuration = 0 // Default to 0 (use data length)
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [mode, setMode] = useState<GraphMode>('NORMAL');
    const [enableStrobe, setEnableStrobe] = useState(true);
    const modeTimerRef = useRef(0);
    const modeDurationRef = useRef(0);
    const focusDataRef = useRef<FocusData | null>(null);
    const lastFrameTimeRef = useRef(0);
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);

    // Helper: Random hex char
    const randomHex = () => Math.floor(Math.random() * 16).toString(16).toUpperCase();
    const randomString = (length: number) => {
        let s = '';
        for (let i = 0; i < length; i++) s += randomHex();
        return s;
    };

    // --- Main Loop ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = (timestamp: number) => {
            if (lastFrameTimeRef.current === 0) lastFrameTimeRef.current = timestamp;
            lastFrameTimeRef.current = timestamp;

            // --- Logic Update ---
            if (mode === 'NORMAL' && isPlaying) {
                const detectionWindow = 50;
                const activeSpikes = spikes.filter(s =>
                    s.timestamp_ms >= currentTime - detectionWindow &&
                    s.timestamp_ms <= currentTime
                );
                const uniqueNeurons = new Set(activeSpikes.map(s => s.neuron_id));

                if (uniqueNeurons.size >= threshold) {
                    setMode('STROBE_IN');
                    modeTimerRef.current = timestamp;
                    modeDurationRef.current = 1000;
                    focusDataRef.current = {
                        neuronIds: Array.from(uniqueNeurons),
                        timeStart: currentTime - 100,
                        timeEnd: currentTime + 100,
                        label: `EVENT_${randomString(4)}`
                    };
                }
            }

            // Handle Mode Transitions
            if (mode !== 'NORMAL') {
                const elapsed = timestamp - modeTimerRef.current;
                if (elapsed > modeDurationRef.current) {
                    if (mode === 'STROBE_IN') {
                        setMode('FOCUS');
                        modeTimerRef.current = timestamp;
                        modeDurationRef.current = 2000;
                    } else if (mode === 'FOCUS') {
                        setMode('STROBE_OUT');
                        modeTimerRef.current = timestamp;
                        modeDurationRef.current = 1000;
                    } else if (mode === 'STROBE_OUT') {
                        setMode('NORMAL');
                    }
                }
            }

            // --- Rendering ---
            drawGraphFrame(
                ctx,
                width,
                height,
                spikes,
                neurons,
                currentTime,
                mode,
                focusDataRef.current,
                timestamp,
                modeTimerRef.current,
                timestamp,
                modeTimerRef.current,
                enableStrobe
            );

            animationFrameId = requestAnimationFrame(render);
        };

        animationFrameId = requestAnimationFrame(render);
        return () => cancelAnimationFrame(animationFrameId);
    }, [spikes, neurons, currentTime, isPlaying, threshold, mode, width, height]);


    // --- Export Handlers ---

    const handleExportFrame = async () => {
        setIsExporting(true);
        try {
            // 7680 x 2160
            const exportWidth = 7680;
            const exportHeight = 2160;

            const offscreen = document.createElement('canvas');
            offscreen.width = exportWidth;
            offscreen.height = exportHeight;
            const ctx = offscreen.getContext('2d');

            if (ctx) {
                drawGraphFrame(
                    ctx,
                    exportWidth,
                    exportHeight,
                    spikes,
                    neurons,
                    currentTime,
                    mode,
                    focusDataRef.current,
                    performance.now(),
                    modeTimerRef.current,
                    enableStrobe
                );

                offscreen.toBlob((blob) => {
                    if (blob) {
                        saveAs(blob, `graph_frame_${Math.floor(currentTime)}.png`);
                    }
                    setIsExporting(false);
                }, 'image/png');
            }
        } catch (e) {
            console.error("Export failed", e);
            setIsExporting(false);
        }
    };

    const handleExportSequence = async () => {
        setIsExporting(true);
        setExportProgress(0);

        try {
            const zip = new JSZip();
            // Use 1080p for sequence to keep size manageable? Or full 4K?
            // User asked for "High-Res". Let's stick to 1920x1080 for sequence to avoid OOM, 
            // or maybe 3840x1080? 
            // Let's do 3840x1080 (Half of the massive res) to be safe, or just 1920x540 (1/4).
            // Actually, let's try 1920x1080. 7680x2160 for 5000 frames is 500GB.
            // Let's assume "High-Res" for sequence means 1920x1080 or similar.
            // I'll use 3840x1080.
            const w = 3840;
            const h = 1080;

            const offscreen = document.createElement('canvas');
            offscreen.width = w;
            offscreen.height = h;
            const ctx = offscreen.getContext('2d');
            if (!ctx) throw new Error("Could not create canvas");

            // Use targetDuration if available (seconds -> ms), otherwise default to 180s
            // If targetDuration is 0, we might want to use the actual data length?
            // For now, let's trust the prop if it's > 0.
            const totalDuration = (targetDuration && targetDuration > 0) ? targetDuration * 1000 : 180000;
            const fps = 30;
            const step = 1000 / fps;
            const totalFrames = Math.ceil(totalDuration / step);

            // We need to simulate the "Mode" logic roughly
            // This is hard because mode depends on playback history.
            // For a pure visual export, maybe we just export 'NORMAL' mode?
            // Or we simulate the trigger?
            // Simulating trigger is complex. 
            // Let's export in 'NORMAL' mode for consistency, or just capture what's there.
            // Actually, if we just iterate time, we miss the interactive triggers.
            // But the user wants the "Loop".
            // Let's simulate the trigger logic!

            let simMode: GraphMode = 'NORMAL';
            let simModeTimer = 0;
            let simModeDuration = 0;
            let simFocusData: FocusData | null = null;

            for (let i = 0; i < totalFrames; i++) {
                const t = i * step;

                // --- Sim Logic ---
                if (simMode === 'NORMAL') {
                    const detectionWindow = 50;
                    const activeSpikes = spikes.filter(s =>
                        s.timestamp_ms >= t - detectionWindow &&
                        s.timestamp_ms <= t
                    );
                    const uniqueNeurons = new Set(activeSpikes.map(s => s.neuron_id));
                    if (uniqueNeurons.size >= threshold) {
                        simMode = 'STROBE_IN';
                        simModeTimer = t;
                        simModeDuration = 1000;
                        simFocusData = {
                            neuronIds: Array.from(uniqueNeurons),
                            timeStart: t - 100,
                            timeEnd: t + 100,
                            label: `EVENT_${Math.floor(Math.random() * 1000)}`
                        };
                    }
                }

                if (simMode !== 'NORMAL') {
                    const elapsed = t - simModeTimer;
                    if (elapsed > simModeDuration) {
                        if (simMode === 'STROBE_IN') {
                            simMode = 'FOCUS';
                            simModeTimer = t;
                            simModeDuration = 2000;
                        } else if (simMode === 'FOCUS') {
                            simMode = 'STROBE_OUT';
                            simModeTimer = t;
                            simModeDuration = 1000;
                        } else if (simMode === 'STROBE_OUT') {
                            simMode = 'NORMAL';
                        }
                    }
                }

                // --- Render ---
                drawGraphFrame(ctx, w, h, spikes, neurons, t, simMode, simFocusData, t, simModeTimer, enableStrobe);

                // --- Save Frame ---
                const blob = await new Promise<Blob | null>(r => offscreen.toBlob(r, 'image/png'));
                if (blob) {
                    const fileName = `frame_${String(i).padStart(5, '0')}.png`;
                    zip.file(fileName, blob);
                }

                // Update Progress
                if (i % 10 === 0) {
                    setExportProgress(Math.round((i / totalFrames) * 100));
                    await new Promise(r => setTimeout(r, 0)); // Yield to UI
                }
            }

            // Generate ZIP
            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, 'graph_sequence_highres.zip');
            setIsExporting(false);

        } catch (e) {
            console.error("Sequence export failed", e);
            setIsExporting(false);
        }
    };

    return (
        <div style={{ position: 'relative' }}>
            <div style={{
                width: width,
                height: height,
                background: '#000',
                border: '1px solid #333',
                position: 'relative',
                overflow: 'hidden'
            }}>
                <canvas
                    ref={canvasRef}
                    width={width}
                    height={height}
                    style={{ display: 'block' }}
                />
                <div style={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    fontFamily: 'monospace',
                    fontSize: '7px',
                    color: mode === 'NORMAL' ? '#444' : '#F00'
                }}>
                    MODE: {mode}
                </div>
            </div>

            {/* Export Controls */}
            <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                    className="btn"
                    onClick={() => setEnableStrobe(!enableStrobe)}
                >
                    {enableStrobe ? 'Strobe: ON' : 'Strobe: OFF'}
                </button>

                <button
                    className="btn"
                    onClick={handleExportFrame}
                    disabled={isExporting}
                >
                    {isExporting ? 'Processing...' : 'Export Frame (7680x2160)'}
                </button>
                <button
                    className="btn"
                    onClick={handleExportSequence}
                    disabled={isExporting}
                >
                    {isExporting ? `Exporting Sequence ${exportProgress}%` : 'Export Sequence (ZIP)'}
                </button>
            </div>
        </div>
    );
};
