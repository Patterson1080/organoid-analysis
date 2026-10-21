// ROBOT as the arms are built (dev/arms): a pod on the pipe, a carbon spine hanging through its
// vertebrae with mylar leaves, the tendon the servo pulls, the optical fibres a touch lights, and the
// tip's ultrasonic sensor with whoever it reads. Plus the rule the firmware moves by.

import { ARM_RULES, servoTarget } from '../../show/routing/arms';
import type { Box } from '../../show/routing/layout';
import { fontPx } from '../../show/routing/layout';
import { armIsLive } from '../../show/routing/live';
import type { Arm } from '../../show/routing/live';
import { clipTo, frame, text } from './glyphs';
import type { G } from './glyphs';

const CONE_HALF = (15 * Math.PI) / 180; // an HC-SR04's beam is about 30° wide
const LEAVES_AT = [2, 4, 6]; // vertebrae carrying a pair of leaves

/** Where the arm is in the firmware's loop, in a few words. */
export function armPhaseText(arm: Arm): string {
    const m = arm.motion;
    if (m.phase === 'moving') return `→ ${Math.round(m.target)}°`;
    if (m.phase === 'settling') return 'settling';
    if (m.phase === 'cooldown') return `cooldown ${(m.phaseLeftMs / 1000).toFixed(1)} s`;
    return arm.cm >= ARM_RULES.rangeCm ? 'nobody' : `${Math.round(arm.cm)} cm`;
}

/** The angle along the spine at t (0 top … 1 tip), between the three lagging segment angles. */
function spineAngle(th: number[], t: number): number {
    return t < 0.5 ? th[0] + (th[1] - th[0]) * (t / 0.5) : th[1] + (th[2] - th[1]) * ((t - 0.5) / 0.5);
}

/** One arm hanging from (x, top): spine `len` long, then the sensor cone `cone` long. */
function drawArm(g: G, x: number, top: number, len: number, cone: number, arm: Arm, s: number, labels: boolean) {
    const podW = 14 * s, podH = 15 * s, n = ARM_RULES.vertebrae, seg = len / n;
    g.fillStyle = armIsLive(arm) ? '#e8e8e8' : '#bdbdbd';
    g.fillRect(x - podW / 2, top, podW, podH);
    const pts: [number, number, number][] = [[x, top + podH, spineAngle(arm.th, 0)]]; // x, y, angle
    for (let i = 0; i < n; i++) {
        const a = spineAngle(arm.th, (i + 0.5) / n), [px, py] = pts[i];
        pts.push([px + Math.sin(a) * seg, py + Math.cos(a) * seg, a]);
    }
    const offset = (d: number) => pts.map(([px, py, a]) => [px + Math.cos(a) * d, py - Math.sin(a) * d] as [number, number]);
    const poly = (p: [number, number][], color: string, width: number) => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        p.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.stroke();
    };
    poly(offset(-2.5 * s), `rgba(0,255,255,${(0.12 + 0.88 * arm.light).toFixed(3)})`, Math.max(1, s * (1 + arm.light))); // fibres
    poly(offset(3.5 * s), '#9c8a6a', 1); // the tendon, on the side it pulls
    poly(pts.map(([px, py]) => [px, py] as [number, number]), '#dcdcdc', 2 * s); // the carbon spine
    pts.slice(1).forEach(([px, py, a], i) => {
        const nx = Math.cos(a) * 5 * s, ny = -Math.sin(a) * 5 * s;
        poly([[px - nx, py - ny], [px + nx, py + ny]], '#8fa0a0', 1.5 * s); // a vertebra
        if (!LEAVES_AT.includes(i + 1)) return;
        for (const side of [-1, 1]) { // a mylar leaf each side
            const lx = px + side * nx * 2.6, ly = py + side * ny * 2.6;
            g.fillStyle = `rgba(190,225,205,${(0.18 + 0.5 * arm.light).toFixed(3)})`;
            g.beginPath();
            g.ellipse((px + lx) / 2, (py + ly) / 2, 7 * s, 2.4 * s, -a + (side > 0 ? 0 : Math.PI), 0, Math.PI * 2);
            g.fill();
        }
    });
    // The tip pod, and the sensor looking down the arm.
    const [tx, ty, ta] = pts[n];
    g.save();
    g.translate(tx, ty);
    g.rotate(-ta);
    g.fillStyle = '#cfcfcf';
    g.fillRect(-5 * s, 0, 10 * s, 7 * s);
    if (cone > 4 * s) {
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.beginPath();
        g.moveTo(0, 7 * s);
        g.arc(0, 7 * s, cone, Math.PI / 2 - CONE_HALF, Math.PI / 2 + CONE_HALF);
        g.closePath();
        g.fill();
        if (arm.cm < ARM_RULES.rangeCm) { // someone in range: an arc at their distance, and them
            const r = 7 * s + (cone * arm.cm) / ARM_RULES.rangeCm;
            g.strokeStyle = arm.live.proximity ? '#fff' : 'rgba(255,255,255,0.75)';
            g.lineWidth = 1.5 * s;
            g.beginPath();
            g.arc(0, 7 * s, r - 7 * s, Math.PI / 2 - CONE_HALF, Math.PI / 2 + CONE_HALF);
            g.stroke();
            g.fillStyle = g.strokeStyle;
            g.beginPath();
            g.arc(0, r + 3 * s, 3 * s, 0, Math.PI * 2);
            g.fill();
        }
    }
    g.restore();
    if (labels) {
        const px = fontPx(8, s);
        text(g, `${Math.round(arm.servo)}°`, x + podW / 2 + 3 * s, top + (podH - px) / 2, px, '#bbb');
    }
}

