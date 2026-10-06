import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import { PCA } from 'ml-pca';
import * as THREE from 'three';
import { SpikeEvent, Neuron } from '../types';

interface PCA3DProps {
    spikes: SpikeEvent[];
    neurons: Neuron[];
    binSizeMs?: number;
    presentation?: boolean; // fill the parent box instead of a fixed height
}

const PCA3DScene: React.FC<{ data: any[] }> = ({ data }) => {
    const points = useMemo(() => {
        return data.map(d => new THREE.Vector3(d.pc1, d.pc2, d.pc3));
    }, [data]);

    const colors = useMemo(() => {
        return data.map((_, i) => {
            const t = i / (data.length - 1);
            // Gradient from Blue (start) to Red (end)
            return new THREE.Color().setHSL(0.6 * (1 - t), 1, 0.5);
        });
    }, [data]);

    return (
        <group>
            {/* Trajectory Line */}
            <Line
                points={points}
                color="white"
                lineWidth={1}
                vertexColors={colors}
                transparent
                opacity={0.6}
            />

            {/* Data Points */}
            {data.map((d, i) => (
                <mesh key={i} position={[d.pc1, d.pc2, d.pc3]}>
                    <sphereGeometry args={[0.01, 8, 8]} />
                    <meshBasicMaterial color={colors[i]} />
                </mesh>
            ))}

            {/* Axes Helper */}
            <axesHelper args={[2]} />

            {/* Labels */}
            <Html position={[2.2, 0, 0]} center><div style={{ color: 'red', fontSize: '10px' }}>PC1</div></Html>
            <Html position={[0, 2.2, 0]} center><div style={{ color: 'green', fontSize: '10px' }}>PC2</div></Html>
            <Html position={[0, 0, 2.2]} center><div style={{ color: 'blue', fontSize: '10px' }}>PC3</div></Html>

            <gridHelper args={[10, 10, 0x444444, 0x222222]} />
        </group>
    );
};

const PCA3D: React.FC<PCA3DProps> = ({ spikes, neurons, binSizeMs = 100, presentation = false }) => {
    const pcaData = useMemo(() => {
        if (!spikes.length || !neurons.length) return [];

        // 1. Determine Time Range
        const minTime = Math.min(...spikes.map(s => s.timestamp_ms));
        const maxTime = Math.max(...spikes.map(s => s.timestamp_ms));
        const duration = maxTime - minTime;
        const numBins = Math.ceil(duration / binSizeMs);

        // 2. Create Matrix (Rows = Time Bins, Cols = Neurons)
        const matrix = Array(numBins).fill(0).map(() => Array(neurons.length).fill(0));

        const neuronIdToIndex = new Map<number, number>();
        neurons.forEach((n, i) => neuronIdToIndex.set(n.neuron_id, i));

        spikes.forEach(spike => {
            const binIndex = Math.floor((spike.timestamp_ms - minTime) / binSizeMs);
            const colIndex = neuronIdToIndex.get(spike.neuron_id);
            if (binIndex >= 0 && binIndex < numBins && colIndex !== undefined) {
                matrix[binIndex][colIndex] += 1;
            }
        });

        // 3. Perform PCA
        try {
            const pca = new PCA(matrix);
            const projected = pca.predict(matrix);

            // Get 3 components
            const data = projected.to2DArray().map((row: number[], index: number) => ({
                time: minTime + (index * binSizeMs),
                pc1: row[0],
                pc2: row[1],
                pc3: row[2] || 0, // Fallback if only 2 components
                index
            }));

            // Normalize to fit in view (scale to roughly -2 to 2 range)
            const maxVal = Math.max(...data.map(d => Math.max(Math.abs(d.pc1), Math.abs(d.pc2), Math.abs(d.pc3))));
            const scale = maxVal > 0 ? 2 / maxVal : 1;

            return data.map(d => ({
                ...d,
                pc1: d.pc1 * scale,
                pc2: d.pc2 * scale,
                pc3: d.pc3 * scale
            }));

        } catch (e) {
            console.error("PCA Calculation Failed:", e);
            return [];
        }

    }, [spikes, neurons, binSizeMs]);

    if (!pcaData.length) return <div className="text-white">No data for PCA</div>;

    return (
        <div style={{ position: 'relative', height: presentation ? '100%' : 384, overflow: 'hidden' }}>
            <Canvas camera={{ position: [3, 3, 3], fov: 45 }}>
                <color attach="background" args={['#050505']} />
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} />
                <PCA3DScene data={pcaData} />
                <OrbitControls autoRotate autoRotateSpeed={1} />
            </Canvas>
            <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>PC1 (Red) • PC2 (Green) • PC3 (Blue) | Color = Time</span>
            </div>
        </div>
    );
};

export default PCA3D;
