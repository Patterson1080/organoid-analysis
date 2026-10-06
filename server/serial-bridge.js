import { SerialPort } from 'serialport';
import { WebSocketServer } from 'ws';
import { isLocalOrigin } from './local-origin.js';

const BAUD_RATE = 115200;
const WS_PORT = 8081;

let port = null;
let reconnectInterval = null;

async function scanAndConnect() {
  if (port && port.isOpen) return;

  try {
    const ports = await SerialPort.list();
    const arduinoPort = ports.find(p => 
      (p.vendorId && p.vendorId.toLowerCase() === '2341') ||
      (p.manufacturer && p.manufacturer.toLowerCase().includes('arduino'))
    );

    if (arduinoPort) {
      console.log(`Found Arduino on ${arduinoPort.path}. Connecting...`);
      port = new SerialPort({
        path: arduinoPort.path,
        baudRate: BAUD_RATE,
        autoOpen: false,
      });

      port.open(function (err) {
        if (err) {
          console.log(`Error opening port ${arduinoPort.path}: `, err.message);
          return;
        }
        console.log(`Serial port ${arduinoPort.path} opened successfully.`);
        if (reconnectInterval) {
          clearInterval(reconnectInterval);
          reconnectInterval = null;
        }
      });

      port.on('close', () => {
        console.log('Arduino disconnected. Scanning for devices...');
        port = null;
        startScanning();
      });

      port.on('error', (err) => {
        console.log('Serial error: ', err.message);
      });

    } else {
      console.log('Scanning for Arduino... Not found.');
    }
  } catch (e) {
    console.error('Error scanning ports:', e);
  }
}

function startScanning() {
  if (!reconnectInterval) {
    scanAndConnect(); // Try immediately
    reconnectInterval = setInterval(scanAndConnect, 3000);
  }
}

// Start auto-detection
startScanning();

// Command queue to throttle USB output and prevent Arduino native USB crashes
const COMMAND_QUEUE = [];

// Process queue steadily (send up to 3 commands every 10ms = ~300 cmds/sec)
setInterval(() => {
  if (port && port.isOpen && COMMAND_QUEUE.length > 0) {
    const chunk = COMMAND_QUEUE.splice(0, 3).join('');
    port.write(chunk);
  }
}, 10);

// Initialize WebSocket Server
// Only this machine's frontend talks to the serial bridge (see local-origin.js).
const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: WS_PORT,
  verifyClient: ({ origin }) => isLocalOrigin(origin),
});

wss.on('connection', function connection(ws) {
  console.log(`Frontend connected to serial bridge on ws://localhost:${WS_PORT}`);
  
  ws.on('message', function message(data) {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'SERIAL_SYNC') {
        const { isBurst, firings } = msg.payload;
        
        if (firings && firings.length > 0) {
          // Limit to 10 neurons per frame so we don't overwhelm the visual logic
          const limitedFirings = firings.slice(0, 10);
          
          limitedFirings.forEach(f => {
            const type = isBurst ? 'C' : 'F';
            COMMAND_QUEUE.push(`${type}:${Math.floor(f.x)},${Math.floor(f.y)}\n`);
          });

          // Prevent memory ballooning if React sends faster than USB can drain
          if (COMMAND_QUEUE.length > 200) {
            COMMAND_QUEUE.splice(0, COMMAND_QUEUE.length - 200);
          }
        }
      } else if (msg.type === 'TEST') {
        COMMAND_QUEUE.push('T\n');
      }
    } catch(e) {
      console.error('Error handling WebSocket message in serial bridge:', e);
    }
  });
});

console.log(`Serial WebSocket bridge running on ws://localhost:${WS_PORT}`);
