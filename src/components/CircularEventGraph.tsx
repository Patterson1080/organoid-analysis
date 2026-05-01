import React, { useRef, useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Neuron, SpikeEvent } from '../types';
import { saveAs } from 'file-saver';

// --- Detached Window Portal ---
const DetachedWindow = ({ children, title, onClose }: { children: React.ReactNode, title: string, onClose: () => void }) => {
    const [container, setContainer] = useState<HTMLDivElement | null>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const w = window.open('', '', 'width=1920,height=1920');
        if (!w) {
            alert('Popup blocked. Please allow popups for this site to detach the graph.');
            onCloseRef.current();
            return;
        }

        w.document.title = title || 'Detached Window';

        // Copy all stylesheets from main window
        const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
        styles.forEach(style => {
            w.document.head.appendChild(style.cloneNode(true));
        });

        // Set matching background
        w.document.body.style.backgroundColor = '#000';
        w.document.body.style.color = '#fff';
        w.document.body.style.margin = '0';
        w.document.body.style.padding = '0';

        const rootDiv = w.document.createElement('div');
        rootDiv.style.width = '100vw';
        rootDiv.style.height = '100vh';
        rootDiv.style.display = 'flex';
        rootDiv.style.flexDirection = 'column';
        rootDiv.style.justifyContent = 'center';
        rootDiv.style.alignItems = 'center';
        rootDiv.style.boxSizing = 'border-box';
        rootDiv.style.overflow = 'hidden';
        w.document.body.appendChild(rootDiv);

        setContainer(rootDiv);

        let isClosingProgrammatically = false;

        w.addEventListener('beforeunload', () => {
            if (!isClosingProgrammatically) {
                onCloseRef.current();
            }
        });

        return () => {
            isClosingProgrammatically = true;
            w.close();
        };
    }, []); // Empty dependency array so it only runs once on mount

    if (!container) return null;
    return createPortal(children, container);
};

interface CircularEventGraphProps {
    spikes: SpikeEvent[];
    neurons: Neuron[];
    currentTime: number;
    width?: number;
    height?: number;
    exportResolution?: number;
    targetDuration?: number; // seconds, for sequence export
    mode?: 'topology' | 'regions'; // 'topology' = main graph, 'regions' = cluster-arc variant
    showZoomWindow?: boolean;      // rotating clock-index zoom overlay
    onTimeScrub?: (newTime: number) => void;
    onScrubStateChange?: (isScrubbing: boolean) => void;
    onCenterTap?: () => void;
}

// --- Color helper: electric blue → bright red intensity gradient ---
// activity in [0..1], alpha applied on top.
// low  (0.0): electric blue  ( 30, 150, 255)
// mid  (0.5): vivid magenta  (220,  60, 200)
// high (1.0): bright red     (255,  30,  30)
function activityColor(activity: number, alpha: number, whiter: boolean = false): string {
    const a = Math.max(0, Math.min(1, activity));
    let r: number, g: number, b: number;
    if (a < 0.5) {
        const t = a / 0.5;
        r = Math.round(30  + t * (220 -  30));
        g = Math.round(150 + t * (60  - 150));
        b = Math.round(255 + t * (200 - 255));
    } else {
        const t = (a - 0.5) / 0.5;
        r = Math.round(220 + t * (255 - 220));
        g = Math.round(60  + t * (30  -  60));
        b = Math.round(200 + t * (30  - 200));
    }
    if (whiter) {
        r = Math.round(r + (255 - r) * 0.75);
        g = Math.round(g + (255 - g) * 0.75);
        b = Math.round(b + (255 - b) * 0.75);
    }
    return `rgba(${r},${g},${b},${alpha})`;
}

// --- Symmetry Mode Types ---
type SymmetryOrder = 3 | 5 | 7 | 9;

interface SymmetryState {
    active: boolean;
    order: SymmetryOrder;
    intensity: number;       // 0..1, how strongly symmetry is applied
    breakAmount: number;     // 0..1, how much the symmetry is broken
    phase: number;           // rotation offset in radians
    attractorPoints: { x: number; y: number }[];
}

// --- Symmetric Chaotic Attractor (Field & Golubitsky style) ---
// Iterates f(z) = λz + αz̄^(n-1) + β|z|^2·z in the complex plane
// with D_n symmetry built into the map
function computeAttractorPoints(
    order: number,
    numPoints: number,
    seed: number,
    lambda: number = -0.5,
    alpha: number = 1.0,
    beta: number = -0.1
): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    let zr = 0.1 + (seed % 100) * 0.001;
    let zi = 0.1 - (seed % 73) * 0.001;

    const n = order;
    // Iterate the symmetric map
    for (let i = 0; i < numPoints + 200; i++) {
        // z^(n-1) conjugated: (x - iy)^(n-1)
        let conjPowR = 1, conjPowI = 0;
        for (let k = 0; k < n - 1; k++) {
            const newR = conjPowR * zr + conjPowI * zi; // conjugate: (zr, -zi) but we handle it
            const newI = conjPowI * zr - conjPowR * zi;
            conjPowR = newR;
            conjPowI = newI;
        }
        // Actually need conjugate of z raised to n-1
        // z̄ = (zr, -zi), z̄^(n-1)
        let cR = zr, cI = -zi;
        let cpR = 1, cpI = 0;
        for (let k = 0; k < n - 1; k++) {
            const nr = cpR * cR - cpI * cI;
            const ni = cpR * cI + cpI * cR;
            cpR = nr;
            cpI = ni;
        }

        const mod2 = zr * zr + zi * zi;
        const newZr = lambda * zr + alpha * cpR + beta * mod2 * zr;
        const newZi = lambda * zi + alpha * cpI + beta * mod2 * zi;

        zr = newZr;
        zi = newZi;

        // Clamp to prevent divergence
        const mod = Math.sqrt(zr * zr + zi * zi);
        if (mod > 2.0) {
            zr *= 1.8 / mod;
            zi *= 1.8 / mod;
        }

        if (i >= 200) {
            points.push({ x: zr, y: zi });
        }
    }
    return points;
}

