// End-to-end check of show mode through a real bridge process. Not part of `npm test`
// (it binds the bridges' fixed ports 8080/8081/3333). Stop any running bridges first, then:
//   node scripts/show-smoke.mjs
// Spawns server/osc-bridge.js, points it at a local OSC listener, runs a 1 s pass + 1 s
// off, simulates a tab reload mid-show (initial CONFIG with defaults), a stray local
// OSC_BUNDLE and a second START, then STOPs. Also checks that a cross-site page is
// refused, an out-of-range port is dropped, inbound OSC reaches tabs as { address, args },
// data/ is served to local pages only, and the bridge lights the LEDs itself (a fake serial
// bridge on 8081 counts its frames). Exits 1 on any mismatch.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { Client, Server } from 'node-osc';

const OSC_PORT = 39124;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const received = [];
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
                const ws = new WebSocket('ws://127.0.0.1:8080');
                ws.inbox = [];
                ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
                ws.once('open', () => resolve(ws));
                ws.once('error', reject);
            });
        } catch {
            await sleep(150);
        }
    }
    fail('could not connect to the bridge on ws://127.0.0.1:8080');
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
    http.get({ host: '127.0.0.1', port: 8080, path: urlPath, headers }, res => {
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
const serial = new WebSocketServer({ host: '127.0.0.1', port: 8081 });
serial.on('connection', ws => ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'SERIAL_SYNC') ledFrames.push(m.payload);
}));

const osc = await new Promise(resolve => { const s = new Server(OSC_PORT, '127.0.0.1', () => resolve(s)); });
osc.on('message', ([address, ...args]) => received.push({ address, args, at: performance.now() }));

bridge = spawn(process.execPath, ['server/osc-bridge.js'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ORGANOID_DATA_DIR: dataDir },
});
bridge.on('exit', code => { if (code) fail(`bridge exited with ${code} (ports 8080/3333 busy?)`); });

const tab = await connect();
const first = await next(tab, 'SHOW_STATE');
if (first.running || first.config.endIndex !== 179999) fail('fresh bridge should be stopped with default config');
if (first.destinations.join() !== '127.0.0.1:1234') fail(`default destination ${first.destinations}`);

// data/ goes to local pages; another site gets nothing.
const status = await get('/data/status', 'http://localhost:5173');
if (status.status !== 200 || status.allow !== 'http://localhost:5173' || status.body !== '{"neurons":true,"spikes":true}') {
    fail(`data status ${JSON.stringify(status)}`);
}
if ((await get('/data/neurons.csv', 'http://localhost:5173')).body !== neuronsCsv) fail('neurons.csv not served as-is');
if ((await get('/data/spikes.csv', 'https://evil.example')).status !== 403) fail('data served to a cross-site page');
if ((await get('/data/spikes.csv', undefined, 'evil.example:8080')).status !== 403) fail('data served to a rebound host name');

// The bridge has loaded data/ and linked the serial bridge: it drives the LEDs.
let leds = first.leds;
for (let i = 0; i < 300 && !leds; i++) {
    await sleep(10);
    leds = tab.inbox.some(m => m.type === 'SHOW_STATE' && m.payload.leds);
}
if (!leds) fail('bridge never reported leds (data/ load or serial link failed)');

// A page from another site must not get in (cross-site WebSocket hijacking).
const refused = await new Promise(resolve => {
    const evil = new WebSocket('ws://127.0.0.1:8080', { origin: 'https://evil.example' });
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

// Inbound OSC reaches tabs as { address, args } (the OSC Bridge panel reads both).
const inbound = new Client('127.0.0.1', 3333);
inbound.send('/row', 42);
const oscMsg = await next(tab, 'OSC_MSG');
inbound.close();
if (oscMsg.address !== '/row' || oscMsg.args[0] !== 42) fail(`OSC_MSG payload ${JSON.stringify(oscMsg)}`);

tab.send(JSON.stringify({ type: 'SHOW_START', payload: { config: { endIndex: 59, offSeconds: 1, fadeSeconds: 1 } } }));
await sleep(400);

// Tab reload mid-show: the new tab pushes default settings as its initial CONFIG.
const reloaded = await connect();
reloaded.send(JSON.stringify({ type: 'CONFIG', initial: true, payload: { oscOutIp: '127.0.0.1', oscOutPort: 1234 } }));
const rs = await next(reloaded, 'SHOW_STATE');
if (!rs.running || rs.phase !== 'on') fail('reloaded tab did not receive the running state');
if ((await next(reloaded, 'OSC_CONFIG')).oscOutPort !== OSC_PORT) fail('bridge did not hand back its live OSC config');

// Stray local playback and a second START must not reach the show output.
reloaded.send(JSON.stringify({ type: 'OSC_BUNDLE', payload: { time: 99999, neurons: [] } }));
reloaded.send(JSON.stringify({ type: 'SHOW_START', payload: { config: {} } }));

await sleep(1200); // through the end of the pass into OFF
tab.send(JSON.stringify({ type: 'SHOW_STOP' }));
await sleep(200);
tab.close();
reloaded.close();
osc.close();
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
console.log(`OK: ${indices.length} /index, 15 resets, 1 /sim_on, 2 /sim_off, pass ${passMs.toFixed(0)} ms, reload-safe, cross-site refused, ` +
    `bad port dropped, inbound OSC shaped, data/ served locally, ${ledFrames.length} LED frames from the bridge`);
