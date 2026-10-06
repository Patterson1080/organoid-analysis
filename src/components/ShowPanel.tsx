import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ShowConfig, ShowState, SpikeEvent } from '../types';
import { cueLabel, cyclePosition, extrapolateIndex, formatClock, lowerBound, phaseRemainingMs, rateBins } from '../show/showMath';

export interface ShowStateSnapshot {
    state: ShowState;
    receivedAt: number; // performance.now() when the SHOW_STATE arrived
}

interface ShowPanelProps {
    spikes: SpikeEvent[];   // sorted by timestamp_ms
    maxNeuronId: number;
    showState: ShowState | null;   // React copy: changes on start/stop/phase/pass
    latestRef: React.MutableRefObject<ShowStateSnapshot | null>;   // every SHOW_STATE, read per frame
    connected: boolean;
    onStart: (config: ShowConfig) => void;
    onStop: () => void;
    presentation?: boolean;   // read-only: no start/stop or config fields, taller raster
}

const RASTER_HALF_MS = 1000;   // raster shows ±1 s of data around the playhead
const OVERVIEW_H = 64;
const TICKS_H = 14;
const CYCLE_H = 10;
const RASTER_H = 160;
const PRESENTATION_RASTER_SHARE = 0.3;   // of the viewport height, at least RASTER_H
const GAP = 8;
const ALPHA_BUCKETS = 5;   // raster dots batched into Path2Ds by distance from the playhead

type NumberField = 'startIndex' | 'endIndex' | 'fps' | 'offSeconds' | 'fadeSeconds';
type FormValues = Record<NumberField, string> & { counts: string[] };

const toForm = (c: ShowConfig): FormValues => ({
    startIndex: String(c.startIndex),
    endIndex: String(c.endIndex),
    fps: String(c.fps),
    offSeconds: String(c.offSeconds),
    fadeSeconds: String(c.fadeSeconds),
    counts: c.spreadCues.map(s => String(s.count)),
});

// The bridge normalizes and repairs the numbers, so strings pass straight through Number().
const fromForm = (f: FormValues, base: ShowConfig): ShowConfig => ({
    ...base,
    startIndex: Number(f.startIndex),
    endIndex: Number(f.endIndex),
    fps: Number(f.fps),
    offSeconds: Number(f.offSeconds),
    fadeSeconds: Number(f.fadeSeconds),
    spreadCues: base.spreadCues.map((s, i) => ({ address: s.address, count: Number(f.counts[i] ?? s.count) })),
});

function hudText(st: ShowState | null, since: number, connected: boolean): string {
    if (!connected) return 'BRIDGE OFFLINE · start it with npm start';
    if (!st) return 'WAITING FOR BRIDGE…';
    const dest = st.destinations.length ? `→ ${st.destinations.join(', ')}` : '→ NO DESTINATION';
    const tail = `LED ${st.leds ? 'BRIDGE' : 'TAB'} · ${dest}`;
    if (!st.running) return `STOPPED · ${tail}`;
    const left = formatClock(phaseRemainingMs(st, since));
    if (st.phase === 'off') return `PASS ${st.pass} · ■ OFF · ON IN ${left} · ${tail}`;
    const end = st.config.endIndex;
    const idx = String(Math.floor(extrapolateIndex(st, since) ?? 0)).padStart(String(end).length, '0');
    return `PASS ${st.pass} · ▶ ON · IDX ${idx} / ${end} · OFF IN ${left} · ${tail}`;
}

