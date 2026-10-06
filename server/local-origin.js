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

// DNS rebinding: a hostile site can point its own name at 127.0.0.1, so its requests are
// same-origin and carry no Origin header. Their Host header still names that site, so
// requests must also be addressed to this machine by a local name.
export function isLocalHost(host) {
    if (!host) return false;
    try {
        const { hostname } = new URL(`http://${host}`);
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    } catch {
        return false;
    }
}
