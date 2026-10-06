// Browsers let any page open a WebSocket to 127.0.0.1, so binding to loopback alone
// doesn't stop a random website from driving the bridges. Accept only pages served from
// this machine (the Vite app, an Electron file:// page) and non-browser clients, which
// send no Origin. 'null' (sandboxed iframes, data: URLs) is refused on purpose.
export function isLocalOrigin(origin) {
    if (!origin) return true;
    if (origin.startsWith('file://')) return true;
    try {
        const { hostname } = new URL(origin);
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    } catch {
        return false;
    }
}
