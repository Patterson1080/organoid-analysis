// End-to-end check of show mode through a real bridge process. Not part of `npm test` (it binds
// ports and takes a few seconds). It runs on its own ports, so working bridges can stay up:
//   node scripts/show-smoke.mjs
// Spawns server/osc-bridge.js, points it at a local OSC listener, runs a 1 s pass + 1 s
// off, simulates a tab reload mid-show (initial CONFIG with defaults), a stray local
// OSC_BUNDLE and a second START, then STOPs. Also checks that a cross-site page is
// refused, an out-of-range port is dropped, inbound OSC reaches tabs as { address, args },
// data/ is served to local pages only, and the bridge lights the LEDs itself (a fake serial
// bridge counts its frames). A monitor (server/monitor.js) must get the show's messages plus the
// positions, the features and the relayed /routing/*, and the show's destination none of those.
// Exits 1 on any mismatch.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { Client, Server } from 'node-osc';

const OSC_PORT = 39124;
const MONITOR_PORT = 39125;
const WS_PORT = 38080;
const SERIAL_PORT = 38081;
const OSC_IN_PORT = 33333;
const WS_URL = `ws://127.0.0.1:${WS_PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const received = [];
const monitored = [];
let bridge;

function fail(msg) {
    console.error(`FAIL: ${msg}`);
    bridge?.kill();
    process.exit(1);
}

// Every message is buffered from the moment the socket exists: the bridge's first
// SHOW_STATE can arrive in the same packet as the handshake.
async function connect() {
    for (let i = 0; i < 20; i++) {
        try {
            return await new Promise((resolve, reject) => {
                const ws = new WebSocket(WS_URL);
                ws.inbox = [];
                ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
                ws.once('open', () => resolve(ws));
                ws.once('error', reject);
            });
        } catch {
            await sleep(150);
        }
    }
    fail(`could not connect to the bridge on ${WS_URL}`);
}

// Takes the oldest unread message of `type` (waits up to 3 s for one).
async function next(ws, type) {
    for (let waited = 0; waited < 3000; waited += 10) {
        const i = ws.inbox.findIndex(m => m.type === type);
        if (i >= 0) return ws.inbox.splice(i, 1)[0].payload;
        await sleep(10);
    }
    fail(`no ${type} within 3 s`);
}

// GET from the bridge's HTTP side with a given Origin → { status, origin header, body }.
const get = (urlPath, origin, host) => new Promise((resolve, reject) => {
    const headers = { ...(origin && { Origin: origin }), ...(host && { Host: host }) };
    http.get({ host: '127.0.0.1', port: WS_PORT, path: urlPath, headers }, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, allow: res.headers['access-control-allow-origin'], body }));
    }).on('error', reject);
});

// A small show dataset: 8 neurons, 60 ms of matrix; neuron (ms % 8) + 1 fires every ms and
// all 8 fire at 30 ms (a burst).
const dataDir = await mkdtemp(path.join(tmpdir(), 'show-smoke-'));
const neuronsCsv = 'neuron_id,x,y,is_backbone\n' + Array.from({ length: 8 }, (_, i) => `${i + 1},${i},${7 - i},0`).join('\n') + '\n';
await writeFile(path.join(dataDir, 'neurons.csv'), neuronsCsv);
const matrixRows = Array.from({ length: 60 }, (_, ms) => Array.from({ length: 8 }, (_, c) => (ms === 30 || c === ms % 8 ? 1 : 0)).join(','));
await writeFile(path.join(dataDir, 'spikes.csv'), Array.from({ length: 8 }, (_, c) => `t_spk_mat_${c}`).join(',') + '\n' + matrixRows.join('\n') + '\n');

const ledFrames = [];
const serial = new WebSocketServer({ host: '127.0.0.1', port: SERIAL_PORT });
serial.on('connection', ws => ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'SERIAL_SYNC') ledFrames.push(m.payload);
}));

const osc = await new Promise(resolve => { const s = new Server(OSC_PORT, '127.0.0.1', () => resolve(s)); });
osc.on('message', ([address, ...args]) => received.push({ address, args, at: performance.now() }));
const monitor = await new Promise(resolve => { const s = new Server(MONITOR_PORT, '127.0.0.1', () => resolve(s)); });
monitor.on('message', ([address, ...args]) => monitored.push({ address, args }));

bridge = spawn(process.execPath, ['server/osc-bridge.js'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ORGANOID_DATA_DIR: dataDir, ORGANOID_WS_PORT: String(WS_PORT), ORGANOID_SERIAL_WS_URL: `ws://127.0.0.1:${SERIAL_PORT}`, ORGANOID_OSC_IN_PORT: String(OSC_IN_PORT) },
});
bridge.on('exit', code => { if (code) fail(`bridge exited with ${code} (ports ${WS_PORT}/${OSC_IN_PORT} busy?)`); });

const tab = await connect();
const first = await next(tab, 'SHOW_STATE');
if (first.running || first.config.endIndex !== 179999) fail('fresh bridge should be stopped with default config');
if (first.destinations.join() !== '127.0.0.1:1234') fail(`default destination ${first.destinations}`);

