// App.tsx - Main application component
import { useState, useRef, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import './index.css';
import { FileUploader } from './components/FileUploader';
import { Organoid3D } from './components/Organoid3D';
import { SpikeActivityGraphs } from './components/SpikeActivityGraphs';
import { RealTimeGraph } from './components/RealTimeGraph';
import PCA3D from './components/PCA3D';
import { Neuron, SpikeEvent } from './types';
import { playMultipleClicks, playBassPulse } from './utils/audioUtils';

// Binary search helpers removed as they were unused

const FPSCounter = () => {
    const [fps, setFps] = useState(0);
    const frameCount = useRef(0);
    const lastTime = useRef(performance.now());

    useEffect(() => {
        let animationFrameId: number;

        const loop = () => {
            const now = performance.now();
            frameCount.current++;

            if (now - lastTime.current >= 1000) {
                setFps(Math.round((frameCount.current * 1000) / (now - lastTime.current)));
                frameCount.current = 0;
                lastTime.current = now;
            }

            animationFrameId = requestAnimationFrame(loop);
        };

        loop();

        return () => cancelAnimationFrame(animationFrameId);
    }, []);

    return <span>FPS: {fps}</span>;
};

function App() {
    const [neurons, setNeurons] = useState<Neuron[]>([]);
    const [visibleSpikes, setVisibleSpikes] = useState<SpikeEvent[]>([]);
    const [showOrganoid, setShowOrganoid] = useState(false);
    const [showSpikeAnalysis, setShowSpikeAnalysis] = useState(false);
    const [showPCA, setShowPCA] = useState(false);
    const [showRealTimeGraph, setShowRealTimeGraph] = useState(false);

    const allSpikesRef = useRef<SpikeEvent[]>([]);

    // Time State
    const [startTime, setStartTime] = useState(0);
    const [endTime, setEndTime] = useState(180000); // Default to 180s
    const [maxTime, setMaxTime] = useState(180000); // Default to 180s

    // Animation State
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLooping, setIsLooping] = useState(false); // Infinite loop state
    const [isReverse, setIsReverse] = useState(false); // Reverse playback state
    const [playbackTime, setPlaybackTime] = useState(0);
    const animationRef = useRef<number>();

    // OSC State
    const [oscInPort, setOscInPort] = useState('3333');
    const [oscOutIp, setOscOutIp] = useState('127.0.0.1');
    const [oscOutPort, setOscOutPort] = useState('3334');
    const [wsConnected, setWsConnected] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [lastOscMessage, setLastOscMessage] = useState<{ address: string, args: any[] } | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    // Sound State
    const [soundEnabled, setSoundEnabled] = useState(false);
    const [isTransparent, setIsTransparent] = useState(false); // Transparent background for Spout/OBS
    const [targetDuration, setTargetDuration] = useState(10); // Target playback duration in seconds
    const [burstThreshold, setBurstThreshold] = useState(20); // Min neurons for burst
    const [trailLength, setTrailLength] = useState(5); // Number of neurons in trail
    const [neuralCurvesEnabled, setNeuralCurvesEnabled] = useState(false); // Eciton burchellii style curves
    const [lastFiringCount] = useState(5); // N = number of last firing neurons for curves
    const [spoutEnabled, setSpoutEnabled] = useState(false); // Default to false for performance
    const [realTimeThreshold, setRealTimeThreshold] = useState(10); // Threshold for Real-Time glitch

    // Export State
    const exportRef = useRef<any>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);

    const lastPlaybackTimeRef = useRef(0);
    const lastBurstTimeRef = useRef(0);
    const recentFiringNeuronsRef = useRef<Neuron[]>([]);

    const playbackTimeRef = useRef(0);
    const lastUiUpdateRef = useRef(0);

    // Sync ref with state when state changes (e.g. user scrubbing)
    useEffect(() => {
        if (!isPlaying) {
            playbackTimeRef.current = playbackTime;
        }
    }, [playbackTime, isPlaying]);

    // Handle Incoming OSC Row Index
    const handleOscRowInput = useCallback((rowIndex: number) => {
        if (allSpikesRef.current.length > 0) {
            const idx = Math.max(0, Math.min(rowIndex, allSpikesRef.current.length - 1));
            const spike = allSpikesRef.current[idx];
            if (spike) {
                const newTime = spike.timestamp_ms;
                setPlaybackTime(newTime);
                playbackTimeRef.current = newTime;
                setIsPlaying(true);

                // Echo OSC Out
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        type: 'OSC_SEND',
                        payload: rowIndex
                    }));
                }
            }
        }
    }, []);

    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // WebSocket Connection Logic
    const connectWs = useCallback(() => {
        // Clear any pending retry
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            console.log('WS: Already connected or connecting');
            return;
        }

        setConnectionError(null);
        console.log('WS: Attempting connection to ws://127.0.0.1:8080');

        try {
            const ws = new WebSocket('ws://127.0.0.1:8080');

            ws.onopen = () => {
                console.log('WS: Connected');
                setWsConnected(true);
                setConnectionError(null);
                // Send initial config
                ws.send(JSON.stringify({
                    type: 'CONFIG',
                    payload: {
                        oscInPort: parseInt(oscInPort),
                        oscOutPort: parseInt(oscOutPort),
                        oscOutIp
                    }
                }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'OSC_MSG') {
                        setLastOscMessage(data.payload);
                        // Handle /row input
                        if (data.payload.address === '/row' && data.payload.args.length > 0) {
                            const rowIndex = Number(data.payload.args[0]);
                            handleOscRowInput(rowIndex);
                        }
                    }
                } catch (e) {
                    console.error('WS: Parse error', e);
                }
            };

            ws.onclose = (event) => {
                console.log('WS: Closed', event.code, event.reason);
                setWsConnected(false);
                wsRef.current = null;

                // Retry if not intentionally closed
                if (event.code !== 1000 && event.code !== 1001) {
                    setConnectionError(`Connection failed (Code: ${event.code}). Retrying in 2s...`);
                    reconnectTimeoutRef.current = setTimeout(() => {
                        connectWs();
                    }, 2000);
                }
            };

            ws.onerror = (error) => {
                console.error('WS: Error', error);
                // onclose will trigger and handle retry
                setConnectionError('Connection Error');
            };

            wsRef.current = ws;
        } catch (e) {
            console.error('WS: Setup Error', e);
            setConnectionError('Failed to create WebSocket. Retrying in 2s...');
            reconnectTimeoutRef.current = setTimeout(() => {
                connectWs();
            }, 2000);
        }
    }, [oscInPort, oscOutPort, oscOutIp, handleOscRowInput]);

    const toggleConnection = useCallback(() => {
        if (wsConnected && wsRef.current) {
            console.log('WS: User requested disconnect');
            // Clear retry if exists
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            wsRef.current.close(1000, "User Disconnect"); // 1000 = Normal Closure
            wsRef.current = null;
            setWsConnected(false);
        } else {
            console.log('WS: User requested connect');
            connectWs();
        }
    }, [wsConnected, connectWs]);

    // Initial Connection
    useEffect(() => {
        let isMounted = true;

        // Small timeout to avoid double-mount issues in Strict Mode
        const timeoutId = setTimeout(() => {
            if (isMounted) {
                connectWs();
            }
        }, 100);

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (wsRef.current) {
                console.log('WS: Cleanup closing connection');
                wsRef.current.close(1000, "Component Unmount");
                wsRef.current = null;
            }
        };
    }, []); // Run once on mount

    // Update OSC Config when changed
    useEffect(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'CONFIG',
                payload: {
                    oscInPort: parseInt(oscInPort),
                    oscOutPort: parseInt(oscOutPort),
                    oscOutIp
                }
            }));
        }
    }, [oscInPort, oscOutIp, oscOutPort]);

    const handleNeuronsLoaded = (loadedNeurons: Neuron[]) => {
        setNeurons(loadedNeurons);
        setShowOrganoid(true);
    };

    const handleSpikesLoaded = (loadedSpikes: SpikeEvent[]) => {
        let sortedSpikes = [...loadedSpikes].sort((a, b) => a.timestamp_ms - b.timestamp_ms);

        if (sortedSpikes.length > 0) {
            let last = Math.ceil(sortedSpikes[sortedSpikes.length - 1].timestamp_ms);

            if (last < 1000) {
                console.log('Auto-scaling timestamps: Detected Seconds, converting to Milliseconds.');
                sortedSpikes = sortedSpikes.map(s => ({
                    ...s,
                    timestamp_ms: s.timestamp_ms * 1000
                }));
                last = Math.ceil(sortedSpikes[sortedSpikes.length - 1].timestamp_ms);
            }

            allSpikesRef.current = sortedSpikes;

            // Force 180s range
            const forcedMax = 180000;
            setMaxTime(forcedMax);
            setEndTime(forcedMax);
            setStartTime(0);

            setPlaybackTime(0);
            playbackTimeRef.current = 0;
            setTargetDuration(forcedMax / 1000); // Default to 1x speed (real-time)

            // Show ALL spikes
            setVisibleSpikes(sortedSpikes);
        } else {
            allSpikesRef.current = [];
            setVisibleSpikes([]);
        }
        setShowSpikeAnalysis(true);
    };

    // Filter visible spikes when window changes
    useEffect(() => {
        if (allSpikesRef.current.length > 0) {
            const filtered = allSpikesRef.current.filter(s =>
                s.timestamp_ms >= startTime && s.timestamp_ms <= endTime
            );
            setVisibleSpikes(filtered);
        }
    }, [startTime, endTime]);

    // Export Sequence Logic
    const handleExportSequence = async () => {
        if (!exportRef.current) return;

        setIsPlaying(false);
        setIsExporting(true);
        setExportProgress(0);

        const zip = new JSZip();
        const folder = zip.folder("organoid_sequence");

        // Export settings
        // Calculate total frames based on Target Playback Duration (s) * 60 FPS
        // If targetDuration is not set (0), fallback to real-time (Data Duration * 60 FPS)
        const dataDurationSec = (endTime - startTime) / 1000;
        const duration = targetDuration > 0 ? targetDuration : dataDurationSec;
        const totalFrames = Math.ceil(duration * 60);

        const start = startTime;
        const end = endTime;
        const totalDataDuration = end - start;

        // Step size in data-time (ms) to achieve 60 FPS over the target duration
        const STEP_MS = totalDataDuration / totalFrames;

        console.log(`Exporting: ${totalFrames} frames over ${duration}s. Step: ${STEP_MS.toFixed(4)}ms`);

        let currentStep = 0;

        // Helper to wait for frame render
        // Reduced wait time for faster export, but enough for React/Three to update
        const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        // Use a loop that counts frames to ensure exact frame count
        for (let i = 0; i < totalFrames; i++) {
            const t = start + (i * STEP_MS);

            if (t > end) break;

            setPlaybackTime(t);
            playbackTimeRef.current = t;

            // Wait for React/Three to update
            // 30ms is a safe buffer (approx 2 frames at 60Hz) to ensure render completes
            await wait(30);

            // Try PNG first (Organoid3D), fallback to SVG if not available
            if (exportRef.current.getPNGDataURL) {
                const dataUrl = exportRef.current.getPNGDataURL();
                // Remove header "data:image/png;base64,"
                const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
                folder?.file(`frame_${i.toString().padStart(6, '0')}.png`, base64Data, { base64: true });
            } else if (exportRef.current.getSVGString) {
                const svgString = exportRef.current.getSVGString();
                if (svgString) {
                    folder?.file(`frame_${i.toString().padStart(6, '0')}.svg`, svgString);
                }
            }

            currentStep++;
            setExportProgress(Math.round((currentStep / totalFrames) * 100));
        }

        // Generate ZIP
        const content = await zip.generateAsync({ type: "blob" });
        const ext = exportRef.current.getPNGDataURL ? "png" : "svg";
        saveAs(content, `organoid_sequence_${ext}.zip`);

        setIsExporting(false);
        setExportProgress(0);
        setPlaybackTime(startTime); // Reset to start
        playbackTimeRef.current = startTime;
    };

    // Keyboard Shortcuts for Frame Stepping
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle if not typing in an input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            const STEP_MS = 10; // 10ms per step

            if (e.key === 'ArrowLeft') {
                setIsPlaying(false); // Pause when stepping
                setPlaybackTime(prev => {
                    const next = Math.max(0, prev - STEP_MS);
                    playbackTimeRef.current = next;
                    return next;
                });
            } else if (e.key === 'ArrowRight') {
                setIsPlaying(false); // Pause when stepping
                setPlaybackTime(prev => {
                    const next = Math.min(endTime, prev + STEP_MS);
                    playbackTimeRef.current = next;
                    return next;
                });
            } else if (e.key === ' ') {
                // Spacebar to toggle play/pause
                e.preventDefault(); // Prevent scrolling
                setIsPlaying(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [endTime]);

    // Slow Motion State
    const timeDriftRef = useRef(0); // Ms behind real-time
    const currentSpeedRef = useRef(1); // Actual playback speed multiplier
    const isSlowMotionActiveRef = useRef(false);

    // Animation Loop
    useEffect(() => {
        if (isPlaying) {
            let lastTime = performance.now();

            const animate = (time: number) => {
                const delta = time - lastTime;
                lastTime = time;

                // Calculate Base Speed based on target duration
                const dataDuration = endTime - startTime;
                const baseSpeed = targetDuration > 0 ? dataDuration / (targetDuration * 1000) : 1;
                const direction = isReverse ? -1 : 1;

                // --- Slow Motion / Catch Up Logic ---
                let targetMultiplier = 1.0;

                if (isSlowMotionActiveRef.current) {
                    targetMultiplier = 0.25; // Slow down to 25%
                } else if (timeDriftRef.current > 100) { // If we are behind by > 100ms
                    targetMultiplier = 4.0; // Speed up to 400% to catch up
                } else {
                    targetMultiplier = 1.0; // Normal speed
                }

                // Smoothly interpolate current speed towards target
                // Lerp factor: 0.05 for smooth transition
                currentSpeedRef.current += (targetMultiplier - currentSpeedRef.current) * 0.05;

                // Apply speed multiplier
                const effectiveSpeed = baseSpeed * currentSpeedRef.current;

                const prev = playbackTimeRef.current;
                let next = prev + (delta * effectiveSpeed * direction);

                // Track Drift
                // If we are playing slower than 1x, drift increases.
                // If we are playing faster than 1x, drift decreases.
                // We compare effective multiplier (currentSpeedRef) against 1.0
                if (!isSlowMotionActiveRef.current) {
                    // Only reduce drift when NOT in slow motion event
                    // Calculate how much "extra" time we covered this frame compared to 1x speed
                    // extra = delta * (currentSpeed - 1)
                    // If currentSpeed is 4, we covered 3x extra time.
                    const recovered = delta * (currentSpeedRef.current - 1.0);
                    timeDriftRef.current = Math.max(0, timeDriftRef.current - recovered);
                } else {
                    // We are in slow motion, accumulate drift
                    // lost = delta * (1 - currentSpeed)
                    // If currentSpeed is 0.25, we lost 0.75 * delta
                    const lost = delta * (1.0 - currentSpeedRef.current);
                    timeDriftRef.current += lost;
                }

                if (isReverse) {
                    if (next <= startTime) {
                        if (isLooping) {
                            next = endTime;
                        } else {
                            setIsPlaying(false);
                            next = startTime;
                        }
                    }
                } else {
                    if (next >= endTime) {
                        if (isLooping) {
                            next = startTime; // Loop back to start
                        } else {
                            setIsPlaying(false);
                            next = endTime;
                        }
                    }
                }

                playbackTimeRef.current = next;

                // Throttle UI Updates (e.g., 15 FPS = ~66ms, 10 FPS = 100ms)
                if (time - lastUiUpdateRef.current > 100) {
                    setPlaybackTime(next);
                    lastUiUpdateRef.current = time;
                }

                // Find spikes in this frame
                const spikesInFrame = allSpikesRef.current.filter(
                    s => s.timestamp_ms > lastPlaybackTimeRef.current && s.timestamp_ms <= next
                );

                // Update Recent Neurons for OSC
                if (spikesInFrame.length > 0) {
                    spikesInFrame.forEach(s => {
                        const n = neurons.find(neuron => neuron.neuron_id === s.neuron_id);
                        if (n) {
                            recentFiringNeuronsRef.current.push(n);
                        }
                    });
                    // Keep last 5
                    if (recentFiringNeuronsRef.current.length > 5) {
                        recentFiringNeuronsRef.current = recentFiringNeuronsRef.current.slice(-5);
                    }
                }

                // Play sound for spikes in this frame
                if (soundEnabled && spikesInFrame.length > 0) {
                    const spikeCount = spikesInFrame.length;
                    if (spikeCount > 0) {
                        playMultipleClicks(spikeCount, 10);

                        // Check for synchronized burst (multiple neurons firing together)
                        const uniqueNeurons = new Set(spikesInFrame.map(s => s.neuron_id)).size;
                        if (uniqueNeurons >= burstThreshold) {
                            const timeSinceLastBurst = next - lastBurstTimeRef.current;
                            if (timeSinceLastBurst > 200) { // Prevent multiple bass hits too close
                                playBassPulse(uniqueNeurons / burstThreshold);
                                lastBurstTimeRef.current = next;
                            }
                        }
                    }
                }
                lastPlaybackTimeRef.current = next;

                // Send OSC output (current row index + neuron coords)
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    const rowIndex = Math.floor(next); // Row = time in ms

                    const payload = {
                        time: rowIndex,
                        neurons: recentFiringNeuronsRef.current.map(n => ({ x: n.x, y: n.y }))
                    };

                    wsRef.current.send(JSON.stringify({
                        type: 'OSC_BUNDLE',
                        payload: payload
                    }));
                }

                if (isPlaying) {
                    animationRef.current = requestAnimationFrame(animate);
                }
            };

            animationRef.current = requestAnimationFrame(animate);
        } else {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        }

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, [isPlaying, startTime, endTime, soundEnabled, targetDuration, burstThreshold, neurons, isLooping, isReverse]);

    return (
        <div className={`app-container ${isTransparent ? 'transparent-bg' : ''}`}>
            <div className="scanline" />
            <div className="container">
                <header>
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 style={{ letterSpacing: '0.2em' }}>Brain Organoid Analysis</h1>
                            <div className="status-text" style={{ marginTop: 'var(--space-sm)' }}>
                                Neural Activity Visualization System
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="status-text">
                                FIG 1.0 // DATA_SOURCE: LIVE
                            </div>
                            <div className="status-text" style={{ color: 'var(--color-accent)', fontSize: '0.8em' }}>
                                <FPSCounter />
                            </div>
                        </div>
                    </div>
                </header>

                <div className="controls-section">
                    <div className="grid-cell">
                        <FileUploader onNeuronsLoaded={handleNeuronsLoaded} onSpikesLoaded={handleSpikesLoaded} />
                    </div>

                    {/* Time Filter & Playback Controls */}
                    {allSpikesRef.current.length > 0 && (
                        <div className="grid-cell">
                            <h2>Time Filter</h2>
                            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                                <div className="data-label">Window: {(startTime / 1000).toFixed(1)}s - {(endTime / 1000).toFixed(1)}s</div>
                                <div className="status-text" style={{ color: 'var(--color-accent)' }}>
                                    {visibleSpikes.filter(s => s.timestamp_ms >= startTime && s.timestamp_ms <= endTime).length} events
                                </div>
                            </div>

                            <div className="flex flex-col gap-md">
                                {/* Start Time Control */}
                                <div className="flex flex-col gap-sm">
                                    <div className="flex items-center gap-md">
                                        <label className="data-label">Start Time (s):</label>
                                        <input
                                            type="number"
                                            value={(startTime / 1000).toFixed(1)}
                                            min={0}
                                            max={(endTime / 1000)}
                                            step={0.1}
                                            onChange={e => setStartTime(Math.min(Number(e.target.value) * 1000, endTime))}
                                            style={{ width: '80px' }}
                                        />
                                    </div>
                                    <div style={{ position: 'relative', height: '20px' }}>
                                        <input
                                            type="range"
                                            min={0}
                                            max={maxTime / 1000}
                                            step={0.1}
                                            value={startTime / 1000}
                                            onChange={e => setStartTime(Math.min(Number(e.target.value) * 1000, endTime))}
                                            className="range-thumb-only"
                                            style={{ width: '100%', position: 'absolute', top: 0, zIndex: 10 }}
                                        />
                                        <div style={{ position: 'absolute', top: '8px', left: '0', width: '100%', height: '2px', background: 'var(--color-border)', zIndex: 1 }} />
                                        <div style={{ position: 'absolute', top: '8px', left: '0', width: `${(startTime / maxTime) * 100}%`, height: '2px', background: 'var(--color-text-primary)', zIndex: 2 }} />
                                    </div>
                                </div>

                                {/* End Time Control */}
                                <div className="flex flex-col gap-sm">
                                    <div className="flex items-center gap-md">
                                        <label className="data-label">End Time (s):</label>
                                        <input
                                            type="number"
                                            value={(endTime / 1000).toFixed(1)}
                                            min={(startTime / 1000)}
                                            max={maxTime / 1000}
                                            step={0.1}
                                            onChange={e => setEndTime(Math.max(Number(e.target.value) * 1000, startTime))}
                                            style={{ width: '80px' }}
                                        />
                                    </div>
                                    <div style={{ position: 'relative', height: '20px' }}>
                                        <input
                                            type="range"
                                            min={0}
                                            max={maxTime / 1000}
                                            step={0.1}
                                            value={endTime / 1000}
                                            onChange={e => setEndTime(Math.max(Number(e.target.value) * 1000, startTime))}
                                            className="range-thumb-only"
                                            style={{ width: '100%', position: 'absolute', top: 0, zIndex: 10 }}
                                        />
                                        <div style={{ position: 'absolute', top: '8px', left: '0', width: '100%', height: '2px', background: 'var(--color-border)', zIndex: 1 }} />
                                        <div style={{ position: 'absolute', top: '8px', left: '0', width: maxTime > 0 ? `${(endTime / maxTime) * 100}%` : '0%', height: '2px', background: 'var(--color-text-primary)', zIndex: 2 }} />
                                    </div>
                                </div>

                                {/* Playback Controls */}
                                <div className="flex flex-col gap-0" style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-md)' }}>
                                    {/* Row 1: Transport */}
                                    <div className="flex gap-sm">
                                        <button className="btn" style={{ padding: '4px 8px', minWidth: '30px' }} onClick={() => { setIsPlaying(false); setPlaybackTime(Math.max(startTime, playbackTime - 10)); }}>
                                            &lt;
                                        </button>
                                        <button className="btn" style={{ minWidth: '80px' }} onClick={() => setIsPlaying(!isPlaying)}>
                                            {isPlaying ? '❚❚ Pause' : '▶ Play'}
                                        </button>
                                        <button className="btn" style={{ padding: '4px 8px', minWidth: '30px' }} onClick={() => { setIsPlaying(false); setPlaybackTime(Math.min(endTime, playbackTime + 10)); }}>
                                            &gt;
                                        </button>
                                        <button className="btn" onClick={() => { setIsPlaying(false); setPlaybackTime(startTime); }}>
                                            ■ Stop
                                        </button>

                                        <div className="status-text" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                                            T: {Math.round(playbackTime)} ms
                                        </div>
                                    </div>

                                    {/* Row 2: Options (Loop, Sound, Reverse) - Touching upper row */}
                                    <div className="flex gap-sm" style={{ marginTop: '-1px' }}>
                                        <button
                                            className="btn"
                                            onClick={() => setIsLooping(!isLooping)}
                                            style={{
                                                backgroundColor: isLooping ? '#fff' : 'transparent',
                                                color: isLooping ? '#000' : 'var(--color-text-primary)',
                                                fontSize: '0.8em',
                                                padding: '2px 8px',
                                                borderTopLeftRadius: 0,
                                                borderTopRightRadius: 0
                                            }}
                                        >
                                            🔁 Loop
                                        </button>
                                        <button
                                            className="btn"
                                            onClick={() => setSoundEnabled(!soundEnabled)}
                                            style={{
                                                backgroundColor: soundEnabled ? '#fff' : 'transparent',
                                                color: soundEnabled ? '#000' : 'var(--color-text-primary)',
                                                fontSize: '0.8em',
                                                padding: '2px 8px',
                                                borderTopLeftRadius: 0,
                                                borderTopRightRadius: 0
                                            }}
                                        >
                                            {soundEnabled ? '🔊 Sound On' : '🔇 Sound Off'}
                                        </button>
                                        <button
                                            className="btn"
                                            onClick={() => setIsReverse(!isReverse)}
                                            style={{
                                                color: isReverse ? 'var(--color-accent)' : 'var(--color-text)',
                                                borderColor: isReverse ? 'var(--color-accent)' : 'var(--color-border)',
                                                fontSize: '0.9rem',
                                                padding: '4px 12px'
                                            }}
                                        >
                                            ◀ Reverse
                                        </button>
                                        <button
                                            className="btn"
                                            onClick={() => setSpoutEnabled(!spoutEnabled)}
                                            style={{
                                                borderColor: spoutEnabled ? 'var(--color-accent)' : 'var(--color-border)',
                                                color: spoutEnabled ? 'var(--color-accent)' : 'var(--color-text)'
                                            }}
                                        >
                                            {spoutEnabled ? 'Spout ON' : 'Spout OFF'}
                                        </button>
                                    </div>
                                </div>

                                {/* Playback Speed Control (Target Duration) */}
                                <div className="flex flex-col gap-sm" style={{ marginTop: 'var(--space-md)' }}>
                                    <div className="flex justify-between items-end">
                                        <label className="data-label">Target Playback Duration (s):</label>
                                        <span className="status-text" style={{ color: 'var(--color-accent)' }}>
                                            Speed: {(targetDuration > 0 ? (endTime - startTime) / (targetDuration * 1000) : 0).toFixed(2)}x
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-sm">
                                        <input
                                            type="number"
                                            value={targetDuration}
                                            min={1}
                                            max={3600}
                                            step={1}
                                            onChange={e => setTargetDuration(Number(e.target.value))}
                                            style={{ width: '100%', padding: '4px', background: '#111', border: '1px solid #333', color: '#fff' }}
                                        />
                                        <input
                                            type="range"
                                            min={1}
                                            max={3600}
                                            step={1}
                                            value={targetDuration}
                                            onChange={e => setTargetDuration(Number(e.target.value))}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* View Controls & Settings */}
                    {(neurons.length > 0 || allSpikesRef.current.length > 0) && (
                        <div className="grid-cell">
                            <h2>View Controls</h2>
                            <div className="flex flex-col gap-md">
                                {neurons.length > 0 && (
                                    <button className="btn" onClick={() => setShowOrganoid(!showOrganoid)}>
                                        {showOrganoid ? '■ Hide' : '▶'} Organoid Map (3D)
                                    </button>
                                )}
                                {allSpikesRef.current.length > 0 && (
                                    <button className="btn" onClick={() => setShowSpikeAnalysis(!showSpikeAnalysis)}>
                                        {showSpikeAnalysis ? '■ Hide' : '▶'} Spike Analysis
                                    </button>
                                )}
                                {allSpikesRef.current.length > 0 && (
                                    <button className="btn" onClick={() => setShowPCA(!showPCA)}>
                                        {showPCA ? '■ Hide' : '▶'} PCA Trajectory
                                    </button>
                                )}
                                {allSpikesRef.current.length > 0 && (
                                    <button
                                        className={`btn ${showRealTimeGraph ? 'active' : ''}`}
                                        onClick={() => setShowRealTimeGraph(!showRealTimeGraph)}
                                    >
                                        {showRealTimeGraph ? '■ Hide' : '▶'} REAL-TIME GRAPH
                                    </button>
                                )}
                            </div>

                            <div className="flex flex-col gap-sm" style={{ marginTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-md)' }}>
                                <label className="data-label">Settings</label>
                                <div className="flex flex-col gap-sm">
                                    <label className="data-label">Bass Burst Threshold: {burstThreshold}</label>
                                    <input
                                        type="range"
                                        min={5}
                                        max={50}
                                        step={1}
                                        value={burstThreshold}
                                        onChange={e => setBurstThreshold(Number(e.target.value))}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div className="flex flex-col gap-sm">
                                    <label className="data-label">REAL-TIME THRESHOLD: {realTimeThreshold}</label>
                                    <input
                                        type="range"
                                        min={5}
                                        max={50}
                                        step={1}
                                        value={realTimeThreshold}
                                        onChange={e => setRealTimeThreshold(Number(e.target.value))}
                                        style={{ width: '100%' }}
                                    />
                                </div>

                                {/* OSC Configuration */}
                                <div className="flex flex-col gap-sm" style={{ marginTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-md)' }}>
                                    <label className="data-label">OSC Configuration</label>
                                    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                                        <div>
                                            <label className="data-label" style={{ fontSize: '0.7em' }}>In Port</label>
                                            <input
                                                type="text"
                                                value={oscInPort}
                                                onChange={e => setOscInPort(e.target.value)}
                                                style={{ width: '100%', padding: '4px', background: '#111', border: '1px solid #333', color: '#fff', fontSize: '0.8em' }}
                                            />
                                        </div>
                                        <div>
                                            <label className="data-label" style={{ fontSize: '0.7em' }}>Out Port</label>
                                            <input
                                                type="text"
                                                value={oscOutPort}
                                                onChange={e => setOscOutPort(e.target.value)}
                                                style={{ width: '100%', padding: '4px', background: '#111', border: '1px solid #333', color: '#fff', fontSize: '0.8em' }}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="data-label" style={{ fontSize: '0.7em' }}>Out IP (Target)</label>
                                        <input
                                            type="text"
                                            value={oscOutIp}
                                            onChange={e => setOscOutIp(e.target.value)}
                                            style={{ width: '100%', padding: '4px', background: '#111', border: '1px solid #333', color: '#fff', fontSize: '0.8em' }}
                                        />
                                    </div>
                                    <div className="status-text" style={{ fontSize: '0.7em', color: wsConnected ? 'var(--color-accent)' : '#666' }}>
                                        {wsConnected ? `Connected to Bridge` : `Disconnected`}
                                        {connectionError && <span style={{ color: '#f00' }}> - {connectionError}</span>}
                                    </div>
                                </div>
                                <div className="flex flex-col gap-sm">
                                    <label className="data-label">Trail Length: {trailLength}</label>
                                    <input
                                        type="range"
                                        min={2}
                                        max={20}
                                        step={1}
                                        value={trailLength}
                                        onChange={e => setTrailLength(Number(e.target.value))}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div className="flex flex-col gap-sm">
                                    <button
                                        className={`btn ${neuralCurvesEnabled ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setNeuralCurvesEnabled(!neuralCurvesEnabled)}
                                    >
                                        {neuralCurvesEnabled ? 'Curves Active' : 'Enable Curves'}
                                    </button>
                                </div>
                                <div className="flex flex-col gap-sm" style={{ marginTop: 'var(--space-md)' }}>
                                    <button
                                        className={`btn ${isTransparent ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setIsTransparent(!isTransparent)}
                                    >
                                        {isTransparent ? 'Transparent (Spout Ready)' : 'Standard Black'}
                                    </button>
                                </div>

                                {/* Export Controls */}
                                <div className="flex flex-col gap-sm" style={{ marginTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-md)' }}>
                                    <label className="data-label">Export</label>
                                    <div className="flex gap-sm">
                                        <button
                                            className="btn"
                                            onClick={() => {
                                                if (exportRef.current) {
                                                    exportRef.current.exportOBJ();
                                                } else {
                                                    console.error("Export ref is null");
                                                }
                                            }}
                                        >
                                            Export 3D (OBJ)
                                        </button>
                                        <button
                                            className="btn"
                                            onClick={handleExportSequence}
                                            disabled={isExporting}
                                        >
                                            {isExporting ? `Exporting ${exportProgress}%` : 'Export Sequence (ZIP)'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid-cell">
                        <h2>OSC Bridge</h2>
                        {connectionError && (
                            <div style={{ color: '#ff3333', marginBottom: 'var(--space-sm)', fontSize: '0.9em' }}>
                                {connectionError}
                            </div>
                        )}
                        <div className="flex flex-col gap-md">
                            <div className="flex flex-col gap-md">
                                <div className="flex flex-col">
                                    <label className="data-label">Input Port</label>
                                    <input
                                        type="text"
                                        value={oscInPort}
                                        onChange={e => setOscInPort(e.target.value)}
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="data-label">Output Port</label>
                                    <input
                                        type="text"
                                        value={oscOutPort}
                                        onChange={e => setOscOutPort(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col">
                                <label className="data-label">Output IP</label>
                                <input
                                    type="text"
                                    value={oscOutIp}
                                    onChange={e => setOscOutIp(e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col">
                                <label className="data-label">Last Received Message</label>
                                <div className="monitor-box" style={{
                                    padding: 'var(--space-sm)',
                                    border: '1px solid var(--color-border)',
                                    background: 'rgba(0,0,0,0.2)',
                                    fontFamily: 'monospace',
                                    color: 'var(--color-accent)',
                                    fontSize: '0.8em',
                                    minHeight: '2.5em',
                                    wordBreak: 'break-all'
                                }}>
                                    {lastOscMessage ? (
                                        <>
                                            <span style={{ color: '#fff' }}>{lastOscMessage.address}</span>
                                            <span style={{ marginLeft: '8px' }}>
                                                {lastOscMessage.args.map(String).join(', ')}
                                            </span>
                                        </>
                                    ) : '--'}
                                </div>
                            </div>

                            <button
                                className="btn"
                                onClick={toggleConnection}
                                style={{
                                    backgroundColor: wsConnected ? 'rgba(255, 51, 51, 0.1)' : 'rgba(0, 255, 65, 0.1)',
                                    color: wsConnected ? '#ff3333' : '#00ff41',
                                    borderColor: wsConnected ? '#ff3333' : '#00ff41'
                                }}
                            >
                                {wsConnected ? '■ Disconnect Bridge' : '▶ Connect Bridge'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="viz-section">
                    {showOrganoid && neurons.length > 0 && (
                        <div className="grid-cell">
                            <h2>Organoid Map (3D)</h2>
                            <Organoid3D
                                neurons={neurons}
                                spikes={visibleSpikes}
                                currentTime={playbackTime}
                                currentTimeRef={playbackTimeRef}
                                isPlaying={isPlaying || wsConnected}
                                burstThreshold={burstThreshold}
                                trailLength={trailLength}
                                isTransparent={isTransparent}
                                neuralCurvesEnabled={neuralCurvesEnabled}
                                lastFiringCount={lastFiringCount}
                                exportRef={exportRef}
                                spoutEnabled={spoutEnabled}
                            />
                        </div>
                    )}

                    {showSpikeAnalysis && visibleSpikes.length > 0 && (
                        <div className="grid-cell">
                            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                                <h2 style={{ margin: 0 }}>Activity Analysis</h2>
                            </div>
                            <SpikeActivityGraphs
                                spikes={visibleSpikes}
                                neurons={neurons}
                                currentTime={isPlaying ? playbackTime : undefined}
                            />
                        </div>
                    )}

                    {showPCA && visibleSpikes.length > 0 && (
                        <div className="grid-cell">
                            <h2 style={{ marginBottom: 'var(--space-md)' }}>PCA Trajectory (3D)</h2>
                            <PCA3D
                                spikes={visibleSpikes}
                                neurons={neurons}
                                binSizeMs={100}
                            />
                        </div>
                    )}

                    {showRealTimeGraph && allSpikesRef.current.length > 0 && (
                        <div className="grid-cell" style={{ gridColumn: '1 / -1' }}>
                            <h2 style={{ marginBottom: 'var(--space-md)' }}>REAL-TIME GRAPH</h2>
                            <RealTimeGraph
                                spikes={allSpikesRef.current}
                                neurons={neurons}
                                currentTime={playbackTime}
                                isPlaying={isPlaying}
                                threshold={realTimeThreshold}
                                width={1200}
                                height={400}
                                targetDuration={targetDuration}
                            />
                        </div>
                    )}

                    {!showOrganoid && !showSpikeAnalysis && !showPCA && !showRealTimeGraph && (
                        <div className="grid-cell" style={{ height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="status-text" style={{ opacity: 0.5 }}>
                                WAITING FOR DATA INPUT...
                            </div>
                        </div>
                    )}
                </div>

                <footer style={{ marginTop: 'var(--space-2xl)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--color-border)' }}>
                    <div className="status-text">Sampling Rate: 1kHz | Data-driven visualization</div>
                </footer>
            </div>
        </div >
    );
}

export default App;
