import { Client, Server } from 'node-osc';
import { WebSocketServer, WebSocket } from 'ws';
import { createShowRunner } from './show-runner.js';

// Default Configuration
const DEFAULT_OSC_IN_PORT = 3333;
const DEFAULT_OSC_OUT_PORT = 1234; // EoC-biomes OSCMapping port in the show scenes
const DEFAULT_OSC_OUT_IP = '127.0.0.1';
const WS_PORT = 8080;

// State
let oscServer;
let oscClients = []; // One OSC Client per destination
let wsServer;
let oscInPort = DEFAULT_OSC_IN_PORT;
let oscOutPort = DEFAULT_OSC_OUT_PORT;
let oscOutIp = DEFAULT_OSC_OUT_IP;

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
const show = createShowRunner({
    send: sendToAll,
    onState: broadcastShowState,
});
let lastShowLog = '';

// Initialize WebSocket Server
function startWsServer() {
    wsServer = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT });
    console.log(`WebSocket bridge running on ws://127.0.0.1:${WS_PORT}`);

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

// Send one JSON message to every connected tab.
function broadcast(message) {
    if (!wsServer) return;
    const data = JSON.stringify(message);
    wsServer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

// Initialize OSC Server (Inbound)
function startOscServer(port) {
    if (oscServer) oscServer.close();

    try {
        oscServer = new Server(port, '0.0.0.0', () => {
            console.log(`OSC Server listening on port ${port}`);
        });

        oscServer.on('message', (msg) => {
            // msg is [address, ...args]
            // We expect something like ['/row', 123]
            console.log(`OSC IN: ${msg}`);
            broadcast({ type: 'OSC_MSG', payload: msg });
        });
    } catch (e) {
        console.error(`Failed to start OSC server on port ${port}:`, e);
    }
}

// Parse a destination string into { ip, port } entries.
// Accepts a comma-separated list; each entry may be "ip" or "ip:port".
// Entries without a port fall back to the shared defaultPort.
function parseDestinations(ipString, defaultPort) {
    return String(ipString || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(entry => {
            const [ip, port] = entry.split(':');
            const parsedPort = port ? parseInt(port, 10) : defaultPort;
            return { ip: ip.trim(), port: Number.isFinite(parsedPort) ? parsedPort : defaultPort };
        });
}

// Initialize OSC Clients (Outbound) — one per destination
function updateOscClients(ipString, port) {
    oscClients.forEach(c => c.close());
    oscClients = [];

    const destinations = parseDestinations(ipString, port);
    destinations.forEach(({ ip, port: p }) => {
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

// Show mode: one message to every destination.
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
        destinations: parseDestinations(oscOutIp, oscOutPort).map(d => `${d.ip}:${d.port}`),
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