// data/ goes to local pages; another site gets nothing.
const status = await get('/data/status', 'http://localhost:5173');
if (status.status !== 200 || status.allow !== 'http://localhost:5173' || status.body !== '{"neurons":true,"spikes":true,"firing":false,"vessel":false,"activity":false,"bursts":false,"termite":false}') {
    fail(`data status ${JSON.stringify(status)}`);
}
if ((await get('/data/neurons.csv', 'http://localhost:5173')).body !== neuronsCsv) fail('neurons.csv not served as-is');
if ((await get('/data/spikes.csv', 'https://evil.example')).status !== 403) fail('data served to a cross-site page');
if ((await get('/data/spikes.csv', undefined, `evil.example:${WS_PORT}`)).status !== 403) fail('data served to a rebound host name');

// The bridge has loaded data/ and linked the serial bridge: it drives the LEDs.
let leds = first.leds;
for (let i = 0; i < 300 && !leds; i++) {
    await sleep(10);
    leds = tab.inbox.some(m => m.type === 'SHOW_STATE' && m.payload.leds);
}
if (!leds) fail('bridge never reported leds (data/ load or serial link failed)');

// A page from another site must not get in (cross-site WebSocket hijacking).
const refused = await new Promise(resolve => {
    const evil = new WebSocket(WS_URL, { origin: 'https://evil.example' });
    evil.once('open', () => { evil.close(); resolve(false); });
    evil.once('error', () => resolve(true));
    evil.once('unexpected-response', () => resolve(true));
});
if (!refused) fail('bridge accepted a cross-site Origin');

// An out-of-range port is dropped: dgram would throw on send and take the bridge down.
tab.send(JSON.stringify({ type: 'CONFIG', payload: { oscOutIp: '127.0.0.1', oscOutPort: 99999 } }));
if ((await next(tab, 'SHOW_STATE')).destinations.length !== 0) fail('out-of-range port kept as a destination');

tab.send(JSON.stringify({ type: 'CONFIG', payload: { oscOutIp: '127.0.0.1', oscOutPort: OSC_PORT } }));
if ((await next(tab, 'SHOW_STATE')).destinations.join() !== `127.0.0.1:${OSC_PORT}`) fail('CONFIG did not re-point destinations');

// A monitor is kept; a show output and the bridge's own OSC input listed as monitors are not.
tab.send(JSON.stringify({ type: 'CONFIG', payload: { oscMonitorIp: `127.0.0.1:${MONITOR_PORT}, 127.0.0.1:${OSC_PORT}, 127.0.0.1:${OSC_IN_PORT}` } }));
const withMonitor = await next(tab, 'SHOW_STATE');
if (withMonitor.monitors.join() !== `127.0.0.1:${MONITOR_PORT}`) fail(`monitors ${withMonitor.monitors}`);
if (withMonitor.destinations.join() !== `127.0.0.1:${OSC_PORT}`) fail('setting a monitor changed the destinations');

// Inbound OSC reaches tabs as { address, args } (the OSC Bridge panel reads both).
const inbound = new Client('127.0.0.1', OSC_IN_PORT);
inbound.send('/row', 42);
const oscMsg = await next(tab, 'OSC_MSG');
if (oscMsg.address !== '/row' || oscMsg.args[0] !== 42) fail(`OSC_MSG payload ${JSON.stringify(oscMsg)}`);

tab.send(JSON.stringify({ type: 'SHOW_START', payload: { config: { endIndex: 59, offSeconds: 1, fadeSeconds: 1 } } }));
await sleep(400);

// Tab reload mid-show: the new tab pushes default settings as its initial CONFIG.
const reloaded = await connect();
reloaded.send(JSON.stringify({ type: 'CONFIG', initial: true, payload: { oscOutIp: '127.0.0.1', oscOutPort: 1234 } }));
inbound.send('/routing/robot/1/proximity', 42.5); // an arm reports mid-show
const rs = await next(reloaded, 'SHOW_STATE');
if (!rs.running || rs.phase !== 'on') fail('reloaded tab did not receive the running state');
if ((await next(reloaded, 'OSC_CONFIG')).oscOutPort !== OSC_PORT) fail('bridge did not hand back its live OSC config');

// Stray local playback and a second START must not reach the show output.
reloaded.send(JSON.stringify({ type: 'OSC_BUNDLE', payload: { time: 99999, neurons: [] } }));
reloaded.send(JSON.stringify({ type: 'SHOW_START', payload: { config: {} } }));

await sleep(1200); // through the end of the pass into OFF
tab.send(JSON.stringify({ type: 'SHOW_STOP' }));
await sleep(200);
// Local playback: the page's own monitor signals ride its bundle, to the monitor only.
tab.send(JSON.stringify({ type: 'OSC_BUNDLE', payload: { neurons: [], monitor: [{ address: '/feature/playback', args: [3] }, { address: 'bad', args: [1] }] } }));
await sleep(200);
tab.close();
reloaded.close();
inbound.close();
osc.close();
monitor.close();
serial.close();
bridge.kill();