export const CircularEventGraph: React.FC<CircularEventGraphProps> = ({
    spikes,
    neurons,
    currentTime,
    width = 800,
    height = 800,
    exportResolution = 2048,
    targetDuration = 10,
    mode = 'topology',
    showZoomWindow = true,
    title,
    onTimeScrub,
    onScrubStateChange,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [isDetached, setIsDetached] = useState(false);
    
    // Scrubbing state
    const scrubRef = useRef({ active: false, lastAngle: 0 });


    // Accumulate spike counts per neuron
    const spikeCountsRef = useRef<Map<number, number>>(new Map());
    const lastTimeRef = useRef(0);

    // Active connections with fade
    type ResolvedGeometry = { id: number, cx: number, cy: number, ux: number, uy: number, angle: number, isBackbone: boolean, textAngle: number };
    const activeLinksRef = useRef<{ sourceId: number; targetId: number; time: number; strength: number; g1: ResolvedGeometry; g2: ResolvedGeometry }[]>([]);

    // Firing rate history for burst detection
    const firingHistoryRef = useRef<{ time: number; count: number }[]>([]);
    const baselineRateRef = useRef(0);

    // Symmetry state
    const symmetryRef = useRef<SymmetryState>({
        active: false,
        order: 5,
        intensity: 0,
        breakAmount: 0,
        phase: 0,
        attractorPoints: [],
    });

    // Animation time for smooth transitions
    const animTimeRef = useRef(0);

    const maxNeuronId = useMemo(() =>
        neurons.length > 0 ? Math.max(...neurons.map(n => n.neuron_id)) : 1024
        , [neurons]);

    // Sort neurons by ID for consistent perimeter placement
    const sortedNeurons = useMemo(() =>
        [...neurons].sort((a, b) => a.neuron_id - b.neuron_id)
        , [neurons]);

    // Spatial bounding box for normalizing x,y into the inner map circle
    const spatialBounds = useMemo(() => {
        if (neurons.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of neurons) {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
        }
        return { minX, maxX, minY, maxY };
    }, [neurons]);

    // Pre-computed per-neuron geometry in UNIT space
    const neuronGeometry = useMemo(() => {
        if (neurons.length === 0) return [];
        const rangeX = (spatialBounds.maxX - spatialBounds.minX) || 1;
        const rangeY = (spatialBounds.maxY - spatialBounds.minY) || 1;
        return sortedNeurons.map(n => {
            const angle = (n.neuron_id / (maxNeuronId + 1)) * 2 * Math.PI - Math.PI / 2;
            const cx = Math.cos(angle);
            const cy = Math.sin(angle);
            const ux = ((n.x - spatialBounds.minX) / rangeX) * 2 - 1;
            const uy = ((n.y - spatialBounds.minY) / rangeY) * 2 - 1;
            let textAngle = angle + Math.PI / 2;
            if (angle > 0 && angle < Math.PI) textAngle += Math.PI;
            return {
                id: n.neuron_id,
                isBackbone: !!n.is_backbone,
                angle,
                cx,
                cy,
                ux,
                uy,
                textAngle,
            };
        });
    }, [sortedNeurons, maxNeuronId, spatialBounds, neurons.length]);

    // O(1) lookup of geometry by neuron id
    const geometryMap = useMemo(() => {
        const m = new Map<number, typeof neuronGeometry[number]>();
        neuronGeometry.forEach(g => m.set(g.id, g));
        return m;
    }, [neuronGeometry]);

    useEffect(() => {
        if (currentTime < lastTimeRef.current) {
            spikeCountsRef.current.clear();
            activeLinksRef.current = [];
            firingHistoryRef.current = [];
            baselineRateRef.current = 0;
            symmetryRef.current = {
                active: false, order: 5, intensity: 0,
                breakAmount: 0, phase: 0, attractorPoints: []
            };
        }

        const newSpikes = spikes.filter(s =>
            s.timestamp_ms > lastTimeRef.current && s.timestamp_ms <= currentTime
        );

        if (newSpikes.length > 0) {
            newSpikes.forEach(s => {
                const count = spikeCountsRef.current.get(s.neuron_id) || 0;
                spikeCountsRef.current.set(s.neuron_id, count + 1);
            });

            // Build connections between co-firing neurons.
            // Cap aggressively — the bottleneck during bursts is the render loop
            // processing all accumulated links × symmetry copies.
            const recentIds = [...new Set(newSpikes.map(s => s.neuron_id))];
            if (recentIds.length > 1) {
                // Aggressively cap pairs generated per frame during bursts
                const maxPairs = recentIds.length > 30 ? 15 : 30;
                let pairCount = 0;
                for (let i = 0; i < recentIds.length && pairCount < maxPairs; i++) {
                    for (let j = i + 1; j < recentIds.length && pairCount < maxPairs; j++) {
                        const g1 = geometryMap.get(recentIds[i]);
                        const g2 = geometryMap.get(recentIds[j]);
                        if (g1 && g2) {
                            activeLinksRef.current.push({
                                sourceId: recentIds[i],
                                targetId: recentIds[j],
                                time: currentTime,
                                strength: Math.min(1, recentIds.length / 20),
                                g1,
                                g2
                            });
                            pairCount++;
                        }
                    }
                }
            }

            // --- Burst Detection ---
            firingHistoryRef.current.push({ time: currentTime, count: newSpikes.length });
            // Keep last 2 seconds of history
            firingHistoryRef.current = firingHistoryRef.current.filter(
                h => currentTime - h.time < 2000
            );

            // Compute current rate vs baseline
            const recentRate = firingHistoryRef.current
                .filter(h => currentTime - h.time < 200)
                .reduce((sum, h) => sum + h.count, 0);
            const baselineWindow = firingHistoryRef.current
                .filter(h => currentTime - h.time >= 200 && currentTime - h.time < 2000);
            if (baselineWindow.length > 0) {
                baselineRateRef.current = baselineWindow.reduce((sum, h) => sum + h.count, 0)
                    / baselineWindow.length * (200 / 1800);
            }

            const burstThreshold = Math.max(baselineRateRef.current * 3, 15);
            const sym = symmetryRef.current;

            if (recentRate > burstThreshold && !sym.active) {
                // Activate symmetry mode
                // Choose order based on number of active clusters
                const clusterCount = recentIds.length;
                let order: SymmetryOrder = 5;
                if (clusterCount < 10) order = 3;
                else if (clusterCount < 30) order = 5;
                else if (clusterCount < 60) order = 7;
                else order = 9;

                sym.active = true;
                sym.order = order;
                sym.intensity = 0;
                sym.breakAmount = 0;
                sym.phase = (currentTime * 0.001) % (2 * Math.PI);
                // 1200 attractor points: visually dense enough, 60% fewer ops than 3000
                sym.attractorPoints = computeAttractorPoints(
                    order, 1200, Math.floor(currentTime),
                    -0.4 - Math.random() * 0.3,
                    0.8 + Math.random() * 0.4,
                    -0.05 - Math.random() * 0.1
                );
            } else if (sym.active && recentRate < burstThreshold * 0.5) {
                // Begin symmetry breaking / decay
                sym.breakAmount = Math.min(1, sym.breakAmount + 0.05);
                if (sym.breakAmount >= 1) {
                    sym.active = false;
                    sym.intensity = 0;
                }
            }

            // Ramp up intensity during active symmetry
            if (sym.active && sym.intensity < 1) {
                sym.intensity = Math.min(1, sym.intensity + 0.08);
            }
        }

        // GPU Fill-rate protection: 1920x1920 canvas rasterization struggles with >1000 thick anti-aliased curves.
        // Symmetry multiplies lines by up to 9x, so we must drastically cut the base lines.
        const isSym = symmetryRef.current.active;
        const maxLinks = isSym ? 150 : 350;
        const fadeLimit = isSym ? 1000 : 1800; // Let them linger smoothly

        activeLinksRef.current = activeLinksRef.current.filter(l => currentTime - l.time < fadeLimit);

        if (activeLinksRef.current.length > maxLinks) {
            activeLinksRef.current = activeLinksRef.current.slice(-maxLinks);
        }

        lastTimeRef.current = currentTime;
    }, [currentTime, spikes, geometryMap]);


    const drawFrame = (ctx: CanvasRenderingContext2D, size: number, time: number) => {
        const center = size / 2;
        const outerRingRadius = size * 0.46;
        const baseRadius = size * 0.38;
        const innerRadius = size * 0.34;
        const histogramRadius = size * 0.42;
        const labelRadius = size * 0.44;
        const scale = size / 800; // scale factor relative to default

        // ── Curved-text helper — defined first so all passes can use it ──────────
        // Renders `text` character-by-character along a circular arc.
        // `startAngle` is the angle of the FIRST character; text advances clockwise
        // (or counter-clockwise when clockwise=false).
        const drawCurvedText = (
            text: string,
            radius: number,
            startAngle: number,
            color: string,
            fontSz: number,
            clockwise: boolean = true
        ) => {
            ctx.save();
            ctx.font = `${fontSz}px monospace`;
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const charWidth = ctx.measureText('M').width;
            const anglePerChar = charWidth / radius * (clockwise ? 1 : -1);
            let angle = startAngle;
            for (let i = 0; i < text.length; i++) {
                const x = center + Math.cos(angle) * radius;
                const y = center + Math.sin(angle) * radius;
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(angle + (clockwise ? Math.PI / 2 : -Math.PI / 2));
                ctx.fillText(text[i], 0, 0);
                ctx.restore();
                angle += anglePerChar;
            }
            ctx.restore();
        };

        // Convenience: compute the total arc-angle a string will occupy
        const textArcAngle = (text: string, radius: number, fontSz: number) => {
            ctx.font = `${fontSz}px monospace`;
            return (ctx.measureText('M').width / radius) * text.length;
        };

        // Clear
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size, size);

        // Increment animation time
        animTimeRef.current += 0.016;

        const sym = symmetryRef.current;
        // Avoid Math.max(...arr) which blows the stack on large arrays
        let maxCount = 1;
        for (const v of spikeCountsRef.current.values()) {
            if (v > maxCount) maxCount = v;
        }

        // Inner spatial-map radius
        const mapRadius = innerRadius * 0.82;

        // ============================================================
        // PASS 0: Outer glow ring — layered strokes, no shadowBlur
        // ============================================================
        // Wide soft halo
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 24 * scale;
        ctx.beginPath();
        ctx.arc(center, center, outerRingRadius, 0, Math.PI * 2);
        ctx.stroke();
        // Mid glow
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 12 * scale;
        ctx.beginPath();
        ctx.arc(center, center, outerRingRadius, 0, Math.PI * 2);
        ctx.stroke();
        // Crisp bright ring
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5 * scale;
        ctx.beginPath();
        ctx.arc(center, center, outerRingRadius, 0, Math.PI * 2);
        ctx.stroke();

        // ============================================================
        // PASS 1: Perimeter Histogram (radial bars)
        // Batched into activity buckets for a major speedup: ~1024 stroke()
        // calls becomes ~8. Each bucket draws one path with one color.
        // ============================================================
        const BUCKETS = 8;
        const bucketPaths: Path2D[] = [];
        for (let k = 0; k < BUCKETS; k++) bucketPaths.push(new Path2D());
        const histMaxH = size * 0.06;
        for (let i = 0; i < neuronGeometry.length; i++) {
            const g = neuronGeometry[i];
            const count = spikeCountsRef.current.get(g.id) || 0;
            const activity = count / maxCount;
            const h = activity * histMaxH;
            const r0 = baseRadius;
            const r1 = histogramRadius + h;
            const x0 = center + g.cx * r0;
            const y0 = center + g.cy * r0;
            const x1 = center + g.cx * r1;
            const y1 = center + g.cy * r1;
            const bucket = Math.min(BUCKETS - 1, Math.floor(activity * BUCKETS));
            bucketPaths[bucket].moveTo(x0, y0);
            bucketPaths[bucket].lineTo(x1, y1);
        }
        ctx.lineWidth = Math.max(0.5, 1.5 * scale);
        for (let k = 0; k < BUCKETS; k++) {
            const midActivity = (k + 0.5) / BUCKETS;
            ctx.strokeStyle = activityColor(midActivity, 0.1 + midActivity * 0.9);
            ctx.stroke(bucketPaths[k]);
        }

        // ============================================================
        // PASS 2: Symmetric Chaotic Attractor Overlay
        // Batched: all 3000 segments accumulated into one Path2D → one stroke.
        // ============================================================
        if (sym.active && sym.attractorPoints.length > 0) {
            const attractorAlpha = sym.intensity * (1 - sym.breakAmount * 0.7) * 0.18;
            ctx.save();
            ctx.globalAlpha = attractorAlpha;

            const attractorScale = innerRadius * 0.85;
            const rotPhase = sym.phase + animTimeRef.current * 0.1;
            const cos = Math.cos(rotPhase);
            const sin = Math.sin(rotPhase);
            const breakOffset = sym.breakAmount * 0.15;

            const attractorPath = new Path2D();
            const pts = sym.attractorPoints;
            // Start
            let prevX = center + (pts[0].x * cos - pts[0].y * sin) * attractorScale;
            let prevY = center + (pts[0].x * sin + pts[0].y * cos) * attractorScale;
            attractorPath.moveTo(prevX, prevY);
            for (let i = 1; i < pts.length; i++) {
                const p1 = pts[i];
                const bx = breakOffset * Math.sin(i * 0.1);
                const by = breakOffset * Math.cos(i * 0.13);
                const x1 = center + (p1.x * cos - p1.y * sin + bx) * attractorScale;
                const y1 = center + (p1.x * sin + p1.y * cos + by) * attractorScale;
                attractorPath.lineTo(x1, y1);
            }
            ctx.strokeStyle = 'rgba(140, 200, 255, 0.5)';
            ctx.lineWidth = 0.5 * scale;
            ctx.stroke(attractorPath);
            ctx.restore();
        }

        // ============================================================
        // PASS 3: Connections with edge bundling + symmetry replication
        // Batched into a small number of paths keyed by activity bucket.
        // ============================================================
        ctx.save();
        const LINK_BUCKETS = 6;
        const linkPaths: Path2D[] = [];
        const symLinkPaths: Path2D[] = [];
        for (let k = 0; k < LINK_BUCKETS; k++) {
            linkPaths.push(new Path2D());
            symLinkPaths.push(new Path2D());
        }

        const links = activeLinksRef.current;
        const symActive = sym.active;
        const symOrder = sym.order;
        const symIntensity = symActive ? sym.intensity : 0;
        const fadeLimit = symActive ? 1000 : 1800;

        // Pre-cache sin/cos for each symmetry rotation so we don't call trig
        // inside the inner loop (links × copies). This is the hot path during bursts.
        // Cap live symmetry at D5 (5 copies) — D7/D9 double the work for marginal visuals.
        const liveSymOrder = symActive ? Math.min(5, symOrder) : 1;
        const symRotCos = new Float32Array(liveSymOrder);
        const symRotSin = new Float32Array(liveSymOrder);
        if (symActive) {
            for (let c = 0; c < liveSymOrder; c++) {
                const rotAngle = (c / liveSymOrder) * 2 * Math.PI * symIntensity;
                symRotCos[c] = Math.cos(rotAngle);
                symRotSin[c] = Math.sin(rotAngle);
            }
        }

        for (let li = 0; li < links.length; li++) {
            const link = links[li];
            const age = time - link.time;
            if (age > fadeLimit) continue;
            
            const { g1, g2 } = link;

            // Pair-level activity drives color bucket
            const c1 = spikeCountsRef.current.get(g1.id) || 0;
            const c2 = spikeCountsRef.current.get(g2.id) || 0;
            const pairActivity = Math.min(1, ((c1 + c2) / 2) / maxCount);
            const bucket = Math.min(LINK_BUCKETS - 1, Math.floor(pairActivity * LINK_BUCKETS));

            // Spatial control points (inner map)
            const sp1x = center + g1.ux * mapRadius;
            const sp1y = center + g1.uy * mapRadius;
            const sp2x = center + g2.ux * mapRadius;
            const sp2y = center + g2.uy * mapRadius;
            const cpX = (sp1x + sp2x) / 2;
            const cpY = (sp1y + sp2y) / 2;

            // Perimeter endpoints — primary connection
            const px0 = center + g1.cx * baseRadius;
            const py0 = center + g1.cy * baseRadius;
            const px1 = center + g2.cx * baseRadius;
            const py1 = center + g2.cy * baseRadius;

            const p = linkPaths[bucket];
            p.moveTo(px0, py0);
            p.quadraticCurveTo(cpX, cpY, px1, py1);

            // Symmetry replicas: use pre-cached rotation matrices to avoid trig per link
            if (symActive && symIntensity > 0.05) {
                // Endpoints relative to center
                const e1x = g1.cx * baseRadius;  // = px0 - center
                const e1y = g1.cy * baseRadius;
                const e2x = g2.cx * baseRadius;
                const e2y = g2.cy * baseRadius;
                const sp = symLinkPaths[bucket];
                for (let c = 1; c < liveSymOrder; c++) {
                    const rc = symRotCos[c];
                    const rs = symRotSin[c];
                    // Rotate both endpoints around the center
                    const rpx0 = center + (e1x * rc - e1y * rs);
                    const rpy0 = center + (e1x * rs + e1y * rc);
                    const rpx1 = center + (e2x * rc - e2y * rs);
                    const rpy1 = center + (e2x * rs + e2y * rc);
                    // Midpoint control: pull toward center proportional to arc distance
                    const cpX = (rpx0 + rpx1) / 2 * 0.4 + center * 0.6;
                    const cpY = (rpy0 + rpy1) / 2 * 0.4 + center * 0.6;
                    sp.moveTo(rpx0, rpy0);
                    sp.quadraticCurveTo(cpX, cpY, rpx1, rpy1);
                }
            }
        }

        ctx.lineWidth = Math.max(0.3, 0.8 * scale);
        for (let k = 0; k < LINK_BUCKETS; k++) {
            const midActivity = (k + 0.5) / LINK_BUCKETS;
            // Increased alpha for brighter curves
            ctx.strokeStyle = activityColor(midActivity, 0.25 + midActivity * 0.45, true);
            ctx.stroke(linkPaths[k]);
        }
        if (symActive) {
            ctx.lineWidth = Math.max(0.3, 0.6 * scale);
            for (let k = 0; k < LINK_BUCKETS; k++) {
                const midActivity = (k + 0.5) / LINK_BUCKETS;
                // Significantly brighter symmetry curves
                ctx.strokeStyle = activityColor(midActivity, 0.2 * symIntensity + 0.1, true);
                ctx.stroke(symLinkPaths[k]);
            }
        }
        ctx.restore();

        // ============================================================
        // PASS 4: Connection endpoints (glowing dots) — batched
        // O(Active Neurons) instead of O(Links)
        // ============================================================
        ctx.save();
        const endpointPath = new Path2D();
        const dotSize = Math.max(1, 2 * scale);
        
        for (const id of spikeCountsRef.current.keys()) {
            const g = geometryMap.get(id);
            if (g) {
                const x = center + g.cx * baseRadius;
                const y = center + g.cy * baseRadius;
                endpointPath.moveTo(x + dotSize, y);
                endpointPath.arc(x, y, dotSize, 0, Math.PI * 2);
            }
        }
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fill(endpointPath);
        ctx.restore();

        // ============================================================
        // PASS 5: Base circle + tick marks
        // ============================================================
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1 * scale;
        ctx.beginPath();
        ctx.arc(center, center, baseRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Inner subtle ring
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 0.5 * scale;
        ctx.beginPath();
        ctx.arc(center, center, innerRadius, 0, Math.PI * 2);
        ctx.stroke();

        // ============================================================
        // PASS 5.5: Inner organoid spatial map
        // ============================================================

        // (MEA grid removed — too noisy on LED wall)

        // Non-backbone neurons: not shown in inner map (they form a box shape
        // that clutters the display — only backbone nodes are plotted).

        // Backbone neurons: brighter dots with layered manual glow
        // Split into 3 activity tiers → 3 fills instead of per-neuron calls
        ctx.save();
        const backboneHotPath = new Path2D();
        const backboneMidPath = new Path2D();
        const backboneCorePath = new Path2D();
        const backboneLabels: { x: number; y: number; id: number; activity: number }[] = [];
        const coreR = Math.max(2, 3 * scale);
        for (let i = 0; i < neuronGeometry.length; i++) {
            const g = neuronGeometry[i];
            if (!g.isBackbone) continue;
            const count = spikeCountsRef.current.get(g.id) || 0;
            const activity = count / maxCount;
            const sx = center + g.ux * mapRadius;
            const sy = center + g.uy * mapRadius;
            const dSize = coreR + activity * 3 * scale;
            if (activity > 0.1) {
                backboneHotPath.moveTo(sx + dSize * 4, sy);
                backboneHotPath.arc(sx, sy, dSize * 4, 0, Math.PI * 2);
                backboneMidPath.moveTo(sx + dSize * 2.5, sy);
                backboneMidPath.arc(sx, sy, dSize * 2.5, 0, Math.PI * 2);
            }
            backboneCorePath.moveTo(sx + dSize, sy);
            backboneCorePath.arc(sx, sy, dSize, 0, Math.PI * 2);
            backboneLabels.push({ x: sx + dSize + 2 * scale, y: sy, id: g.id, activity });
        }
        ctx.fillStyle = activityColor(0.7, 0.10);
        ctx.fill(backboneHotPath);
        ctx.fillStyle = activityColor(0.7, 0.19);
        ctx.fill(backboneMidPath);
        ctx.fillStyle = activityColor(0.6, 0.95);
        ctx.fill(backboneCorePath);

        // Backbone labels: one font set, batch fillText
        ctx.font = `${Math.max(6, 8 * scale)}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(220, 230, 255, 0.55)';
        for (let i = 0; i < backboneLabels.length; i++) {
            const bl = backboneLabels[i];
            ctx.fillText(`${bl.id}`, bl.x, bl.y);
        }
        ctx.restore();

        // Connector lines from backbone → perimeter — batched
        ctx.save();
        ctx.setLineDash([2 * scale, 4 * scale]);
        ctx.strokeStyle = activityColor(0.4, 0.15);
        ctx.lineWidth = 0.5 * scale;
        const backbonePath = new Path2D();
        for (let i = 0; i < neuronGeometry.length; i++) {
            const g = neuronGeometry[i];
            if (!g.isBackbone) continue;
            const sx = center + g.ux * mapRadius;
            const sy = center + g.uy * mapRadius;
            const px = center + g.cx * baseRadius;
            const py = center + g.cy * baseRadius;
            backbonePath.moveTo(sx, sy);
            backbonePath.lineTo(px, py);
        }
        ctx.stroke(backbonePath);
        ctx.setLineDash([]);
        ctx.restore();

        // ============================================================
        // PASS 6: Tick marks + sparse perimeter labels
        // Ticks: batched into 4 alpha buckets (4 stroke calls vs ~1024)
        // Labels: font set once, save/restore pair per label kept
        // ============================================================
        const labelStep = maxNeuronId > 500 ? 8 : maxNeuronId > 200 ? 4 : 2;
        const fontSize = Math.max(5, Math.min(8, 6 * scale));
        const tickInner = baseRadius - 2 * scale;
        const tickOuter = baseRadius + 3 * scale;

        const TICK_BUCKETS = 4;
        const tickPaths: Path2D[] = [];
        for (let k = 0; k < TICK_BUCKETS; k++) tickPaths.push(new Path2D());
        for (let i = 0; i < neuronGeometry.length; i++) {
            const g = neuronGeometry[i];
            const count = spikeCountsRef.current.get(g.id) || 0;
            const activity = count / maxCount;
            const bucket = Math.min(TICK_BUCKETS - 1, Math.floor(activity * TICK_BUCKETS));
            const p = tickPaths[bucket];
            p.moveTo(center + g.cx * tickInner, center + g.cy * tickInner);
            p.lineTo(center + g.cx * tickOuter, center + g.cy * tickOuter);
        }
        ctx.lineWidth = 0.5 * scale;
        for (let k = 0; k < TICK_BUCKETS; k++) {
            const bucketAlpha = 0.1 + (k / TICK_BUCKETS) * 0.4;
            ctx.strokeStyle = `rgba(255,255,255,${bucketAlpha})`;
            ctx.stroke(tickPaths[k]);
        }

        // Labels: set font once, avoid re-setting per iteration
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < neuronGeometry.length; i += labelStep) {
            const g = neuronGeometry[i];
            const count = spikeCountsRef.current.get(g.id) || 0;
            const brightness = count > 0 ? Math.min(1, 0.4 + (count / maxCount) * 0.6) : 0.3;
            ctx.save();
            ctx.translate(center + g.cx * labelRadius, center + g.cy * labelRadius);
            ctx.rotate(g.textAngle);
            ctx.fillStyle = `rgba(200,200,200,${brightness})`;
            ctx.fillText(`${g.id}`, 0, 0);
            ctx.restore();
        }

        // ============================================================
        // PASS 6.3: Regions mode — cluster arcs + annotation rays
        // Inspired by Boris Müller / James Spahr / knowledge-cartography:
        // groups neurons into color-coded arc segments along the perimeter
        // with a label ray extending outward from each region.
        // ============================================================
        if (mode === 'regions' && neuronGeometry.length > 0) {
            // Deterministic chunking by neuron id — 7 regions
            const REGION_COUNT = 7;
            const regionSize = Math.ceil(neuronGeometry.length / REGION_COUNT);
            const regionArcR = baseRadius + 6 * scale;
            const regionLabelR = outerRingRadius - 10 * scale;

            for (let r = 0; r < REGION_COUNT; r++) {
                const startIdx = r * regionSize;
                const endIdx = Math.min(neuronGeometry.length - 1, startIdx + regionSize - 1);
                if (startIdx >= neuronGeometry.length) break;
                const gA = neuronGeometry[startIdx];
                const gB = neuronGeometry[endIdx];
                // Sum activity of region
                let regionActivity = 0;
                let regionCount = 0;
                for (let i = startIdx; i <= endIdx; i++) {
                    const c = spikeCountsRef.current.get(neuronGeometry[i].id) || 0;
                    regionActivity += c;
                    regionCount++;
                }
                const avgActivity = regionCount > 0 ? (regionActivity / regionCount) / maxCount : 0;

                // Arc from gA.angle to gB.angle
                ctx.save();
                ctx.strokeStyle = activityColor(Math.min(1, avgActivity * 3), 0.45 + avgActivity * 0.4);
                ctx.lineWidth = Math.max(1.5, 3 * scale);
                ctx.beginPath();
                ctx.arc(center, center, regionArcR, gA.angle, gB.angle, false);
                ctx.stroke();

                // Radial tick at region start
                const tickX0 = center + gA.cx * baseRadius;
                const tickY0 = center + gA.cy * baseRadius;
                const tickX1 = center + gA.cx * (regionLabelR);
                const tickY1 = center + gA.cy * (regionLabelR);
                ctx.strokeStyle = activityColor(Math.min(1, avgActivity * 3), 0.25);
                ctx.lineWidth = 0.5 * scale;
                ctx.beginPath();
                ctx.moveTo(tickX0, tickY0);
                ctx.lineTo(tickX1, tickY1);
                ctx.stroke();

                // Region label — curved along the arc, centred on the region's angular midpoint
                const regionLabel = `REGION_${String(r + 1).padStart(2, '0')} [${Math.round(avgActivity * 100)}%]`;
                const labelFontSz = Math.max(7, 9 * scale);
                const labelArc = textArcAngle(regionLabel, regionLabelR, labelFontSz);
                // Midpoint angle of the region
                const midIdx = Math.floor((startIdx + endIdx) / 2);
                const regionMidAngle = neuronGeometry[midIdx].angle;
                // Centre the text on the midpoint angle
                const labelStartAngle = regionMidAngle - labelArc / 2;
                const regionColor = activityColor(Math.min(1, avgActivity * 3), 0.9);
                drawCurvedText(regionLabel, regionLabelR, labelStartAngle, regionColor, labelFontSz);
                ctx.restore();
            }
        }

        // ============================================================
        // PASS 6.5: Rotating zoom-window (clock-index style)
        // A thin arc-rectangle that travels clockwise around the perimeter,
        // framing a slice of neurons and showing an enlarged inset view
        // of their activity. Inspired by "clock index" dial markers.
        // ============================================================
        if (showZoomWindow && neuronGeometry.length > 0) {
            // Clock-index sweeps clockwise: one full revolution every 12 seconds of data
            const sweepPeriod = 12000;
            const sweepAngle = ((time % sweepPeriod) / sweepPeriod) * 2 * Math.PI - Math.PI / 2;
            const windowHalfSpan = 0.18; // radians — thin wedge
            const innerR = baseRadius - 5 * scale;
            const outerR = histogramRadius + size * 0.06;

            // Annular sector outline — the clock index frame
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 80, 80, 0.85)';
            ctx.lineWidth = 0.9 * scale;
            ctx.beginPath();
            ctx.arc(center, center, innerR, sweepAngle - windowHalfSpan, sweepAngle + windowHalfSpan);
            ctx.arc(center, center, outerR, sweepAngle + windowHalfSpan, sweepAngle - windowHalfSpan, true);
            ctx.closePath();
            ctx.stroke();
            // Faint red fill
            ctx.fillStyle = 'rgba(255, 60, 60, 0.04)';
            ctx.fill();
            ctx.restore();

            // Timestamp arc text — rendered INSIDE the wedge, near its inner edge (where the dots are).
            // This keeps the label contained within the red clock-index frame but close to the inner circle.
            const frameNumber = Math.floor((time / 1000) * 30);
            const stampText = `T:${Math.round(time)}ms  F:${frameNumber}  L:${activeLinksRef.current.length}`;
            const stampFontSize = Math.max(6, 7.5 * scale);
            // Place at innerR minus 1.5 font-heights (radially 'under' the wedge frame)
            const stampRadius = innerR - stampFontSize * 1.5;
            const stampArc = textArcAngle(stampText, stampRadius, stampFontSize);
            const stampStartAngle = sweepAngle - stampArc / 2;
            drawCurvedText(stampText, stampRadius, stampStartAngle, 'rgba(255, 80, 80, 0.92)', stampFontSize);
        }

        // ============================================================
        // PASS 7: HUD / Metadata — curved text along outer perimeter
        // (drawCurvedText is defined at the top of drawFrame)
        // ============================================================
        if (!isDetached) {
            const hudFontSize = Math.max(8, 11 * scale);
            const hudRadius = outerRingRadius + 16 * scale; // outside the outer ring

            // Top arc: title
            const titleText = title
                ? title.toUpperCase()
                : (mode === 'regions' ? 'NEURAL_REGIONS_V1.0' : 'NEURAL_TOPOLOGY_V1.0');
            const titleCharWidth = hudFontSize * 0.6;
            const titleArcLen = titleText.length * titleCharWidth;
            const titleArcAngle = titleArcLen / hudRadius;
            drawCurvedText(
                titleText, hudRadius,
                -Math.PI / 2 - titleArcAngle / 2, // centered at top
                '#00AAFF', hudFontSize
            );

            // Upper-right arc: data time
            const timeText = `DATA_TIME:${Math.round(time)}ms`;
            drawCurvedText(timeText, hudRadius, -0.1, 'rgba(255,255,255,0.7)', hudFontSize * 0.85);

            // Right arc: neuron count
            const neuronText = `NEURONS:${neurons.length}`;
            drawCurvedText(neuronText, hudRadius, 0.55, 'rgba(255,255,255,0.7)', hudFontSize * 0.85);

            // Lower-right arc: link count
            const linkText = `LINKS:${activeLinksRef.current.length}`;
            drawCurvedText(linkText, hudRadius, 1.1, 'rgba(255,255,255,0.7)', hudFontSize * 0.85);

            // Symmetry mode indicator — left x-axis (opposite DATA_TIME on the right)
            if (sym.active) {
                const symText = `D${sym.order}_SYMMETRY[${Math.round(sym.intensity * 100)}%]` +
                    (sym.breakAmount > 0 ? `_BREAKING[${Math.round(sym.breakAmount * 100)}%]` : '');
                const symAlpha = 0.5 + Math.sin(animTimeRef.current * 3) * 0.3;
                const symCharWidth = hudFontSize * 0.85 * 0.6;
                const symArcAngle = (symText.length * symCharWidth) / hudRadius;
                drawCurvedText(symText, hudRadius, Math.PI - symArcAngle / 2, `rgba(0,200,255,${symAlpha})`, hudFontSize * 0.85);
            }

            // Bottom arc: credits — clockwise, centered at bottom, matching perimeter letter orientation
            const creditText = 'FIELD-GOLUBITSKY SYMMETRIC CHAOS \u00B7 ORGANOID NEURAL TOPOLOGY';
            const creditFontSize = hudFontSize * 0.7;
            const creditCharWidth = creditFontSize * 0.6;
            const creditArcLen = creditText.length * creditCharWidth;
            const creditArcAngle = creditArcLen / hudRadius;
            drawCurvedText(
                creditText, hudRadius,
                (1.1 + Math.PI) / 2 - creditArcAngle / 2, // centered between LINKS (1.1) and symmetry (π)
                'rgba(150,150,150,0.5)', creditFontSize, true
            );
        }
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Cap at 30fps — this is a display component, not interactive
        const TARGET_FPS = 30;
        const FRAME_MS = 1000 / TARGET_FPS;
        let animationFrameId: number;
        let lastRender = 0;

        const render = (ts: number) => {
            animationFrameId = requestAnimationFrame(render);
            // During symmetry/burst events, drop to 20fps to keep the app smooth.
            // Outside bursts, run at the normal 30fps cap.
            const targetMs = symmetryRef.current.active ? 50 : FRAME_MS;
            if (ts - lastRender < targetMs) return;
            lastRender = ts;
            drawFrame(ctx, width, currentTime);
        };

        animationFrameId = requestAnimationFrame(render);
        return () => cancelAnimationFrame(animationFrameId);
    }, [width, height, currentTime, neurons]);

    const handleExportPNG = () => {
        setIsExporting(true);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = exportResolution;
        tempCanvas.height = exportResolution;
        const ctx = tempCanvas.getContext('2d');
        if (ctx) {
            drawFrame(ctx, exportResolution, currentTime);
            tempCanvas.toBlob((blob) => {
                if (blob) {
                    saveAs(blob, `circular_graph_${Math.round(currentTime)}.png`);
                }
                setIsExporting(false);
            }, 'image/png');
        } else {
            setIsExporting(false);
        }
    };

    const handleExportSequence = async () => {
        setIsExporting(true);
        setExportProgress(0);

        try {
            const fps = 30;
            // Sort spikes by timestamp for safe filtering
            const sortedSpikes = [...spikes].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
            const dataStart = sortedSpikes.length > 0 ? sortedSpikes[0].timestamp_ms : 0;
            const dataEnd   = sortedSpikes.length > 0 ? sortedSpikes[sortedSpikes.length - 1].timestamp_ms : 0;
            const dataRangeMs = Math.max(1, dataEnd - dataStart);

            // Frame count driven directly by targetDuration: 750s → 22,500 frames
            const totalFrames = Math.max(1, Math.round(targetDuration * fps));
            // Each frame maps to this much data time
            const msPerFrame = dataRangeMs / totalFrames;

            const res = exportResolution;
            const offscreen = document.createElement('canvas');
            offscreen.width = res;
            offscreen.height = res;
            const ctx = offscreen.getContext('2d');
            if (!ctx) { setIsExporting(false); return; }

            // Try File System Access API first, fall back to ZIP
            let dirHandle: FileSystemDirectoryHandle | null = null;
            let zip: any = null;

            try {
                dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
            } catch {
                try {
                    const JSZip = (await import('jszip')).default;
                    zip = new JSZip();
                } catch { /* save individually as fallback */ }
            }

            // Pre-build full cumulative spike counts over the entire dataset.
            // The live graph uses a running cumulative total, so we replicate
            // that — each frame we inject the counts up to that frame's time.
            // We walk through sortedSpikes with a pointer so no O(n) filter per frame.
            const simCounts = new Map<number, number>();
            const fadeLimitMs = 1200;
            // simLinks is kept pruned to avoid unbounded growth
            const simLinks: { sourceId: number; targetId: number; time: number; strength: number }[] = [];
            let spikePointer = 0;  // index into sortedSpikes

            for (let i = 0; i < totalFrames; i++) {
                // Map frame index to data time: frame 0 → dataStart, frame N-1 → dataEnd
                const t = dataStart + (i + 1) * msPerFrame; // +1 so frame 0 gets first batch

                // Walk sorted spikes forward to accumulate up to t
                while (spikePointer < sortedSpikes.length &&
                       sortedSpikes[spikePointer].timestamp_ms <= t) {
                    const s = sortedSpikes[spikePointer];
                    simCounts.set(s.neuron_id, (simCounts.get(s.neuron_id) || 0) + 1);
                    spikePointer++;
                }

                // Build links from spikes in the last-frame window
                const windowStart = t - msPerFrame;
                const frameSpikes = sortedSpikes.filter(s =>
                    s.timestamp_ms > windowStart && s.timestamp_ms <= t
                );
                const recentIds = [...new Set(frameSpikes.map(s => s.neuron_id))];
                if (recentIds.length > 1) {
                    const maxPairs = 80; // keep bounded
                    let pairCount = 0;
                    for (let a = 0; a < recentIds.length && pairCount < maxPairs; a++) {
                        for (let b = a + 1; b < recentIds.length && pairCount < maxPairs; b++) {
                            simLinks.push({
                                sourceId: recentIds[a],
                                targetId: recentIds[b],
                                time: t,
                                strength: Math.min(1, recentIds.length / 20),
                            });
                            pairCount++;
                        }
                    }
                }

                // Prune old links in-place so simLinks stays bounded
                const cutoffTime = t - fadeLimitMs;
                let pruneIdx = 0;
                while (pruneIdx < simLinks.length && simLinks[pruneIdx].time < cutoffTime) pruneIdx++;
                if (pruneIdx > 0) simLinks.splice(0, pruneIdx);

                // Inject simulated state into the refs that drawFrame reads
                const savedCounts = spikeCountsRef.current;
                const savedLinks  = activeLinksRef.current;
                spikeCountsRef.current  = simCounts;
                activeLinksRef.current  = simLinks;

                drawFrame(ctx, res, t);

                // Restore live state immediately
                spikeCountsRef.current  = savedCounts;
                activeLinksRef.current  = savedLinks;

                // Capture frame AFTER drawFrame has painted the offscreen canvas
                const dataUrl = offscreen.toDataURL('image/png', 1.0);
                const fileName = `circular_frame_${String(i).padStart(6, '0')}.png`;

                if (dirHandle) {
                    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                    const writable = await fileHandle.createWritable();
                    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
                    const binaryStr = atob(base64Data);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let j = 0; j < binaryStr.length; j++) bytes[j] = binaryStr.charCodeAt(j);
                    await writable.write(bytes);
                    await writable.close();
                } else if (zip) {
                    zip.file(fileName, dataUrl.replace(/^data:image\/png;base64,/, ''), { base64: true });
                }

                // Yield every 4 frames to keep the UI responsive without over-yielding
                if (i % 4 === 0) {
                    setExportProgress(Math.round((i / totalFrames) * 100));
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            // Finalize ZIP if used
            if (zip && !dirHandle) {
                const blob = await zip.generateAsync({ type: 'blob' });
                saveAs(blob, `circular_topology_${totalFrames}frames_${fps}fps.zip`);
            }
        } catch (e) {
            console.error('Sequence export failed', e);
        }

        setIsExporting(false);
        setExportProgress(0);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        // Calculate coordinates relative to canvas center
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        const radius = Math.sqrt(x * x + y * y);
        
        // Map radius to our internal coordinate space
        const internalRadius = (radius / (rect.width / 2)) * (width / 2);
        
        // Only start scrubbing if grabbing the outer ring area
        if (internalRadius > width * 0.35) {
            scrubRef.current.active = true;
            scrubRef.current.lastAngle = Math.atan2(y, x);
            if (onScrubStateChange) onScrubStateChange(true);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } else {
            // Tapped in the center
            if (onCenterTap) onCenterTap();
        }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!scrubRef.current.active) return;
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        const currentAngle = Math.atan2(y, x);
        
        let deltaAngle = currentAngle - scrubRef.current.lastAngle;
        
        // Handle wrap around
        if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
        if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
        
        // 1 full revolution = 12000ms
        const deltaTime = (deltaAngle / (2 * Math.PI)) * 12000;
        
        if (onTimeScrub) {
            onTimeScrub(currentTime + deltaTime);
        }
        
        scrubRef.current.lastAngle = currentAngle;
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (scrubRef.current.active) {
            scrubRef.current.active = false;
            if (onScrubStateChange) onScrubStateChange(false);
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
    };

    const scaleFactor = isDetached ? (0.5 / 0.46) : 1;
    const canvasElement = (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{ 
                width: '100%', 
                height: '100%', 
                borderRadius: '50%', 
                touchAction: 'none',
                transform: `scale(${scaleFactor})`,
                transformOrigin: 'center center'
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        />
    );

    if (isDetached) {
        return (
            <>
                <div style={{ padding: 'var(--space-xl)', textAlign: 'center', border: '1px dashed var(--color-border)', marginTop: 'var(--space-xl)' }}>
                    <p className="status-text" style={{ marginBottom: 'var(--space-md)' }}>Graph is currently detached to a separate window.</p>
                    <button className="btn btn-primary" onClick={() => setIsDetached(false)}>
                        ␡ Reattach Window
                    </button>
                </div>
                <DetachedWindow title="Circular Event Topology" onClose={() => setIsDetached(false)}>
                    {canvasElement}
                </DetachedWindow>
            </>
        );
    }

    const graphContent = (
        <div className="circular-graph-container" style={{ position: 'relative', marginTop: 'var(--space-xl)' }}>
            <div className="flex justify-between items-center" style={{ width: '100%', marginBottom: 'var(--space-md)' }}>
                <h2 style={{ letterSpacing: '0.1em', margin: 0 }}>CIRCULAR EVENT TOPOLOGY {mode === 'regions' && '(REGIONS)'}</h2>
                <button className="btn btn-secondary" onClick={() => setIsDetached(true)}>
                    ⏏ Detach Window
                </button>
            </div>
            <div style={{
                width: '100%',
                height: 'auto',
                aspectRatio: '1/1',
                background: '#000',
                border: '1px solid var(--color-border)',
                borderRadius: '50%',
                overflow: 'hidden',
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center'
            }}>
                {canvasElement}
            </div>

            <div className="flex gap-md" style={{ marginTop: 'var(--space-md)', flexWrap: 'wrap', width: '100%', justifyContent: 'flex-start' }}>
                <button
                    className="btn"
                    onClick={handleExportPNG}
                    disabled={isExporting}
                >
                    {isExporting ? 'Processing...' : `Export Frame (${exportResolution}x${exportResolution})`}
                </button>
                <button
                    className="btn"
                    onClick={handleExportSequence}
                    disabled={isExporting}
                >
                    {isExporting ? `Exporting Sequence ${exportProgress}%` : 'Export Sequence (ZIP)'}
                </button>
                <div className="status-text" style={{ alignSelf: 'center' }}>
                    Optimized for Circular LED Projection &middot; Field-Golubitsky Symmetry Mode
                </div>
            </div>
        </div>
    );

    return graphContent;
};

