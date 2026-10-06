import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client, Server } from 'node-osc';
import { WebSocketServer, WebSocket } from 'ws';
import { createShowRunner } from './show-runner.js';
import { isLocalHost, isLocalOrigin } from './local-origin.js';
import { loadNeurons, loadSpikeFrames, spikeIdsBetween } from './show-data.js';
import { ledStep, neuronBounds, neuronsById, showOutputAfter } from '../src/show/ledFrame.ts';

// Default Configuration
const DEFAULT_OSC_IN_PORT = 3333;
const DEFAULT_OSC_OUT_PORT = 1234; // EoC-biomes OSCMapping port in the show scenes
const DEFAULT_OSC_OUT_IP = '127.0.0.1';
const WS_PORT = 8080;
const SERIAL_WS_URL = 'ws://127.0.0.1:8081';

// The show dataset: data/neurons.csv + data/spikes.csv (usually symlinks to the real files).
// Served to the page and read here to drive the LEDs. ORGANOID_DATA_DIR overrides (tests).
const DATA_DIR = process.env.ORGANOID_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url));
const DATA_FILES = { neurons: path.join(DATA_DIR, 'neurons.csv'), spikes: path.join(DATA_DIR, 'spikes.csv') };
const DATA_ROUTES = new Map([['/data/neurons.csv', DATA_FILES.neurons], ['/data/spikes.csv', DATA_FILES.spikes]]);

// State
let oscServer;
let oscClients = []; // One OSC Client per destination
let oscDestinations = []; // { ip, port } of each client, for the show HUD
let wsServer;
let oscInPort = DEFAULT_OSC_IN_PORT;
let oscOutPort = DEFAULT_OSC_OUT_PORT;
let oscOutIp = DEFAULT_OSC_OUT_IP;
let showData = null;      // { neuronById, bounds, frames } once data/ has loaded
let serialLink = null;    // WebSocket to the serial bridge while connected
let ledTrail = [];
let lastLedIndex = null;

// Output message config. Defaults match the app's current settings
// (/index, /x1,/y1..., and the /row echo); overridden by the frontend via CONFIG.
let oscOut = {
    timeEnabled: true,
    timeAddress: '/index',
    neuronsEnabled: true,
    xPrefix: '/x',
    yPrefix: '/y',
    rowEnabled: true,     // echo of incoming /row back out
    rowAddress: '/row',
};

// Show mode: the bridge owns the show clock (show-runner.js), so a reloaded or
// backgrounded tab can't stall /index. Sends go to whichever oscClients are current.
// Every tick also drives the LED matrices from data/ (no browser needed) and sends
// SHOW_STATE (60 Hz, localhost), from which the page follows the playhead and plays sound.
const show = createShowRunner({
    send: sendToAll,
    onState: state => {
        driveLeds(state);
        broadcastShowState();
    },
});
let lastShowLog = '';

// Initialize WebSocket Server
function startWsServer() {
    const httpServer = http.createServer(serveData);
    wsServer = new WebSocketServer({
        server: httpServer,
        verifyClient: ({ origin, req }) => isLocalOrigin(origin) && isLocalHost(req.headers.host),
    });
    httpServer.listen(WS_PORT, '127.0.0.1');
    console.log(`WebSocket bridge running on ws://127.0.0.1:${WS_PORT} (data on http://127.0.0.1:${WS_PORT}/data/)`);

    wsServer.on('connection', (ws) => {
        console.log('Frontend connected');
        // A (re)loaded tab learns where the show is straight away.
        ws.send(JSON.stringify({ type: 'SHOW_STATE', payload: showStatePayload() }));

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                // Handle Configuration Updates
                if (data.type === 'CONFIG') {
                    // A tab pushes its settings as soon as it connects. Mid-show that push
                    // must not re-point the running show (a fresh tab may only know the
                    // defaults): keep the bridge's settings and hand them back to adopt.
                    if (data.initial && show.isRunning()) {
                        ws.send(JSON.stringify({ type: 'OSC_CONFIG', payload: currentOscConfig() }));
                    } else {
                        updateOscConfig(data.payload);
                    }
                }
                // Handle Outgoing OSC (from App -> External)
                else if (data.type === 'OSC_SEND') {
                    sendOscMessage(data.payload);
                }
                // Handle Structured OSC Bundle
                else if (data.type === 'OSC_BUNDLE') {
                    sendOscBundle(data.payload);
                }
                // Show mode. START while running is ignored; every tab still gets the state.
                else if (data.type === 'SHOW_START') {
                    const config = { ...(data.payload?.config || {}), indexAddress: oscOut.timeAddress };
                    if (!show.start(config)) broadcastShowState();
                }
                else if (data.type === 'SHOW_STOP') {
                    if (!show.stop()) broadcastShowState();
                }
            } catch (e) {
                console.error('Error parsing WS message:', e);
            }
        });
    });
}