/** Arms side by side from one pipe; with `cone`, each tip shows what it senses. */
export function armsPanel(g: G, b: Box, arms: Arm[], s: number, opts: { cone: boolean; labels: boolean }): void {
    const px = fontPx(8, s), foot = opts.labels ? px * 2.6 : 0;
    g.save();
    clipTo(g, b); // a curled arm and its cone stay inside the panel
    g.fillStyle = '#666';
    g.fillRect(b.x, b.y + 2 * s, b.w, Math.max(1, 2.5 * s)); // the pipe or truss
    const usable = b.h - 18 * s - foot, len = usable * (opts.cone ? 0.58 : 0.92), cone = opts.cone ? usable - len : 0;
    arms.forEach((arm, k) => {
        const x = b.x + (k + 0.38) * (b.w / arms.length); // a little left of centre: the arms curl right
        drawArm(g, x, b.y + 4 * s, len, cone, arm, s, opts.labels);
        if (!opts.labels) return;
        const tag = arm.live.proximity ? 'LIVE' : 'sim'; // the distance's own source
        text(g, `arm ${k + 1} · ${armPhaseText(arm)}`, x, b.y + b.h - foot, px, '#ccc', 'center');
        text(g, `${Math.round(arm.cm)} cm · ${tag}`, x, b.y + b.h - foot + px * 1.3, px, arm.live.proximity ? '#fff' : '#777', 'center');
    });
    g.restore();
}

/** The firmware's rule: distance → target angle, with each arm where it is and its ±10° deadband. */
export function armRuleChart(g: G, b: Box, arms: Arm[], s: number): void {
    const px = fontPx(8, s), pad = px * 1.6;
    const plot: Box = { x: b.x + pad * 1.6, y: b.y + px * 0.4, w: b.w - pad * 1.8, h: b.h - pad - px * 0.4 };
    frame(g, plot, '#2a2a2a');
    const X = (cm: number) => plot.x + (cm / ARM_RULES.rangeCm) * plot.w, Y = (deg: number) => plot.y + plot.h - (deg / ARM_RULES.servoMax) * plot.h;
    g.strokeStyle = '#777';
    g.lineWidth = 1;
    g.beginPath();
    for (let cm = 0; cm <= ARM_RULES.rangeCm; cm++) (cm ? g.lineTo : g.moveTo).call(g, X(cm), Y(servoTarget(cm)));
    g.stroke();
    arms.forEach((arm, k) => {
        const x = X(Math.min(ARM_RULES.rangeCm, arm.cm));
        const hi = Math.min(ARM_RULES.servoMax, arm.servo + ARM_RULES.deadbandDeg), lo = Math.max(0, arm.servo - ARM_RULES.deadbandDeg);
        g.fillStyle = 'rgba(255,255,255,0.08)'; // the deadband the arm sits in, clipped to the servo's range
        g.fillRect(plot.x, Y(hi), plot.w, Y(lo) - Y(hi));
        g.fillStyle = armIsLive(arm) ? '#fff' : '#bbb';
        g.beginPath();
        g.arc(x, Y(arm.servo), 3.5 * s, 0, Math.PI * 2);
        g.fill();
        text(g, String(k + 1), x + 5 * s, Y(arm.servo) - px, px, '#ccc');
    });
    text(g, '0', plot.x, plot.y + plot.h + 2 * s, px, '#666');
    text(g, '100 cm', plot.x + plot.w, plot.y + plot.h + 2 * s, px, '#666', 'right');
    text(g, '180°', plot.x - 3 * s, plot.y, px, '#666', 'right');
    text(g, '0°', plot.x - 3 * s, plot.y + plot.h - px, px, '#666', 'right');
}
