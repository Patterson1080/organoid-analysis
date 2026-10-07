// How many grid columns each presentation tile spans, kept per browser so a reload or the
// next presentation restores the layout.

export type TileSpan = '1' | '2' | 'full';

const SPANS: TileSpan[] = ['1', '2', 'full'];
const KEY = 'organoid-analysis.tileSpans';

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export const nextTileSpan = (span: TileSpan): TileSpan => SPANS[(SPANS.indexOf(span) + 1) % SPANS.length];

// `storage` defaults to localStorage, looked up inside the try: merely touching it throws
// in some sandboxed/privacy contexts.
function readAll(storage?: KeyValueStore): Record<string, unknown> {
    try {
        const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY) ?? 'null');
        return saved && typeof saved === 'object' ? saved : {};
    } catch {
        return {};
    }
}

export function loadTileSpan(id: string, storage?: KeyValueStore): TileSpan {
    const span = readAll(storage)[id];
    return SPANS.includes(span as TileSpan) ? (span as TileSpan) : '1';
}

export function saveTileSpan(id: string, span: TileSpan, storage?: KeyValueStore): void {
    try {
        (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify({ ...readAll(storage), [id]: span }));
    } catch {
        // Blocked storage: the span just won't survive a reload.
    }
}
