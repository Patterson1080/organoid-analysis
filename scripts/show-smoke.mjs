// End-to-end check of show mode through a real bridge process. Not part of `npm test`
// (it binds the bridge's fixed ports 8080/3333). Stop any running bridge first, then:
//   node scripts/show-smoke.mjs
// Spawns server/osc-bridge.js, points it at a local OSC listener, runs a 1 s pass + 1 s
// off, simulates a tab reload mid-show (initial CONFIG with defaults), a stray local
// OSC_BUNDLE and a second START, then STOPs. Exits 1 on any mismatch.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { Server } from 'node-osc';

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

const osc = await new Promise(resolve => { const s = new Server(OSC_PORT, '127.0.0.1', () => resolve(s)); });
osc.on('message', ([address, ...args]) => received.push({ address, args, at: performance.now() }));

bridge = spawn(process.execPath, ['server/osc-bridge.js'], { stdio: ['ignore', 'ignore', 'inherit'] });
bridge.on('exit', code => { if (code) fail(`bridge exited with ${code} (ports 8080/3333 busy?)`); });

const tab = await connect();
const first = await next(tab, 'SHOW_STATE');
if (first.running || first.config.endIndex !== 179999) fail('fresh bridge should be stopped with default config');
if (first.destinations.join() !== '127.0.0.1:1234') fail(`default destination ${first.destinations}`);

tab.send(JSON.stringify({ type: 'CONFIG', payload: { oscOutIp: '127.0.0.1', oscOutPort: OSC_PORT } }));
if ((await next(tab, 'SHOW_STATE')).destinations.join() !== `127.0.0.1:${OSC_PORT}`) fail('CONFIG did not re-point destinations');

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
console.log(`OK: ${indices.length} /index, 15 resets, 1 /sim_on, 2 /sim_off, pass ${passMs.toFixed(0)} ms, reload-safe`);
