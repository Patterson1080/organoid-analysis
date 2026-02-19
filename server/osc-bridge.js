import { Client, Server } from 'node-osc';
import { WebSocketServer, WebSocket } from 'ws';

// Default Configuration
const DEFAULT_OSC_IN_PORT = 3333;
const DEFAULT_OSC_OUT_PORT = 3334;
const DEFAULT_OSC_OUT_IP = '127.0.0.1';
const WS_PORT = 8080;

// State
let oscServer;
let oscClient;
let wsServer;
let oscInPort = DEFAULT_OSC_IN_PORT;
let oscOutPort = DEFAULT_OSC_OUT_PORT;
let oscOutIp = DEFAULT_OSC_OUT_IP;

// Initialize WebSocket Server
function startWsServer() {
    wsServer = new WebSocketServer({ port: WS_PORT });
    console.log(`WebSocket bridge running on ws://localhost:${WS_PORT}`);

    wsServer.on('connection', (ws) => {
        console.log('Frontend connected');

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                // Handle Configuration Updates
                if (data.type === 'CONFIG') {
                    updateOscConfig(data.payload);
                }
                // Handle Outgoing OSC (from App -> External)
                else if (data.type === 'OSC_SEND') {
                    sendOscMessage(data.payload);
                }
                // Handle Structured OSC Bundle
                else if (data.type === 'OSC_BUNDLE') {
                    sendOscBundle(data.payload);
                }
            } catch (e) {
                console.error('Error parsing WS message:', e);
            }
        });
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

            // Broadcast to all connected WS clients
            if (wsServer) {
                wsServer.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'OSC_MSG',
                            payload: msg
                        }));
                    }
                });
            }
        });
    } catch (e) {
        console.error(`Failed to start OSC server on port ${port}:`, e);
    }
}

// Initialize OSC Client (Outbound)
function updateOscClient(ip, port) {
    if (oscClient) oscClient.close();
    oscClient = new Client(ip, port);
    console.log(`OSC Client ready to send to ${ip}:${port}`);
}

function updateOscConfig(config) {
    console.log('Updating Configuration:', config);

    if (config.inPort && config.inPort !== oscInPort) {
        oscInPort = config.inPort;
        startOscServer(oscInPort);
    }

    if ((config.outIp && config.outIp !== oscOutIp) || (config.outPort && config.outPort !== oscOutPort)) {
        oscOutIp = config.outIp || oscOutIp;
        oscOutPort = config.outPort || oscOutPort;
        updateOscClient(oscOutIp, oscOutPort);
    }
}

function sendOscMessage(value) {
    if (oscClient) {
        // Send as /row <value> or /row <val1> <val2> ...
        const args = Array.isArray(value) ? value : [value];
        oscClient.send('/row', ...args, (err) => {
            if (err) console.error('OSC Send Error:', err);
        });
    } else {
        console.warn('OSC Client not initialized');
    }
}

function sendOscBundle(bundle) {
    if (oscClient) {
        console.log('Sending Bundle:', bundle); // Debug Log

        // Send Time
        if (bundle.time !== undefined) {
            oscClient.send('/time', bundle.time);
        }

        // Send Neurons as /x1, /y1, /x2, /y2 ...
        if (Array.isArray(bundle.neurons)) {
            bundle.neurons.forEach((n, i) => {
                const idx = i + 1; // 1-based index
                oscClient.send(`/x${idx}`, n.x);
                oscClient.send(`/y${idx}`, n.y);
            });
        }
    }
}

// Start everything
startWsServer();
startOscServer(oscInPort);
updateOscClient(oscOutIp, oscOutPort);