export function ShowPanel({ spikes, maxNeuronId, showState, latestRef, connected, onStart, onStop, presentation = false }: ShowPanelProps) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const hudRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [fitRasterH, setFitRasterH] = useState(RASTER_H);
    const rasterH = presentation ? fitRasterH : RASTER_H;
    const [form, setForm] = useState<FormValues | null>(null);
    const [stopArmed, setStopArmed] = useState(false);
    const running = !!showState?.running;
    const config = showState?.config ?? null;
    const hasData = spikes.length > 0;

    // Seed the form from the bridge: its defaults on first contact, the live config while running.
    useEffect(() => {
        if (config && (form === null || running)) setForm(toForm(config));
    }, [config, running]);

    // STOP blacks out the room, so it takes two clicks within 3 s.
    useEffect(() => {
        if (!stopArmed) return;
        const id = setTimeout(() => setStopArmed(false), 3000);
        return () => clearTimeout(id);
    }, [stopArmed]);
    useEffect(() => { if (!running) setStopArmed(false); }, [running]);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (!presentation) return;
        const fit = () => setFitRasterH(Math.max(RASTER_H, Math.round(window.innerHeight * PRESENTATION_RASTER_SHARE)));
        fit();
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
    }, [presentation]);

    // Whole-recording firing-rate strip, rendered once per dataset/range/width.
    const startIndex = config?.startIndex ?? 0;
    const endIndex = config?.endIndex ?? 0;
    const overview = useMemo(() => {
        if (!hasData || width <= 0 || endIndex <= startIndex) return null;
        const dpr = window.devicePixelRatio || 1;
        const bins = rateBins(spikes, startIndex, endIndex, width);
        let max = 0;
        for (const v of bins) if (v > max) max = v;
        const c = document.createElement('canvas');
        c.width = Math.floor(width * dpr);
        c.height = Math.floor(OVERVIEW_H * dpr);
        const g = c.getContext('2d');
        if (!g || max === 0) return c;
        g.scale(dpr, dpr);
        g.fillStyle = '#888888';
        for (let x = 0; x < bins.length; x++) {
            if (!bins[x]) continue;
            const h = Math.max(1, Math.sqrt(bins[x] / max) * (OVERVIEW_H - 2));
            g.fillRect(x, OVERVIEW_H - h, 1, h);
        }
        return c;
    }, [spikes, hasData, width, startIndex, endIndex]);

    // Draw loop: reads latestRef every frame, so App never re-renders at frame rate.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || width <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        const height = OVERVIEW_H + TICKS_H + GAP + CYCLE_H + (hasData ? GAP + rasterH : 0);
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let raf = 0;
        let lastHud = '';
        let parked: number | null = null; // last ON index, held through OFF

        const draw = () => {
            raf = requestAnimationFrame(draw);
            const snap = latestRef.current;
            const st = snap?.state ?? null;
            const since = snap ? performance.now() - snap.receivedAt : 0;

            const hud = hudText(st, since, connected);
            if (hud !== lastHud && hudRef.current) {
                hudRef.current.textContent = hud;
                lastHud = hud;
            }

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, width, height);
            if (!st) return;

            const cfg = st.config;
            const span = Math.max(1, cfg.endIndex - cfg.startIndex);
            const xOf = (frame: number) => ((frame - cfg.startIndex) / span) * width;
            const live = extrapolateIndex(st, since);
            if (live !== null) parked = live;
            if (!st.running) parked = null;
            const idx = live ?? parked;
            const dim = st.phase === 'off';
            ctx.lineWidth = 1;

            // 1. Overview strip + playhead
            ctx.strokeStyle = '#333';
            ctx.strokeRect(0.5, 0.5, width - 1, OVERVIEW_H - 1);
            if (overview) ctx.drawImage(overview, 0, 0, width, OVERVIEW_H);
            if (idx !== null) {
                const x = Math.round(xOf(idx)) + 0.5;
                ctx.strokeStyle = dim ? '#555' : '#fff';
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, OVERVIEW_H);
                ctx.stroke();
            }

            // 2. Reset cue ticks
            ctx.fillStyle = '#888';
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (const cue of st.cues) {
                const x = Math.round(xOf(cue.frame));
                ctx.fillRect(x, OVERVIEW_H, 1, 4);
                ctx.fillText(cueLabel(cue.address), x + 0.5, OVERVIEW_H + 4);
            }

            // 3. Cycle bar: ON | OFF, filled to the current position
            const cy = OVERVIEW_H + TICKS_H + GAP;
            const onW = (st.timing.passMs / st.timing.cycleMs) * width;
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(0, cy, onW, CYCLE_H);
            ctx.fillStyle = 'rgba(255,51,51,0.25)';
            ctx.fillRect(onW, cy, width - onW, CYCLE_H);
            const pos = cyclePosition(st, since);
            if (pos !== null) {
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.fillRect(0, cy, pos * width, CYCLE_H);
                ctx.fillStyle = '#fff';
                ctx.fillRect(Math.round(pos * width) - 1, cy - 2, 2, CYCLE_H + 4);
            }

            // 4. Raster: ±1 s of spikes scrolling past a fixed centre playhead
            if (!hasData) return;
            const ry = cy + CYCLE_H + GAP;
            ctx.strokeStyle = '#333';
            ctx.strokeRect(0.5, ry + 0.5, width - 1, rasterH - 1);
            if (idx !== null) {
                const t0 = idx - RASTER_HALF_MS;
                const t1 = idx + RASTER_HALF_MS;
                const yScale = (rasterH - 6) / Math.max(1, maxNeuronId);
                const paths = Array.from({ length: ALPHA_BUCKETS * 2 }, () => new Path2D());
                for (let i = lowerBound(spikes, t0); i < spikes.length && spikes[i].timestamp_ms <= t1; i++) {
                    const s = spikes[i];
                    const d = Math.min(1, Math.abs(s.timestamp_ms - idx) / RASTER_HALF_MS);
                    const bucket = Math.min(ALPHA_BUCKETS - 1, Math.floor(d * ALPHA_BUCKETS));
                    const x = ((s.timestamp_ms - t0) / (2 * RASTER_HALF_MS)) * width;
                    paths[(s.timestamp_ms <= idx ? 0 : ALPHA_BUCKETS) + bucket].rect(x - 1, ry + 2 + s.neuron_id * yScale, 2, 2);
                }
                paths.forEach((p, k) => {
                    const bucket = k % ALPHA_BUCKETS;
                    ctx.globalAlpha = (dim ? 0.3 : 1) * (1 - (0.8 * (bucket + 0.5)) / ALPHA_BUCKETS);
                    ctx.fillStyle = k < ALPHA_BUCKETS ? '#fff' : '#888';
                    ctx.fill(p);
                });
                ctx.globalAlpha = 1;
            }
            const cx = Math.round(width / 2) + 0.5;
            ctx.strokeStyle = dim || idx === null ? '#555' : '#fff';
            ctx.beginPath();
            ctx.moveTo(cx, ry);
            ctx.lineTo(cx, ry + rasterH);
            ctx.stroke();
        };
        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [width, rasterH, spikes, hasData, overview, maxNeuronId, connected, latestRef]);

    const handleButton = () => {
        if (running) {
            if (stopArmed) onStop();
            setStopArmed(!stopArmed);
        } else if (config && form) {
            onStart(fromForm(form, config));
        }
    };

    const inputStyle: React.CSSProperties = {
        width: '84px', padding: '4px', background: '#111', border: '1px solid #333', color: '#fff',
        fontFamily: 'var(--font-mono)', fontSize: '11px',
    };
    const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '2px' };
    const field = (label: string, key: NumberField) => (
        <label className="data-label" style={labelStyle}>
            {label}
            <input
                type="number"
                value={form?.[key] ?? ''}
                disabled={running || !form}
                onChange={e => { const v = e.target.value; setForm(f => f && { ...f, [key]: v }); }}
                style={inputStyle}
            />
        </label>
    );

    return (
        <div ref={wrapRef}>
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-sm)' }}>
                <h2 style={{ margin: 0 }}>SHOW</h2>
                {!presentation && <button
                    className="btn"
                    disabled={!connected || !form}
                    onClick={handleButton}
                    style={running ? { color: '#ff3333', borderColor: '#ff3333' } : undefined}
                >
                    {running ? (stopArmed ? '■ CONFIRM STOP (FADES TO BLACK)' : '■ STOP SHOW') : '▶ START SHOW'}
                </button>}
            </div>
            <div
                ref={hudRef}
                style={{ fontFamily: 'var(--font-mono)', fontSize: presentation ? '15px' : '12px', letterSpacing: '0.06em', marginBottom: 'var(--space-sm)', minHeight: '1.4em' }}
            />
            <canvas ref={canvasRef} style={{ display: 'block' }} />
            {!presentation && <div className="flex" style={{ gap: 'var(--space-md)', flexWrap: 'wrap', marginTop: 'var(--space-md)' }}>
                {field('Start idx', 'startIndex')}
                {field('End idx', 'endIndex')}
                {field('Idx / s', 'fps')}
                {field('Off (s)', 'offSeconds')}
                {field('Fade (s)', 'fadeSeconds')}
                {config?.spreadCues.map((c, i) => (
                    <label key={c.address} className="data-label" style={labelStyle}>
                        {c.address} ×
                        <input
                            type="number"
                            value={form?.counts[i] ?? ''}
                            disabled={running || !form}
                            onChange={e => {
                                const v = e.target.value;
                                setForm(f => f && { ...f, counts: f.counts.map((n, j) => (j === i ? v : n)) });
                            }}
                            style={inputStyle}
                        />
                    </label>
                ))}
            </div>}
        </div>
    );
}
