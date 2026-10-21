import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import type { Neuron, SpikeEvent } from '../types';
import { formatClock } from '../show/showMath';
import { CARD_TITLES, VISUAL_FACTS } from '../show/routing/facts';
import type { MediumKey, VisualOutput } from '../show/routing/facts';
import type { FiringBlob } from '../show/routing/firingBlob';
import { detailLayout, hitBox, inside, routingLayout } from '../show/routing/layout';
import type { DetailLayout, RoutingLayout } from '../show/routing/layout';
import { advanceLive, createLiveState } from '../show/routing/live';
import type { StampedLedFrame } from '../show/routing/live';
import type { PatchData } from '../show/routing/maxPatch';
import { routingPlayhead } from '../show/routing/playhead';
import { SWARM_KEYS, SWARM_SPECS, createSwarm, fleeSources, stepSwarm } from '../show/routing/swarm';
import type { Swarm, SwarmKey } from '../show/routing/swarm';
import type { Telemetry } from '../show/routing/telemetry';
import type { TermiteSlices } from '../show/routing/termiteSlices';
import { createTour, setTourEnabled, tourActive, tourCurrent, tourInteract, tourProgress, tourTick } from '../show/routing/tour';
import type { TourState } from '../show/routing/tour';
import { layerForIndex } from '../show/routing/vessel';
import type { Vessel } from '../show/routing/vessel';
import { loadRoutingSettings, saveRoutingSettings } from '../utils/routingSettings';
import type { RoutingSettings } from '../utils/routingSettings';
import { createArtifactCache } from './routing/artifactGlyphs';
import { closeBox, drawDetail } from './routing/details';
import { paintSwarm } from './routing/glyphs';
import type { SwarmStyle } from './routing/glyphs';
import { drawOverview } from './routing/overview';
import type { ShowStateSnapshot } from './ShowPanel';

interface RoutingViewProps {
    neurons: Neuron[];
    spikes: SpikeEvent[]; // sorted by timestamp_ms
    showLatestRef: MutableRefObject<ShowStateSnapshot | null>;
    playbackTimeRef: MutableRefObject<number>;
    ledFramesRef: MutableRefObject<StampedLedFrame[]>; // App queues every frame it computes; the view drains them
    telemetryRef: MutableRefObject<Telemetry>;
    firingBlob: FiringBlob | null;
    vessel: Vessel | null;
    patch: PatchData | null;
    termite: TermiteSlices | null;
    connected: boolean;
    presentation: boolean;
    height?: number; // overrides the sizing below
}

const FRAME_MS = 1000 / 30; // a display, not a control: same cap as the circular graph
const FRAME_SLACK_MS = 2; // vsync jitter: without it the gate often skips to 41.7 or 50 ms frames
const MAX_FRAME_MS = 100; // a stall steps the swarms like one slow frame, as the live state and sound sim do
const SWARM_PX = 512;
const SWARM_STYLES: Record<SwarmKey, SwarmStyle> = {
    physarum: { fade: 0.06, dim: 'rgba(140,140,140,0.22)' },
    boids: { fade: 0.18, dim: 'rgba(160,160,160,0.5)' },
    termites: { fade: 0.012, dim: 'rgba(190,190,190,0.35)' },
};
const OUTPUT_LABELS: Record<VisualOutput, string> = { unity: 'Unity direct', td: '+ TD mapping', 'td-sd': '+ TD mapping + StreamDiffusion' };
const PRESENTATION_MIN_H = 360;
const NORMAL_MIN_H = 420;

/** Padding, borders and margins below the canvas, up the page: in presentation the canvas is the
 *  last box in every ancestor, so this is the room the fit leaves under it. */
function spaceBelow(el: Element): number {
    let px = 0;
    for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        px += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0) + (parseFloat(cs.marginBottom) || 0);
    }
    return px;
}

