import React, { useRef, useEffect, useState } from 'react';
import { Neuron, SpikeEvent } from '../types';
import { computeHypergraphSequence, detectNearestBurst, HypergraphFrame, HypergraphTrack } from '../utils/hypergraphUtils';
import { saveAs } from 'file-saver';
import { Hypergraphs3D } from './Hypergraphs3D';

const getOffsetPathString = (points: [number, number][], offset: number): string => {
    if (points.length === 0) return "";
    if (points.length === 1) {
        const p = points[0];
        return `M ${p[0] - offset},${p[1]} A ${offset},${offset} 0 1,0 ${p[0] + offset},${p[1]} A ${offset},${offset} 0 1,0 ${p[0] - offset},${p[1]}`;
    }
    if (points.length === 2) {
        const p1 = points[0];
        const p2 = points[1];
        let dx = p2[0] - p1[0];
        let dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        dx /= len; dy /= len;
        const nx = dy; const ny = -dx;

        return `M ${p1[0] + nx * offset},${p1[1] + ny * offset} L ${p2[0] + nx * offset},${p2[1] + ny * offset} A ${offset},${offset} 0 0,1 ${p2[0] - nx * offset},${p2[1] - ny * offset} L ${p1[0] - nx * offset},${p1[1] - ny * offset} A ${offset},${offset} 0 0,1 ${p1[0] + nx * offset},${p1[1] + ny * offset} Z`;
    }

    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        area += p1[0] * p2[1] - p2[0] * p1[1];
    }
    const isCW = area > 0;

    const normals: [number, number][] = [];
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        let dx = p2[0] - p1[0];
        let dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len === 0) {
            normals.push([1, 0]);
            continue;
        }
        dx /= len; dy /= len;
        if (isCW) {
            normals.push([dy, -dx]);
        } else {
            normals.push([-dy, dx]);
        }
    }

    let path = "";
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const nPrev = normals[(i - 1 + normals.length) % normals.length];
        const nCurr = normals[i];

        const startX = p[0] + nPrev[0] * offset;
        const startY = p[1] + nPrev[1] * offset;
        const endX = p[0] + nCurr[0] * offset;
        const endY = p[1] + nCurr[1] * offset;

        if (i === 0) {
            path += `M ${startX},${startY} `;
        } else {
            path += `L ${startX},${startY} `;
        }

        const sweep = isCW ? 1 : 0;
        const dot = nPrev[0] * nCurr[0] + nPrev[1] * nCurr[1];
        if (dot < 0.999) {
            path += `A ${offset},${offset} 0 0,${sweep} ${endX},${endY} `;
        } else {
            path += `L ${endX},${endY} `;
        }
    }

    path += "Z";
    return path;
};

interface HypergraphsPanelProps {
    spikes: SpikeEvent[];
    neurons: Neuron[];
    currentTime: number;
    isPlaying: boolean;
    presentation?: boolean; // hide the settings sidebar and buttons, fit the view to the screen
    // We pass the global window end time from App.tsx (usually 180s) to know data bounds if needed
}

