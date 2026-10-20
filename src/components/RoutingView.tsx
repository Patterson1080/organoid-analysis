import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import type { Neuron, SpikeEvent } from '../types';
import type { LedFrame } from '../show/ledFrame';
import { extrapolateIndex, phaseRemainingMs } from '../show/showMath';
import { VISUAL_FACTS } from '../show/routing/facts';
import type { MediumKey } from '../show/routing/facts';
import type { FiringBlob } from '../show/routing/firingBlob';
import { hitBox, routingLayout } from '../show/routing/layout';
import type { RoutingLayout } from '../show/routing/layout';
import { advanceLive, createLiveState } from '../show/routing/live';
import { SWARM_SPECS, createSwarm, fleeSources, stepSwarm } from '../show/routing/swarm';
import type { Swarm } from '../show/routing/swarm';
import type { Telemetry } from '../show/routing/telemetry';
import { layerForIndex } from '../show/routing/vessel';
import type { Vessel } from '../show/routing/vessel';
import { paintSwarm } from './routing/glyphs';
import type { SwarmStyle } from './routing/glyphs';
import { drawOverview } from './routing/overview';
import type { SwarmKey } from './routing/overview';
import type { ShowStateSnapshot } from './ShowPanel';

interface RoutingViewProps {
    neurons: Neuron[];
    spikes: SpikeEvent[]; // sorted by timestamp_ms
    showLatestRef: MutableRefObject<ShowStateSnapshot | null>;
    playbackTimeRef: MutableRefObject<number>;
    ledFrameRef: MutableRefObject<LedFrame | null>;
    telemetryRef: MutableRefObject<Telemetry>;
    firingBlob: FiringBlob | null;
    vessel: Vessel | null;
    connected: boolean;
    presentation: boolean;
    height?: number; // presentation passes the space left on screen
}

const FRAME_MS = 1000 / 30; // a display, not a control: same cap as the circular graph
const SWARM_PX = 512;
const SWARM_KEYS: SwarmKey[] = ['physarum', 'boids', 'termites'];
const SWARM_STYLES: Record<SwarmKey, SwarmStyle> = {
    physarum: { fade: 0.06, dim: 'rgba(140,140,140,0.22)' },
    boids: { fade: 0.18, dim: 'rgba(160,160,160,0.5)' },
    termites: { fade: 0.012, dim: 'rgba(190,190,190,0.35)' },
};

/** Where the show's signal goes and how each medium maps it, drawn live from the playhead. */
export function RoutingView(props: RoutingViewProps) {
    const { neurons, spikes, showLatestRef, playbackTimeRef, ledFrameRef, telemetryRef, firingBlob, vessel } = props;
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const layoutRef = useRef<RoutingLayout | null>(null);
    const hoverRef = useRef<MediumKey | null>(null);
    const visibleRef = useRef(true);
    const [width, setWidth] = useState(0);
    const height = props.height ?? Math.max(420, Math.round((width * 9) / 16));

    const live = useMemo(() => createLiveState(neurons, spikes), [neurons, spikes]);
    const swarms = useMemo(() => {
        const positions = live.neurons.map(n => ({ x: n.x, y: n.y }));
        const out = {} as Record<SwarmKey, { swarm: Swarm; canvas: HTMLCanvasElement }>;
        for (const k of SWARM_KEYS) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = SWARM_PX;
            out[k] = { swarm: createSwarm(positions, SWARM_SPECS[k]), canvas };
        }
        return out;
    }, [live]);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const io = new IntersectionObserver(([entry]) => { visibleRef.current = entry.isIntersecting; });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    // Draw loop: reads refs every frame, so nothing re-renders at frame rate.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || width <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const g = canvas.getContext('2d');
        if (!g) return;
        const layout = routingLayout(width, height);
        layoutRef.current = layout;
        const canvases = {} as Record<SwarmKey, HTMLCanvasElement>;
        for (const k of SWARM_KEYS) canvases[k] = swarms[k].canvas;
        const flee: number[] = [];
        let raf = 0;
        let last = 0;
        let parked: number | null = null; // last playhead, held through OFF for the vessel layer

        const frame = (ts: number) => {
            raf = requestAnimationFrame(frame);
            if (document.hidden || !visibleRef.current) {
                last = 0;
                return;
            }
            if (last && ts - last < FRAME_MS) return;
            const dtMs = last ? ts - last : FRAME_MS;
            last = ts;

            const snap = showLatestRef.current;
            const st = snap?.state;
            const mode: 'show' | 'local' = st?.running ? 'show' : 'local';
            let index: number | null = null;
            let phase: 'on' | 'off' | 'stopped' = 'stopped';
            let offRemainingMs = 0;
            if (st?.running && snap) {
                const since = ts - snap.receivedAt;
                phase = st.phase === 'off' ? 'off' : 'on';
                index = extrapolateIndex(st, since);
                if (phase === 'off') offRemainingMs = phaseRemainingMs(st, since);
            } else if (neurons.length) {
                index = playbackTimeRef.current;
            }
            if (index !== null) parked = index;

            advanceLive(live, { index, spikes, blob: firingBlob, ledFrame: ledFrameRef.current, telemetry: telemetryRef.current, dtMs, now: ts });
            const frames = dtMs / (1000 / 60);
            fleeSources(swarms.termites.swarm, live.firing, VISUAL_FACTS.threshold, flee);
            for (const k of SWARM_KEYS) {
                stepSwarm(swarms[k].swarm, live.firing, VISUAL_FACTS.threshold, frames, k === 'termites' ? null : flee);
                paintSwarm(swarms[k].canvas, swarms[k].swarm, live.firing, VISUAL_FACTS.threshold, SWARM_STYLES[k], frames);
            }

            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.fillStyle = '#000';
            g.fillRect(0, 0, width, height);
            drawOverview(g, layout, {
                live,
                swarms: canvases,
                vessel,
                vesselLayer: vessel ? layerForIndex(vessel, parked ?? 0) : 0,
                index,
                mode,
                phase,
                offRemainingMs,
                dim: phase === 'off' ? 0.3 : 1,
                hover: hoverRef.current,
                visualOutput: 'unity',
                scale: layout.scale,
                now: ts,
            });
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [width, height, live, swarms, neurons, spikes, firingBlob, vessel, showLatestRef, playbackTimeRef, ledFrameRef, telemetryRef]);

    const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const layout = layoutRef.current;
        if (!layout) return;
        const r = e.currentTarget.getBoundingClientRect();
        const key = hitBox(layout.cards, e.clientX - r.left, e.clientY - r.top);
        hoverRef.current = key;
        e.currentTarget.style.cursor = key ? 'pointer' : 'default';
    };

    return (
        <div ref={wrapRef} style={{ marginTop: 'var(--space-md)' }}>
            <div className="data-label" style={{ marginBottom: 'var(--space-sm)', letterSpacing: '0.12em' }}>ROUTING · SIGNAL → MEDIUM</div>
            <canvas ref={canvasRef} style={{ display: 'block' }} onPointerMove={onPointerMove} onPointerLeave={() => { hoverRef.current = null; }} />
        </div>
    );
}