/** Where the show's signal goes and how each medium maps it, drawn live from the playhead. */
export function RoutingView(props: RoutingViewProps) {
    const { neurons, spikes, showLatestRef, playbackTimeRef, ledFramesRef, telemetryRef, firingBlob, vessel, patch, termite, presentation } = props;
    const artifacts = useMemo(createArtifactCache, []); // offscreen layer renders, kept across frames
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tourTextRef = useRef<HTMLSpanElement>(null);
    const tourBarRef = useRef<HTMLSpanElement>(null);
    const layoutRef = useRef<RoutingLayout | null>(null);
    const detailLayoutRef = useRef<DetailLayout | null>(null);
    const detailRef = useRef<MediumKey | null>(null); // the manual choice, null = overview
    const shownRef = useRef<MediumKey | null>(null); // what's on screen now: the tour's stop or the manual choice
    const hoverRef = useRef<MediumKey | null>(null);
    const visibleRef = useRef(true);
    const [settings, setSettings] = useState<RoutingSettings>(() => loadRoutingSettings());
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const connectedRef = useRef(props.connected); // read by the loop: a dropped bridge means local playback
    connectedRef.current = props.connected;
    const tourRef = useRef<TourState>(createTour(performance.now(), settings.tour));
    const [width, setWidth] = useState(0);
    const [fitHeight, setFitHeight] = useState(0);
    const shown = presentation || settings.visible; // presentation always shows it
    const height = props.height ?? (presentation && fitHeight ? fitHeight : Math.max(NORMAL_MIN_H, Math.round((width * 9) / 16)));

    const update = (change: Partial<RoutingSettings>) => setSettings(s => {
        const next = { ...s, ...change };
        saveRoutingSettings(next);
        return next;
    });

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
        tourRef.current = setTourEnabled(tourRef.current, settings.tour, performance.now());
    }, [settings.tour]);

    // Any interaction with the page pauses the tour; it starts again after 60 s of quiet. The
    // tour hands over what it was showing, so touching the screen never jumps the view.
    useEffect(() => {
        const interact = () => {
            const now = performance.now();
            if (tourActive(tourRef.current, now)) detailRef.current = shownRef.current;
            tourRef.current = tourInteract(tourRef.current, now);
        };
        const events = ['pointerdown', 'keydown', 'wheel'] as const;
        for (const e of events) window.addEventListener(e, interact, { passive: true });
        return () => { for (const e of events) window.removeEventListener(e, interact); };
    }, []);

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
        const io = new IntersectionObserver(entries => { visibleRef.current = entries[entries.length - 1].isIntersecting; }); // the newest of a batch
        io.observe(el);
        return () => io.disconnect();
    }, [shown]);

    // Presentation: the rest of the screen below the timeline, whatever its shape. Refitted whenever
    // the panel resizes (the timeline growing once data arrives, the HUD wrapping) or the window does.
    useEffect(() => {
        if (!presentation || !shown) return;
        const fit = () => {
            const el = canvasRef.current;
            if (!el) return;
            const top = el.getBoundingClientRect().top + window.scrollY;
            setFitHeight(Math.max(PRESENTATION_MIN_H, Math.floor(window.innerHeight - top - spaceBelow(el))));
        };
        fit();
        const ro = new ResizeObserver(fit);
        const panel = wrapRef.current?.parentElement;
        if (panel) ro.observe(panel);
        window.addEventListener('resize', fit);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', fit);
        };
    }, [presentation, shown, width]);

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
        const details = detailLayout(width, height);
        layoutRef.current = layout;
        detailLayoutRef.current = details;
        const canvases = {} as Record<SwarmKey, HTMLCanvasElement>;
        for (const k of SWARM_KEYS) canvases[k] = swarms[k].canvas;
        const flee: number[] = [];
        let raf = 0;
        let last = 0;
        let wasTouring = true;
        let tourText = '';

        let failed = false;
        const frame = (ts: number) => {
            raf = requestAnimationFrame(frame);
            if (document.hidden || !visibleRef.current) {
                last = 0;
                return;
            }
            if (last && ts - last < FRAME_MS - FRAME_SLACK_MS) return;
            const dtMs = last ? Math.min(ts - last, MAX_FRAME_MS) : FRAME_MS;
            last = ts;
            try {
                draw(ts, dtMs);
            } catch (e) {
                // One bad frame must not freeze the view for the rest of a show: reset the
                // context (a throw can leave save()s unbalanced) and try again next frame.
                if (!failed) console.error('Routing view frame failed:', e);
                failed = true;
                canvas.width = canvas.width;
            }
        };

        const draw = (ts: number, dtMs: number) => {
            const { index, phase, mode, offRemainingMs, pass, range, fps, config } = routingPlayhead(showLatestRef.current, connectedRef.current, playbackTimeRef.current, neurons.length > 0, ts);

            // The tour picks the view while it runs; a pause leaves the manual choice; when the
            // pause ends it starts again at the overview.
            const tour = (tourRef.current = tourTick(tourRef.current, ts));
            const touring = tourActive(tour, ts);
            if (touring && !wasTouring) detailRef.current = null;
            wasTouring = touring;
            const stop = tourCurrent(tour);
            const open = touring ? (stop === 'overview' ? null : stop) : detailRef.current;
            shownRef.current = open;
            const text = !tour.enabled ? 'TOUR OFF'
                : touring ? `TOUR · ${stop === 'overview' ? 'OVERVIEW' : CARD_TITLES[stop].title}`
                : `TOUR PAUSED · ${formatClock((tour.pausedUntil ?? ts) - ts)}`;
            if (text !== tourText && tourTextRef.current) {
                tourTextRef.current.textContent = text;
                tourText = text;
            }
            if (tourBarRef.current) tourBarRef.current.style.width = `${Math.round(tourProgress(tour, ts) * 100)}%`;

            advanceLive(live, { index, spikes, blob: firingBlob, ledFrames: ledFramesRef.current.splice(0), telemetry: telemetryRef.current, dtMs, now: ts, patch, mode, pass, range });
            // EoC goes dark with its sims paused through OFF: the stand-ins hold where they are too.
            if (phase !== 'off') {
                const frames = dtMs / (1000 / 60);
                fleeSources(swarms.termites.swarm, live.firing, VISUAL_FACTS.threshold, flee);
                for (const k of SWARM_KEYS) {
                    stepSwarm(swarms[k].swarm, live.firing, VISUAL_FACTS.threshold, frames, SWARM_SPECS[k].flees ? flee : null);
                    paintSwarm(swarms[k].canvas, swarms[k].swarm, live.firing, VISUAL_FACTS.threshold, SWARM_STYLES[k], frames);
                }
            }

            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.fillStyle = '#000';
            g.fillRect(0, 0, width, height);
            const input = {
                live,
                swarms: canvases,
                vessel,
                patch,
                range,
                termite,
                artifacts,
                // OFF holds the pass's last layer: the bridge always sends endIndex before /sim_off.
                vesselLayer: vessel ? layerForIndex(vessel, index ?? (phase === 'off' ? range.end : 0)) : 0,
                index,
                mode,
                fps,
                showConfig: config,
                phase,
                offRemainingMs,
                dim: phase === 'off' ? 0.3 : 1,
                hover: open ? null : hoverRef.current,
                visualOutput: settingsRef.current.visualOutput,
                scale: layout.scale,
                now: ts,
            };
            if (open) drawDetail(g, details, open, input);
            else drawOverview(g, layout, input);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [shown, width, height, live, swarms, neurons, spikes, firingBlob, vessel, patch, termite, artifacts, showLatestRef, playbackTimeRef, ledFramesRef, telemetryRef]);

    const local = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top] as const;
    };

    // What a tap at (x, y) would do to what's on screen: open a card, switch to a rail tile,
    // or close the detail.
    const target = (x: number, y: number): { open: MediumKey | null } | null => {
        const layout = layoutRef.current, details = detailLayoutRef.current;
        if (!layout || !details) return null;
        if (!shownRef.current) {
            const key = hitBox(layout.cards, x, y);
            return key ? { open: key } : null;
        }
        const tile = hitBox(details.railTiles, x, y);
        if (tile) return { open: tile };
        if (inside(closeBox(details), x, y) || inside(details.story, x, y)) return { open: null };
        return null;
    };

    const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const [x, y] = local(e);
        hoverRef.current = layoutRef.current ? hitBox(layoutRef.current.cards, x, y) : null;
        e.currentTarget.style.cursor = target(x, y) ? 'pointer' : 'default';
    };

    // pointerdown (window) has already paused the tour and handed over its view.
    const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const t = target(...local(e));
        if (!t) return;
        detailRef.current = t.open;
        shownRef.current = t.open;
    };

    const selectStyle: CSSProperties = { padding: '4px', background: '#111', border: '1px solid #333', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '11px' };

    return (
        <div ref={wrapRef} style={{ marginTop: 'var(--space-md)' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-sm)', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                <div className="flex items-center" style={{ gap: 'var(--space-md)' }}>
                    <span className="data-label" style={{ letterSpacing: '0.12em' }}>ROUTING · SIGNAL → MEDIUM</span>
                    {!props.connected && <span className="data-label" style={{ color: '#ff3333' }}>BRIDGE OFFLINE</span>}
                    {shown && (
                        <span className="data-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span ref={tourTextRef} />
                            <span style={{ display: 'inline-block', width: '48px', height: '2px', background: '#333' }}>
                                <span ref={tourBarRef} style={{ display: 'block', width: '0%', height: '100%', background: '#fff' }} />
                            </span>
                        </span>
                    )}
                </div>
                {!presentation && (
                    <div className="flex items-center" style={{ gap: 'var(--space-sm)' }}>
                        <button className="btn" onClick={() => update({ visible: !settings.visible })}>{settings.visible ? '■ Hide' : '▶ Show'} ROUTING</button>
                        {settings.visible && (
                            <>
                                <button className={`btn ${settings.tour ? 'active' : ''}`} onClick={() => update({ tour: !settings.tour })}>TOUR {settings.tour ? 'ON' : 'OFF'}</button>
                                <label className="data-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    VISUAL OUT
                                    <select value={settings.visualOutput} onChange={e => update({ visualOutput: e.target.value as VisualOutput })} style={selectStyle}>
                                        {(Object.keys(OUTPUT_LABELS) as VisualOutput[]).map(k => <option key={k} value={k}>{OUTPUT_LABELS[k]}</option>)}
                                    </select>
                                </label>
                            </>
                        )}
                    </div>
                )}
            </div>
            {shown && (
                <canvas
                    ref={canvasRef}
                    role="img"
                    aria-label="Routing view: the organoid recording's /index goes to the visuals, sound, solenoids and LEDs; visitors move the robot arms, which feed the sound; the artifacts were grown from this recording before the show"
                    style={{ display: 'block', touchAction: 'manipulation' }}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={() => { hoverRef.current = null; }}
                />
            )}
        </div>
    );
}
