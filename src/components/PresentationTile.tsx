import React, { useState } from 'react';
import { loadTileSpan, nextTileSpan, saveTileSpan, TileSpan } from '../utils/tileSpans';

const SPAN_CLASS: Record<TileSpan, string> = { '1': '', '2': ' pres-span-2', full: ' pres-span-full' };
const SPAN_LABEL: Record<TileSpan, string> = { '1': '1 COL', '2': '2 COL', full: 'FULL' };

interface PresentationTileProps {
    id: string;              // key for the remembered span
    presentation: boolean;
    children: React.ReactNode;
}

// Grid cell for a tiled view. In presentation a control (shown on hover) sets how many
// columns it spans; the span classes only take effect under .presentation.
export function PresentationTile({ id, presentation, children }: PresentationTileProps) {
    const [span, setSpan] = useState<TileSpan>(() => loadTileSpan(id));
    const cycleSpan = () => {
        const next = nextTileSpan(span);
        setSpan(next);
        saveTileSpan(id, next);
    };
    return (
        <div className={`grid-cell pres-square${SPAN_CLASS[span]}`}>
            {children}
            {presentation && (
                <button className="pres-span-toggle" onClick={cycleSpan} title="Columns this view spans (click to change)">
                    {SPAN_LABEL[span]}
                </button>
            )}
        </div>
    );
}