export const HypergraphsPanel: React.FC<HypergraphsPanelProps> = ({ spikes, neurons, currentTime, isPlaying, presentation = false }) => {
    // --- State: UI Settings ---
    const [binSizeMs, setBinSizeMs] = useState<number>(20);
    const [windowLengthSec, setWindowLengthSec] = useState<number>(3); // 1, 3, 10
    const [eps, setEps] = useState<number>(0.06); // typical organoid xy_norm range [0, 1]
    const [minSize, setMinSize] = useState<number>(3);
    const [freezeCompute, setFreezeCompute] = useState<boolean>(false);

    // --- State: View Mode ---
    const [viewMode, setViewMode] = useState<'2D' | '3D'>('2D');

    // --- State: Temporal Overlay (plot_620) Settings ---
    const [visStyle, setVisStyle] = useState<'SINGLE' | 'OVERLAY'>('SINGLE');
    const [overlayBins, setOverlayBins] = useState<number>(10);
    const [showLinks, setShowLinks] = useState<boolean>(true);
    const [matchThreshold, setMatchThreshold] = useState<number>(0.2);
    const [fadeOlder, setFadeOlder] = useState<boolean>(true);

    // --- State: Burst Snapshot Settings ---
    const [burstWindowMs, setBurstWindowMs] = useState<number>(200);
    const [burstSubBinMs, setBurstSubBinMs] = useState<number>(10);
    const [burstCenterMode, setBurstCenterMode] = useState<'AUTO' | 'CURRENT'>('AUTO');
    const [burstMaxLinkDist, setBurstMaxLinkDist] = useState<number>(0.2);
    const [enableMaxLinkDist, setEnableMaxLinkDist] = useState<boolean>(true);

    // The Snapshot frozen data
    const [frozenSnapshot, setFrozenSnapshot] = useState<{
        frames: HypergraphFrame[],
        tracks: HypergraphTrack[],
        t0: number,
        t1: number,
        peakTime?: number
    } | null>(null);

    // Determines if we are viewing the frozen snapshot or the live timeline
    const [showBurstSnapshot, setShowBurstSnapshot] = useState<boolean>(false);


    // --- State: Computed Data ---
    const [, setCurrentFrames] = useState<HypergraphFrame[]>([]);
    const [latestFrame, setLatestFrame] = useState<HypergraphFrame | null>(null);
    const [currentTracks, setCurrentTracks] = useState<HypergraphTrack[]>([]);
    const [overlayFrames, setOverlayFrames] = useState<HypergraphFrame[]>([]);

    // --- Refs ---
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

    // Track last computation time to avoid excessive re-renders when paused
    const lastComputeTimeRef = useRef(-1);

    // --- Resize Observer ---
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateSize = () => {
            const rect = container.getBoundingClientRect();
            setDimensions({
                width: rect.width || 800,
                height: rect.height || 600
            });
        };

        updateSize();
        const ro = new ResizeObserver(updateSize);
        ro.observe(container);
        return () => ro.disconnect();
    }, [viewMode]); // the 2D container is remounted after a trip through 3D

    // --- Computation Logic ---
    useEffect(() => {
        if (freezeCompute) return;

        // Only recompute if time actually moved or settings changed
        // We throttle slightly by checking if it's the exact same ms
        if (!isPlaying && lastComputeTimeRef.current === currentTime) return;

        // In real-time mode, we only care about the most recent frame or a short window.
        // For UI simplicity to display a single frame, we just compute the frame containing 'currentTime'.
        // Or we can compute the sequence and just show the last one.

        // For OVERLAY or 3D mode, we compute an exact window of `overlayBins * binSizeMs` ending at currentTime
        let computeWindowLengthMs = windowLengthSec * 1000;
        let isOverlayOr3D = visStyle === 'OVERLAY' || viewMode === '3D';
        if (isOverlayOr3D) {
            computeWindowLengthMs = overlayBins * binSizeMs;
        }

        // --- Suspend standard rolling computation if viewing a frozen snapshot ---
        if (showBurstSnapshot && frozenSnapshot) {
            return;
        }

        const sequenceData = computeHypergraphSequence(
            spikes,
            neurons,
            currentTime,
            computeWindowLengthMs,
            binSizeMs,
            eps,
            minSize,
            isOverlayOr3D, // computeTracks
            matchThreshold
        );

        setCurrentFrames(sequenceData.frames);
        if (sequenceData.frames.length > 0) {
            setLatestFrame(sequenceData.frames[sequenceData.frames.length - 1]);
        } else {
            setLatestFrame(null);
        }

        if (isOverlayOr3D) {
            setOverlayFrames(sequenceData.frames);
            setCurrentTracks(sequenceData.tracks);
        } else {
            setOverlayFrames([]);
            setCurrentTracks([]);
        }

        lastComputeTimeRef.current = currentTime;

    }, [currentTime, isPlaying, freezeCompute, binSizeMs, windowLengthSec, eps, minSize, visStyle, viewMode, overlayBins, matchThreshold, spikes, neurons]);

    // --- Colors ---
    const getEdgeColor = (idx: number) => {
        const colors = [
            '#ff0055', '#00ffcc', '#ffaa00', '#aa00ff',
            '#00aaff', '#ff00aa', '#aaff00', '#55ff00'
        ];
        return colors[idx % colors.length];
    };

    // --- Burst Snapshot Compute ---
    const handleComputeBurstSnapshot = () => {
        let t0 = 0;
        let t1 = 0;
        let peakTime: number | undefined;

        if (burstCenterMode === 'CURRENT') {
            t0 = Math.max(0, currentTime - burstWindowMs / 2);
            t1 = t0 + burstWindowMs;
            peakTime = currentTime;
        } else {
            // Auto-detect mode
            const result = detectNearestBurst(spikes, currentTime, 5000, burstWindowMs, 4);
            if (result) {
                t0 = result.t0;
                t1 = result.t1;
                peakTime = result.peakTime;
            } else {
                alert("No burst detected near current time. Try 'Use current time' instead.");
                return;
            }
        }

        const sequenceData = computeHypergraphSequence(
            spikes,
            neurons,
            t1, // Current Time (end of the window)
            burstWindowMs, // Window Length
            burstSubBinMs, // Bin Size
            eps,
            minSize,
            true, // Always track in Burst
            matchThreshold,
            enableMaxLinkDist ? burstMaxLinkDist : undefined
        );

        setFrozenSnapshot({
            frames: sequenceData.frames,
            tracks: sequenceData.tracks,
            t0,
            t1,
            peakTime
        });
        setShowBurstSnapshot(true);
    };

    const handleClearBurstSnapshot = () => {
        setShowBurstSnapshot(false);
        setFrozenSnapshot(null);
    };

    // --- Rendering ---
    const drawFrame = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Use standard layout limits (drawing units); presentation scales them to fit the box
        const width = 800;
        const height = 800;
        const size = presentation ? Math.max(200, Math.floor(Math.min(dimensions.width, dimensions.height))) : width;

        // Handle high DPI displays
        const dpr = window.devicePixelRatio || 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;

        ctx.scale((dpr * size) / width, (dpr * size) / height);
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;

        // Clear canvas
        ctx.fillStyle = '#050505'; // very dark background
        ctx.fillRect(0, 0, width, height);

        // Helper: Convert normalized coordinates to canvas space
        const PADDING = 20;
        const plotW = width - PADDING * 2;
        const plotH = height - PADDING * 2;

        const toCx = (nx: number) => PADDING + nx * plotW;
        const toCy = (ny: number) => PADDING + (1 - ny) * plotH; // Flip Y so 0 is bottom

        // 1. Draw all neurons faintly in background
        ctx.fillStyle = '#333333';
        neurons.forEach(n => {
            ctx.beginPath();
            ctx.arc(toCx(n.xy_norm_0), toCy(n.xy_norm_1), 2, 0, Math.PI * 2);
            ctx.fill();
        });

        // Resolve data source (Live vs Snapshot)
        const isSnapshotView = showBurstSnapshot && frozenSnapshot;
        let activeFramesToDraw: HypergraphFrame[] = [];
        let activeTracks: HypergraphTrack[] = [];
        let activeLatestFrame: HypergraphFrame | null = null;

        if (isSnapshotView) {
            activeFramesToDraw = frozenSnapshot!.frames;
            activeTracks = showLinks ? frozenSnapshot!.tracks : [];
            activeLatestFrame = frozenSnapshot!.frames.length > 0 ? frozenSnapshot!.frames[frozenSnapshot!.frames.length - 1] : null;
        } else {
            activeFramesToDraw = visStyle === 'OVERLAY' ? overlayFrames : (latestFrame ? [latestFrame] : []);
            activeTracks = visStyle === 'OVERLAY' && showLinks ? currentTracks : [];
            activeLatestFrame = latestFrame;
        }

        // 2. Draw Hyperedges (Convex Hulls with offset)
        activeFramesToDraw.forEach((frame, fIdx) => {
            const age = activeFramesToDraw.length - 1 - fIdx;

            // In snapshot, fade older makes sense as well
            let opacity = 1.0;
            if ((visStyle === 'OVERLAY' || isSnapshotView) && fadeOlder) {
                opacity = Math.max(0.15, 1.0 - (age * 0.15));
            }

            frame.hyperedges.forEach((edge, idx) => {
                const colorIdx = edge.trackId !== undefined ? edge.trackId : idx;
                const color = getEdgeColor(colorIdx);

                if (edge.hull.length >= 1) {
                    const mappedPoints = edge.hull.map(p => [toCx(p[0]), toCy(p[1])] as [number, number]);
                    const pathStr = getOffsetPathString(mappedPoints, 15); // 15px offset
                    const p2d = new Path2D(pathStr);

                    // Outline bold
                    ctx.globalAlpha = opacity;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.stroke(p2d);
                }
            });
        });

        // 3. Draw Propagation Links
        if (activeTracks.length > 0) {
            activeTracks.forEach(track => {
                if (track.centroids.length < 2) return;
                const color = getEdgeColor(track.colorIndex);
                ctx.globalAlpha = 0.8;
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();

                track.centroids.forEach((c, i) => {
                    const cx = toCx(c.x);
                    const cy = toCy(c.y);
                    if (i === 0) ctx.moveTo(cx, cy);
                    else ctx.lineTo(cx, cy);
                });
                ctx.stroke();

                // Draw solid dots at centroids
                track.centroids.forEach((c, i) => {
                    const cx = toCx(c.x);
                    const cy = toCy(c.y);
                    ctx.beginPath();
                    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
                    ctx.fill();

                    // Arrowhead at the newest centroid
                    if (i === track.centroids.length - 1 && i > 0) {
                        const prevC = track.centroids[i - 1];
                        const px = toCx(prevC.x);
                        const py = toCy(prevC.y);
                        const angle = Math.atan2(cy - py, cx - px);
                        const arrowLen = 10;
                        ctx.beginPath();
                        ctx.moveTo(cx, cy);
                        ctx.lineTo(cx - arrowLen * Math.cos(angle - Math.PI / 6), cy - arrowLen * Math.sin(angle - Math.PI / 6));
                        ctx.lineTo(cx - arrowLen * Math.cos(angle + Math.PI / 6), cy - arrowLen * Math.sin(angle + Math.PI / 6));
                        ctx.closePath();
                        ctx.fill();
                    }
                });
            });
        }
        ctx.globalAlpha = 1.0;

        // 4. Draw Active Neurons with labels (Only for current latest frame or active snapshot bins)
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (activeLatestFrame && !isSnapshotView) { // Only draw for the single latest frame in live mode
            activeLatestFrame.activeNeurons.forEach(nid => {
                const n = neurons.find(x => x.neuron_id === nid);
                if (!n) return;

                const cx = toCx(n.xy_norm_0);
                const cy = toCy(n.xy_norm_1);

                ctx.beginPath();
                ctx.arc(cx, cy, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();

                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.fillText(nid.toString(), cx, cy - 10);
            });
        } else if (isSnapshotView && frozenSnapshot) {
            // In snapshot view, optionally draw all active neurons across the window if desired, or skip to declutter.
            // For now, we'll skip drawing individual active neurons in snapshot view to avoid clutter.
            // If needed, we could iterate through all frames in frozenSnapshot and draw their active neurons.
        }

        // Add info overlay
        ctx.fillStyle = '#00ffcc';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = '12px monospace';

        if (isSnapshotView && frozenSnapshot) {
            ctx.fillStyle = '#ff0055';
            ctx.fillText(`BURST SNAPSHOT [${frozenSnapshot.frames.length} bins]`, 10, 10);
            ctx.fillStyle = '#00ffcc';
            ctx.fillText(`Burst Window: ${(frozenSnapshot.t0 / 1000).toFixed(2)}s - ${(frozenSnapshot.t1 / 1000).toFixed(2)}s`, 10, 25);
            if (frozenSnapshot.peakTime) {
                ctx.fillText(`Detected Peak: ${(frozenSnapshot.peakTime / 1000).toFixed(2)}s`, 10, 40);
            }
        } else if (latestFrame) {
            ctx.fillText(`Time: ${(latestFrame.timeStart / 1000).toFixed(2)}s - ${(latestFrame.timeEnd / 1000).toFixed(2)}s`, 10, 10);
            ctx.fillText(`Active Neurons: ${latestFrame.activeNeurons.length}`, 10, 25);
            ctx.fillText(`Hyperedges: ${latestFrame.hyperedges.length}`, 10, 40);
        }
    };

    useEffect(() => {
        drawFrame();
    }, [dimensions, presentation, latestFrame, neurons, showBurstSnapshot, frozenSnapshot, visStyle, overlayFrames, currentTracks, showLinks, fadeOlder]); // redraw if data or size changes


    // --- SVG Export generation ---
    const generateSVGString = () => {
        const isSnapshotView = showBurstSnapshot && frozenSnapshot;
        if (!latestFrame && !isSnapshotView) return "";
        const width = 800;
        const height = 800;

        const PADDING = 20;
        const plotW = width - PADDING * 2;
        const plotH = height - PADDING * 2;

        const toCx = (nx: number) => PADDING + nx * plotW;
        const toCy = (ny: number) => PADDING + (1 - ny) * plotH;

        let activeFramesToDraw: HypergraphFrame[] = [];
        let activeTracks: HypergraphTrack[] = [];
        let activeLatestFrame: HypergraphFrame | null = null;

        if (isSnapshotView) {
            activeFramesToDraw = frozenSnapshot!.frames;
            activeTracks = showLinks ? frozenSnapshot!.tracks : [];
            activeLatestFrame = frozenSnapshot!.frames.length > 0 ? frozenSnapshot!.frames[frozenSnapshot!.frames.length - 1] : null;
        } else {
            activeFramesToDraw = visStyle === 'OVERLAY' ? overlayFrames : (latestFrame ? [latestFrame] : []);
            activeTracks = visStyle === 'OVERLAY' && showLinks ? currentTracks : [];
            activeLatestFrame = latestFrame;
        }

        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background-color: #050505;">\n`;

        // Background neurons
        svg += `  <g id="background-neurons">\n`;
        neurons.forEach(n => {
            svg += `    <circle cx="${toCx(n.xy_norm_0)}" cy="${toCy(n.xy_norm_1)}" r="2" fill="#333333" />\n`;
        });
        svg += `  </g>\n`;

        // Hyperedges
        svg += `  <g id="hyperedges">\n`;

        activeFramesToDraw.forEach((frame, fIdx) => {
            const age = activeFramesToDraw.length - 1 - fIdx;

            let opacity = 1.0;
            if ((visStyle === 'OVERLAY' || isSnapshotView) && fadeOlder) {
                opacity = Math.max(0.15, 1.0 - (age * 0.15));
            }

            frame.hyperedges.forEach((edge, idx) => {
                const colorIdx = edge.trackId !== undefined ? edge.trackId : idx;
                const color = getEdgeColor(colorIdx);

                if (edge.hull.length >= 1) {
                    const mappedPoints = edge.hull.map(p => [toCx(p[0]), toCy(p[1])] as [number, number]);
                    const pathStr = getOffsetPathString(mappedPoints, 15);
                    svg += `    <path d="${pathStr}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.5" />\n`;
                }
            });
        });
        svg += `  </g>\n`;

        // Propagation Links
        if (activeTracks.length > 0) {
            svg += `  <g id="propagation-links">\n`;
            activeTracks.forEach(track => {
                if (track.centroids.length < 2) return;
                const color = getEdgeColor(track.colorIndex);

                let pointsStr = track.centroids.map(c => `${toCx(c.x)},${toCy(c.y)}`).join(" ");
                svg += `    <polyline points="${pointsStr}" fill="none" stroke="${color}" stroke-opacity="0.8" stroke-width="1.5" />\n`;

                track.centroids.forEach((c, i) => {
                    const cx = toCx(c.x);
                    const cy = toCy(c.y);
                    svg += `    <circle cx="${cx}" cy="${cy}" r="3" fill="${color}" fill-opacity="0.8" />\n`;

                    if (i === track.centroids.length - 1 && i > 0) {
                        const prevC = track.centroids[i - 1];
                        const px = toCx(prevC.x);
                        const py = toCy(prevC.y);
                        const angle = Math.atan2(cy - py, cx - px);
                        const arrowLen = 10;
                        const p1x = cx - arrowLen * Math.cos(angle - Math.PI / 6);
                        const p1y = cy - arrowLen * Math.sin(angle - Math.PI / 6);
                        const p2x = cx - arrowLen * Math.cos(angle + Math.PI / 6);
                        const p2y = cy - arrowLen * Math.sin(angle + Math.PI / 6);
                        svg += `    <polygon points="${cx},${cy} ${p1x},${p1y} ${p2x},${p2y}" fill="${color}" fill-opacity="0.8" />\n`;
                    }
                });
            });
            svg += `  </g>\n`;
        }

        // Active Neurons and Labels
        svg += `  <g id="active-neurons">\n`;
        if (activeLatestFrame && !isSnapshotView) {
            activeLatestFrame.activeNeurons.forEach(nid => {
                const n = neurons.find(x => x.neuron_id === nid);
                if (!n) return;
                const cx = toCx(n.xy_norm_0);
                const cy = toCy(n.xy_norm_1);

                svg += `    <circle cx="${cx}" cy="${cy}" r="3" fill="#ffffff" />\n`;
                svg += `    <text x="${cx}" y="${cy - 10}" fill="rgba(255,255,255,0.7)" font-family="monospace" font-size="10" text-anchor="middle">${nid}</text>\n`;
            });
        }
        svg += `  </g>\n`;

        // Info Overlay
        if (isSnapshotView && frozenSnapshot) {
            svg += `  <text x="10" y="20" fill="#ff0055" font-size="12" font-family="monospace">BURST SNAPSHOT [${frozenSnapshot.frames.length} bins]</text>\n`;
            svg += `  <text x="10" y="35" fill="#00ffcc" font-size="12" font-family="monospace">Burst Window: ${(frozenSnapshot.t0 / 1000).toFixed(2)}s - ${(frozenSnapshot.t1 / 1000).toFixed(2)}s</text>\n`;
            if (frozenSnapshot.peakTime) {
                svg += `  <text x="10" y="50" fill="#00ffcc" font-size="12" font-family="monospace">Detected Peak: ${(frozenSnapshot.peakTime / 1000).toFixed(2)}s</text>\n`;
            }
        } else if (latestFrame) {
            svg += `  <text x="10" y="20" fill="#00ffcc" font-size="12" font-family="monospace">Time: ${(latestFrame.timeStart / 1000).toFixed(2)}s - ${(latestFrame.timeEnd / 1000).toFixed(2)}s</text>\n`;
            svg += `  <text x="10" y="35" fill="#00ffcc" font-size="12" font-family="monospace">Active Neurons: ${latestFrame.activeNeurons.length}</text>\n`;
            svg += `  <text x="10" y="50" fill="#00ffcc" font-size="12" font-family="monospace">Hyperedges: ${latestFrame.hyperedges.length}</text>\n`;
        }

        svg += `</svg>`;
        return svg;
    };

    const handleExportPNG = () => {
        if (canvasRef.current) {
            const dataUrl = canvasRef.current.toDataURL("image/png");
            saveAs(dataUrl, `hypergraph_${currentTime}.png`);
        }
    };

    const handleExportSVG = () => {
        const svgString = generateSVGString();
        if (svgString) {
            const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
            saveAs(blob, `hypergraph_${currentTime}.svg`);
        }
    };

    return (
        <div className="data-panel" style={{ height: '100%' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                <h2>Hypergraphs View</h2>

                {!presentation && <div className="flex gap-sm">
                    <button className="btn" onClick={handleExportPNG}>Export PNG</button>
                    <button className="btn" onClick={handleExportSVG}>Export SVG</button>
                    <button
                        className={`btn ${freezeCompute ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setFreezeCompute(!freezeCompute)}
                        style={{ marginLeft: 'var(--space-md)' }}
                    >
                        {freezeCompute ? '▶ Resume Compute' : '■ Freeze Compute'}
                    </button>
                </div>}
            </div>

            <div className="grid" style={{ gridTemplateColumns: '1fr 3fr', gap: 'var(--space-md)' }}>
                {/* Controls Sidebar */}
                {!presentation && <div className="flex flex-col gap-md" style={{ background: 'rgba(0,0,0,0.2)', padding: 'var(--space-md)', borderRight: '1px solid var(--color-border)' }}>

                    <div className="flex flex-col gap-sm">
                        <label className="data-label">Bin Size: {binSizeMs} ms</label>
                        <select
                            value={binSizeMs}
                            onChange={(e) => setBinSizeMs(Number(e.target.value))}
                            style={{ background: '#111', color: '#fff', padding: '4px', border: '1px solid #333' }}
                        >
                            <option value={10}>10 ms</option>
                            <option value={20}>20 ms</option>
                            <option value={50}>50 ms</option>
                            <option value={100}>100 ms</option>
                            <option value={200}>200 ms</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-sm">
                        <label className="data-label">Analysis Window: {windowLengthSec} s</label>
                        <select
                            value={windowLengthSec}
                            onChange={(e) => setWindowLengthSec(Number(e.target.value))}
                            style={{ background: '#111', color: '#fff', padding: '4px', border: '1px solid #333' }}
                        >
                            <option value={1}>1 s</option>
                            <option value={3}>3 s</option>
                            <option value={10}>10 s</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-sm">
                        <div className="flex justify-between">
                            <label className="data-label">Spatial Threshold (eps)</label>
                            <span className="data-value">{eps.toFixed(3)}</span>
                        </div>
                        <input
                            type="range"
                            min={0.01} max={0.5} step={0.01}
                            value={eps}
                            onChange={(e) => setEps(Number(e.target.value))}
                        />
                    </div>

                    <div className="flex flex-col gap-sm">
                        <label className="data-label">Min Hyperedge Size: {minSize}</label>
                        <select
                            value={minSize}
                            onChange={(e) => setMinSize(Number(e.target.value))}
                            style={{ background: '#111', color: '#fff', padding: '4px', border: '1px solid #333' }}
                        >
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                            <option value={4}>4</option>
                            <option value={5}>5</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-sm">
                        <label className="data-label">Viewport Mode</label>
                        <select
                            value={viewMode}
                            onChange={(e) => setViewMode(e.target.value as '2D' | '3D')}
                            style={{ background: '#111', color: '#fff', padding: '4px', border: '1px solid #333', fontWeight: 'bold' }}
                        >
                            <option value="2D">2D Canvas Outline</option>
                            <option value="3D">3D Temporal Stacks</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-sm">
                        <label className="data-label">Visualization Style (2D Only)</label>
                        <select
                            value={visStyle}
                            onChange={(e) => setVisStyle(e.target.value as 'SINGLE' | 'OVERLAY')}
                            style={{ background: '#111', color: '#fff', padding: '4px', border: '1px solid #333' }}
                            disabled={viewMode === '3D'}
                        >
                            <option value="SINGLE">Single-frame (current)</option>
                            <option value="OVERLAY">Temporal Overlay / Propagation</option>
                        </select>
                    </div>

                    {(visStyle === 'OVERLAY' || viewMode === '3D') && (
                        <div className="flex flex-col gap-sm" style={{ paddingLeft: '8px', borderLeft: '2px solid var(--color-accent)' }}>
                            <label className="data-label">Time Window (bins): {overlayBins}</label>
                            <select
                                value={overlayBins}
                                onChange={(e) => setOverlayBins(Number(e.target.value))}
                                style={{ background: '#111', color: '#fff', padding: '4px', border: '1px solid #333' }}
                            >
                                <option value={5}>5 bins</option>
                                <option value={10}>10 bins</option>
                                <option value={20}>20 bins</option>
                                <option value={50}>50 bins</option>
                                <option value={100}>100 bins</option>
                            </select>

                            <div className="flex justify-between items-center" style={{ marginTop: '8px' }}>
                                <label className="data-label">Show propagation links</label>
                                <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
                            </div>

                            <div className="flex justify-between items-center">
                                <label className="data-label">Fade older bins</label>
                                <input type="checkbox" checked={fadeOlder} onChange={(e) => setFadeOlder(e.target.checked)} disabled={viewMode === '3D'} />
                            </div>

                            <div className="flex flex-col gap-xs" style={{ marginTop: '8px' }}>
                                <div className="flex justify-between">
                                    <label className="data-label">Match Threshold (Jaccard)</label>
                                    <span className="data-value">{matchThreshold.toFixed(2)}</span>
                                </div>
                                <input
                                    type="range"
                                    min={0.0} max={0.8} step={0.05}
                                    value={matchThreshold}
                                    onChange={(e) => setMatchThreshold(Number(e.target.value))}
                                />
                            </div>
                        </div>
                    )}

                    {/* Burst Snapshot Controls */}
                    <div style={{ paddingTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
                        <label className="data-label">Burst Snapshot</label>
                        <div className="flex flex-col gap-sm">
                            <div className="flex justify-between items-center">
                                <label className="data-label">Window Size: {burstWindowMs} ms</label>
                                <input
                                    type="range"
                                    min={100} max={1000} step={50}
                                    value={burstWindowMs}
                                    onChange={(e) => setBurstWindowMs(Number(e.target.value))}
                                />
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="data-label">Sub-Bin Size: {burstSubBinMs} ms</label>
                                <select
                                    value={burstSubBinMs}
                                    onChange={(e) => setBurstSubBinMs(Number(e.target.value))}
                                    style={{ background: '#111', color: '#fff', padding: '4px', border: '1px solid #333' }}
                                >
                                    <option value={5}>5 ms</option>
                                    <option value={10}>10 ms</option>
                                    <option value={20}>20 ms</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="data-label">Center Mode:</label>
                                <select
                                    value={burstCenterMode}
                                    onChange={(e) => setBurstCenterMode(e.target.value as 'AUTO' | 'CURRENT')}
                                    style={{ background: '#111', color: '#fff', padding: '4px', border: '1px solid #333' }}
                                >
                                    <option value="AUTO">Auto-detect burst</option>
                                    <option value="CURRENT">Use current time</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center">
                                <label className="data-label">Max Link Dist: {burstMaxLinkDist.toFixed(2)}</label>
                                <input type="checkbox" checked={enableMaxLinkDist} onChange={(e) => setEnableMaxLinkDist(e.target.checked)} />
                            </div>
                            {enableMaxLinkDist && (
                                <input
                                    type="range"
                                    min={0.05} max={0.5} step={0.05}
                                    value={burstMaxLinkDist}
                                    onChange={(e) => setBurstMaxLinkDist(Number(e.target.value))}
                                />
                            )}
                            <div className="flex gap-sm" style={{ marginTop: '8px' }}>
                                <button className="btn btn-primary" onClick={handleComputeBurstSnapshot}>
                                    Capture Burst
                                </button>
                                <button className="btn btn-secondary" onClick={handleClearBurstSnapshot} disabled={!showBurstSnapshot}>
                                    Clear Snapshot
                                </button>
                            </div>
                        </div>
                    </div>

                    <div style={{ marginTop: 'auto', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
                        <div className="data-label">Status</div>
                        <div className="status-text" style={{ color: freezeCompute ? '#ff6b6b' : '#00ffcc' }}>
                            {freezeCompute ? 'COMPUTATION PAUSED' : 'REAL-TIME ACTIVE'}
                        </div>
                    </div>

                    {(visStyle === 'OVERLAY' || viewMode === '3D' || showBurstSnapshot) && (
                        <div style={{ paddingTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
                            <div className="data-label">Debug Stats</div>
                            <div className="status-text" style={{ fontSize: '10px', marginTop: '4px', color: '#aaa', display: 'flex', flexDirection: 'column', gap: '4px' }}>

                                {showBurstSnapshot && frozenSnapshot ? (
                                    <>
                                        <div style={{ color: 'var(--color-accent)' }}>[FROZEN SNAPSHOT]</div>
                                        <div>Bins: {frozenSnapshot.frames.length} @ {burstSubBinMs}ms</div>
                                        <div>Tracks Found: {frozenSnapshot.tracks.length}</div>
                                        <div>Avg Edges/Bin: {(frozenSnapshot.frames.length ? (frozenSnapshot.frames.reduce((acc, f) => acc + f.hyperedges.length, 0) / frozenSnapshot.frames.length) : 0).toFixed(1)}</div>
                                    </>
                                ) : (
                                    <>
                                        <div>Bins: {overlayBins} @ {binSizeMs}ms</div>
                                        <div>Tracks Found: {currentTracks.length}</div>
                                        <div>Avg Edges/Bin: {(overlayFrames.length ? (overlayFrames.reduce((acc, f) => acc + f.hyperedges.length, 0) / overlayFrames.length) : 0).toFixed(1)}</div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>}

                {/* Viewport Area */}
                {viewMode === '2D' ? (
                    <div ref={containerRef} className="viz-canvas" style={{
                        position: 'relative',
                        ...(presentation
                            ? { width: '100%', aspectRatio: '1', maxHeight: 'var(--pres-fit)', minHeight: 0 }
                            : { minHeight: '600px' }),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        border: showBurstSnapshot && frozenSnapshot ? '2px solid var(--color-accent)' : undefined
                    }}>
                        <canvas ref={canvasRef} style={{ display: 'block', margin: '0 auto' }} />
                    </div>
                ) : (
                    <div className="viz-canvas" style={{
                        // Hypergraphs3D's own sizing classes have no CSS; in presentation a grid
                        // stretches it to the tile (one column tall, wider when spanning) so its canvas fills it.
                        ...(presentation
                            ? { display: 'grid', width: '100%', aspectRatio: 'var(--pres-span)', maxHeight: 'var(--pres-fit)', overflow: 'hidden' }
                            : { minHeight: '600px' }),
                        border: showBurstSnapshot && frozenSnapshot ? '2px solid var(--color-accent)' : undefined
                    }}>
                        <Hypergraphs3D
                            frames={showBurstSnapshot && frozenSnapshot ? frozenSnapshot.frames : overlayFrames}
                            tracks={(showBurstSnapshot && frozenSnapshot) ? frozenSnapshot.tracks : (showLinks ? currentTracks : [])}
                            neurons={neurons}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