function broadcast(message) {
    if (!wsServer) return;
    const data = JSON.stringify(message);
    wsServer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

// GET /data/status, /data/neurons.csv, /data/spikes.csv — the page loads the show dataset
// from here on connect, so a reloaded tab needs no re-upload. Local pages and hosts only.
function serveData(req, res) {
    const origin = req.headers.origin;
    if (!isLocalOrigin(origin) || !isLocalHost(req.headers.host)) {
        res.writeHead(403).end();
        return;
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method !== 'GET') {
        res.writeHead(405).end();
        return;
    }
    if (req.url === '/data/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ neurons: existsSync(DATA_FILES.neurons), spikes: existsSync(DATA_FILES.spikes) }));
        return;
    }
    const file = DATA_ROUTES.get(req.url);
    if (!file || !existsSync(file)) {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Length': statSync(file).size });
    // pipeline, not pipe: a read error (e.g. an unreadable symlink target) ends this
    // response instead of throwing and taking the show down with the bridge.
    pipeline(createReadStream(file), res, err => {
        if (err) console.warn(`Serving ${req.url} stopped: ${err.message}`);
    });
}

async function loadShowData() {
    if (!existsSync(DATA_FILES.neurons) || !existsSync(DATA_FILES.spikes)) {
        console.log(`No show data in ${DATA_DIR} (neurons.csv + spikes.csv): LEDs follow the browser tab`);
        return;
    }
    const t0 = Date.now();
    const neurons = await loadNeurons(DATA_FILES.neurons);
    const frames = await loadSpikeFrames(DATA_FILES.spikes);
    showData = { neuronById: neuronsById(neurons), bounds: neuronBounds(neurons) ?? { minX: 0, maxX: 1, minY: 0, maxY: 1 }, frames };
    console.log(`Show data: ${neurons.length} neurons, ${frames.frameCount} frames, ${frames.ids.length} spikes ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)} s) — LEDs driven by the bridge`);
    broadcastShowState();
}

// Link to the serial bridge, retried every 2 s, so the bridge can light the LEDs itself.
function connectSerialLink() {
    const ws = new WebSocket(SERIAL_WS_URL);
    ws.on('open', () => {
        serialLink = ws;
        console.log('Serial bridge linked');
        broadcastShowState();
    });
    ws.on('close', () => {
        if (serialLink === ws) {
            serialLink = null;
            broadcastShowState();
        }
        setTimeout(connectSerialLink, 2000);
    });
    ws.on('error', () => {}); // 'close' follows and retries; an unhandled 'error' would throw
}

// The same LED frames the page sends during local playback (src/show/ledFrame.ts), for the
// spikes since the previous tick.
function driveLeds(state) {
    if (!showData || !state.running || state.phase !== 'on') {
        lastLedIndex = null;
        return;
    }
    const after = showOutputAfter(lastLedIndex, state.index, state.config.startIndex);
    lastLedIndex = state.index;
    if (state.index <= after) return;
    const { trail, frame } = ledStep(ledTrail, spikeIdsBetween(showData.frames, after, state.index), showData.neuronById, showData.bounds);
    ledTrail = trail;
    if (frame && serialLink) serialLink.send(JSON.stringify({ type: 'SERIAL_SYNC', payload: frame }));
}

// Initialize OSC Server (Inbound)
function startOscServer(port) {
    if (oscServer) oscServer.close();

    try {
        oscServer = new Server(port, '0.0.0.0', () => {
            console.log(`OSC Server listening on port ${port}`);
        });

        oscServer.on('message', (msg) => {
            // msg is [address, ...args]; the frontend reads { address, args }.
            // We expect something like ['/row', 123]
            console.log(`OSC IN: ${msg}`);
            broadcast({ type: 'OSC_MSG', payload: { address: msg[0], args: msg.slice(1) } });
        });
    } catch (e) {
        console.error(`Failed to start OSC server on port ${port}:`, e);
    }
}

// Parse a destination string into { ip, port } entries.
// Accepts a comma-separated list; each entry may be "ip" or "ip:port".
// Entries without a port fall back to the shared defaultPort. Entries whose port is out
// of UDP range are dropped: dgram throws on send, which would kill the show clock.
function parseDestinations(ipString, defaultPort) {
    return String(ipString || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(entry => {
            const [ip, port] = entry.split(':');
            const parsedPort = port ? parseInt(port, 10) : defaultPort;
            return { ip: ip.trim(), port: Number.isFinite(parsedPort) ? parsedPort : defaultPort };
        })
        .filter(({ ip, port }) => {
            if (Number.isInteger(port) && port > 0 && port < 65536) return true;
            console.warn(`Ignoring OSC destination ${ip}:${port} (port must be 1-65535)`);
            return false;
        });
}

// Initialize OSC Clients (Outbound) — one per destination
function updateOscClients(ipString, port) {
    oscClients.forEach(c => c.close());
    oscClients = [];

    oscDestinations = parseDestinations(ipString, port);
    oscDestinations.forEach(({ ip, port: p }) => {
        oscClients.push(new Client(ip, p));
        console.log(`OSC Client ready to send to ${ip}:${p}`);
    });

    if (oscClients.length === 0) {
        console.warn('No OSC destinations configured');
    }
}

function updateOscConfig(config) {
    console.log('Updating Configuration:', config);

    // Frontend sends { oscInPort, oscOutPort, oscOutIp }
    const inPort = config.oscInPort ?? config.inPort;
    const outPort = config.oscOutPort ?? config.outPort;
    const outIp = config.oscOutIp ?? config.outIp;

    if (inPort && inPort !== oscInPort) {
        oscInPort = inPort;
        startOscServer(oscInPort);
    }

    if ((outIp && outIp !== oscOutIp) || (outPort && outPort !== oscOutPort)) {
        oscOutIp = outIp || oscOutIp;
        oscOutPort = outPort || oscOutPort;
        updateOscClients(oscOutIp, oscOutPort);
    }

    // Output message config (addresses + enable flags). Merge over defaults so
    // omitted fields keep their current value.
    if (config.osc && typeof config.osc === 'object') {
        oscOut = { ...oscOut, ...config.osc };
        console.log('OSC output config:', oscOut);
    }

    // Destinations may have changed; the show HUD displays them.
    broadcastShowState();
}

function currentOscConfig() {
    return { oscInPort, oscOutPort, oscOutIp, osc: { ...oscOut } };
}

function sendToAll(address, args) {
    oscClients.forEach(client => {
        client.send(address, ...args, (err) => {
            if (err) console.error('OSC Send Error:', err);
        });
    });
}

function showStatePayload() {
    return {
        ...show.getState(),
        destinations: oscDestinations.map(d => `${d.ip}:${d.port}`),
        leds: showData !== null && serialLink !== null,
    };
}

function broadcastShowState() {
    const payload = showStatePayload();
    const label = payload.running ? `pass ${payload.pass} ${payload.phase}` : 'stopped';
    if (label !== lastShowLog) {
        console.log(`SHOW: ${label}`);
        lastShowLog = label;
    }
    broadcast({ type: 'SHOW_STATE', payload });
}

function sendOscMessage(value) {
    if (show.isRunning()) return; // the show is the only sender while it runs
    if (oscClients.length === 0) {
        console.warn('No OSC clients initialized');
        return;
    }
    if (!oscOut.rowEnabled) return;
    // Send as <rowAddress> <value> or <rowAddress> <val1> <val2> ...
    const args = Array.isArray(value) ? value : [value];
    oscClients.forEach(client => {
        client.send(oscOut.rowAddress, ...args, (err) => {
            if (err) console.error('OSC Send Error:', err);
        });
    });
}

function sendOscBundle(bundle) {
    if (show.isRunning()) return; // the show is the only /index sender while it runs
    if (oscClients.length === 0) return;

    console.log('Sending Bundle:', bundle); // Debug Log

    oscClients.forEach(client => {
        // Send Time (row index)
        if (oscOut.timeEnabled && bundle.time !== undefined) {
            client.send(oscOut.timeAddress, bundle.time);
        }

        // Send Neurons as /x1, /y1, /x2, /y2 ... (prefixes configurable)
        if (oscOut.neuronsEnabled && Array.isArray(bundle.neurons)) {
            bundle.neurons.forEach((n, i) => {
                const idx = i + 1; // 1-based index
                client.send(`${oscOut.xPrefix}${idx}`, n.x);
                client.send(`${oscOut.yPrefix}${idx}`, n.y);
            });
        }
    });
}

// Start everything
startWsServer();
startOscServer(oscInPort);
updateOscClients(oscOutIp, oscOutPort);
connectSerialLink();
loadShowData().catch(e => console.error('Failed to load show data:', e));
