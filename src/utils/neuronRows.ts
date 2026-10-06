import type { Neuron } from '../types';

// Neuron CSV rows (as Papa parses them: header row, dynamic typing) → neurons. Shared by the
// page's uploader and the OSC bridge, which loads data/neurons.csv itself.

const findColumn = (headers: string[], possibleNames: string[]): string | undefined => {
    const lowerHeaders = headers.map(h => h.toLowerCase().trim());
    for (const name of possibleNames) {
        const index = lowerHeaders.indexOf(name.toLowerCase());
        if (index !== -1) return headers[index];
    }
    return undefined;
};

export function neuronsFromRows(headers: string[], rows: any[]): Neuron[] {
    const idCol = findColumn(headers, ['neuron_id', 'id', 'neuron', 'label', 'unit_id']);
    const xCol = findColumn(headers, ['x', 'x_pos', 'x_coord', 'x_location', 'pos_x', 'xy_norm_0']);
    const yCol = findColumn(headers, ['y', 'y_pos', 'y_coord', 'y_location', 'pos_y', 'xy_norm_1']);
    const backboneCol = findColumn(headers, ['is_backbone', 'backbone', 'type', 'is_anchor']);
    if (!xCol || !yCol) return [];

    return rows
        .map((row: any, index: number) => {
            let id = index + 1;
            let isBackbone = false;

            if (idCol && row[idCol] != null) {
                const val = Number(row[idCol]);
                if (val === 0 || val === 1) {
                    isBackbone = val === 1;
                } else {
                    id = val;
                    if (backboneCol) {
                        isBackbone = (row[backboneCol] === true || row[backboneCol] === 'true' || row[backboneCol] === 1);
                    }
                }
            } else if (backboneCol) {
                isBackbone = (row[backboneCol] === true || row[backboneCol] === 'true' || row[backboneCol] === 1);
            }

            if (row[xCol] == null || row[yCol] == null) return null;

            return {
                neuron_id: id,
                x: Number(row[xCol]),
                y: Number(row[yCol]),
                is_backbone: isBackbone,
                xy_norm_0: row['xy_norm_0'] !== undefined ? Number(row['xy_norm_0']) : Number(row[xCol]),
                xy_norm_1: row['xy_norm_1'] !== undefined ? Number(row['xy_norm_1']) : Number(row[yCol])
            };
        })
        .filter(n => n !== null) as Neuron[];
}