const addrs = received.map(m => m.address);
const indices = received.filter(m => m.address === '/index').map(m => m.args[0]);
const count = a => addrs.filter(x => x === a).length;
if (count('/sim_on') !== 1) fail(`expected one /sim_on, got ${count('/sim_on')}`);
if (count('/sim_off') !== 2) fail(`expected /sim_off at pass end + STOP, got ${count('/sim_off')}`);
if (indices.includes(99999)) fail('stray OSC_BUNDLE /index leaked into the show');
if (indices.length < 55 || indices.at(-1) !== 59) fail(`index stream ${indices.length} msgs, last ${indices.at(-1)}`);
if (count('/sim_resetTermites') !== 5 || count('/sim_resetPhysarum') !== 10) fail('spread resets missing');
const passMs = received.find(m => m.address === '/sim_off').at - received.find(m => m.address === '/index').at;
if (passMs < 950 || passMs > 1150) fail(`pass took ${passMs.toFixed(0)} ms`);
// One LED frame per tick (a late tick covers several ms), so fewer than 60 under load.
if (ledFrames.length < 30) fail(`bridge sent ${ledFrames.length} LED frames during the pass`);
if (!ledFrames.some(f => f.isBurst && f.firings.length >= 8)) fail('the 8-neuron burst at 30 ms never lit');
// The show's destination gets the show and nothing else; the monitor gets the show and the extras.
const extra = received.find(m => !['/index', '/sim_resetSimsOnly', '/sim_on', '/sim_off', '/sim_resetTermites', '/sim_resetPhysarum'].includes(m.address));
if (extra) fail(`the show destination got ${extra.address}`);
const heard = a => monitored.filter(m => m.address === a);
const monitorIndices = heard('/index').map(m => m.args[0]);
if (monitorIndices.join() !== indices.join()) fail(`the monitor heard ${monitorIndices.length} /index, the destination ${indices.length}`);
for (const a of ['/sim_on', '/sim_off', '/sim_resetTermites']) if (heard(a).length !== count(a)) fail(`the monitor heard ${heard(a).length} ${a}`);
// The neurons' own positions (x + y = 7 in this dataset), not 0–15 LED cells; five in the trail.
const xs = heard('/x1'), ys = heard('/y1');
if (xs.length < 30 || xs.length !== ys.length || xs.some((m, i) => m.args[0] + ys[i].args[0] !== 7)) fail(`positions: ${xs.length} /x1, ${ys.length} /y1`);
if (heard('/x5').length < 25 || heard('/x6').length !== 0) fail('the trail should send /x1 to /x5');
const rates = heard('/feature/rate').map(m => m.args[0]);
if (rates.length < 30 || rates.at(-1) !== 67 || heard('/feature/burst').length !== rates.length) fail(`features: ${rates.length} rates, last ${rates.at(-1)}`);
// Every tick: neurons that fired (1 a ms here, all 8 at ms 30); the backbone ones among them
// (the parser reads this dataset's neuron 1 as backbone); bursting; the LED frame's points.
const firing = heard('/feature/firing').map(m => m.args[0]);
if (firing.length !== rates.length || Math.max(...firing) !== 8 || firing.some(n => n < 1)) fail(`firing ${firing.length}, max ${Math.max(...firing)}`);
const backbone = heard('/feature/backbone').map(m => m.args[0]);
if (backbone.length !== rates.length || Math.max(...backbone) !== 1) fail(`backbone ${backbone.length}, max ${Math.max(...backbone)}`);
if (heard('/feature/bursting').length !== rates.length) fail(`bursting ${heard('/feature/bursting').length}`);
const led = heard('/routing/led').map(m => m.args[0]);
if (led.length !== ledFrames.length || Math.max(...led) < 8) fail(`/routing/led ${led.length} for ${ledFrames.length} frames`);
// The pass and phase, told when the monitor is added (stopped) and at every change after.
const phases = heard('/show/phase').map(m => m.args[0]).join();
const passes = heard('/show/pass').map(m => m.args[0]).join();
if (phases !== 'stopped,on,off,stopped' || passes !== '0,1,1,0') fail(`phases ${phases}, passes ${passes}`);
const arm = heard('/routing/robot/1/proximity');
if (arm.length !== 1 || arm[0].args[0] !== 42.5) fail(`relayed arm reading ${JSON.stringify(arm)}`);
if (heard('/feature/playback').map(m => m.args[0]).join() !== '3' || heard('bad').length !== 0) fail('local playback signals did not reach the monitor as sent');
if (heard('/row').length !== 0) fail('inbound /row was relayed to the monitor');

console.log(`OK: ${indices.length} /index, 15 resets, 1 /sim_on, 2 /sim_off, pass ${passMs.toFixed(0)} ms, reload-safe, cross-site refused, ` +
    `bad port dropped, inbound OSC shaped, data/ served locally, ${ledFrames.length} LED frames from the bridge, ` +
    `monitor heard the show + ${xs.length} positions, ${rates.length} rates and the arm, the destination none of them`);
