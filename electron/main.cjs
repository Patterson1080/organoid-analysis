const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Placeholder for Spout/Syphon native library
// const spout = require('electron-spout'); // Example

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // For easier Spout integration later (though less secure)
            preload: path.join(__dirname, 'preload.cjs')
        }
    });

    // In production, load the index.html from the build folder.
    // In dev, load from localhost.
    const isDev = !app.isPackaged;

    if (isDev) {
        win.loadURL('http://localhost:5173');
        win.webContents.openDevTools();
    } else {
        // 'build/index.html'
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Handle Spout Frame (Frame Copy Method)
    ipcMain.on('spout-frame', (event, { width, height, data }) => {
        // This is where we would send the buffer to Spout/Syphon
        // console.log(`Received frame: ${width}x${height}, ${data.length} bytes`);

        // Example with native module:
        // spout.sendTexture(width, height, data);
    });
}

app.whenReady().then(() => {
    createWindow();

    // Start OSC Bridge
    startWsServer();
    startOscServer(oscInPort);
    updateOscClient(oscOutIp, oscOutPort);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ==========================================
// OSC & WebSocket Bridge Integration
// ==========================================

// const { Client, Server } = require('node-osc'); // Removed: ESM module cannot be required
const { WebSocketServer, WebSocket } = require('ws');

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
    try {
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

        wsServer.on('error', (err) => {
            console.error('WebSocket Server Error:', err);
        });

    } catch (e) {
        console.error('Failed to start WebSocket server:', e);
    }
}

// Initialize OSC Server (Inbound)
async function startOscServer(port) {
    if (oscServer) oscServer.close();

    try {
        // Dynamic import for ESM module
        const { Server } = await import('node-osc');

        oscServer = new Server(port, '0.0.0.0', () => {
            console.log(`OSC Server listening on port ${port}`);
        });

        oscServer.on('message', (msg) => {
            // msg is [address, ...args]
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
async function updateOscClient(ip, port) {
    if (oscClient) oscClient.close();
    try {
        // Dynamic import for ESM module
        const { Client } = await import('node-osc');

        oscClient = new Client(ip, port);
        console.log(`OSC Client ready to send to ${ip}:${port}`);
    } catch (e) {
        console.error('Failed to create OSC Client:', e);
    }
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
