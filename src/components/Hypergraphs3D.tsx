import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import { Neuron } from '../types';
import { HypergraphFrame, HypergraphTrack } from '../utils/hypergraphUtils';

interface Hypergraphs3DProps {
    frames: HypergraphFrame[];
    tracks: HypergraphTrack[];
    neurons: Neuron[];
}

const Hypergraphs3DScene: React.FC<Hypergraphs3DProps> = ({ frames, tracks, neurons }) => {
    // We need to map time to Z axis.
    // Let's find min and max time to normalize it.
    const timeRange = useMemo(() => {
        if (!frames || frames.length === 0) return { min: 0, max: 1, span: 1 };
        const min = frames[0].timeStart;
        const max = frames[frames.length - 1].timeEnd;
        return { min, max, span: Math.max(1, max - min) };
    }, [frames]);

    const getEdgeColor = (idx: number) => {
        const colors = [
            '#ff0055', '#00ffcc', '#ffaa00', '#aa00ff',
            '#00aaff', '#ff00aa', '#aaff00', '#55ff00'
        ];
        return colors[idx % colors.length];
    };

    // Helper to map normalized Cartesian (x,y) and time to 3D space
    // Let's span X/Y from -5 to 5, and Z from -5 to 5 (oldest at top or bottom? usually oldest at bottom)
    const mapTo3D = (nx: number, ny: number, time: number): [number, number, number] => {
        const x = (nx - 0.5) * 10;
        const y = (ny - 0.5) * 10;
        const zNorm = (time - timeRange.min) / timeRange.span;
        const z = (zNorm - 0.5) * 10; // Oldest is Z=-5, Newest is Z=+5
        return [x, y, z];
    };

    // Calculate background neurons positions (we can just draw them at Z=0? Or maybe draw them as vertical lines?
    // Let's just draw them at the base Z=-5 to give context, or optionally not draw them at all to reduce clutter.
    // Let's draw them at Z=-5 softly.
    const neuronPoints = useMemo(() => {
        return neurons.map(n => mapTo3D(n.xy_norm_0, n.xy_norm_1, timeRange.min));
    }, [neurons, timeRange]);

    return (
        <group rotation={[-Math.PI / 2, 0, 0]}> {/* Rotate to Z is up */}

            {/* Draw hyperedge hulls */}
            {frames.map((frame, fIdx) => {
                const zTime = frame.timeStart;

                return (
                    <group key={`frame-${fIdx}`}>
                        {frame.hyperedges.map((edge, eIdx) => {
                            if (edge.hull.length < 2) return null;
                            const colorIndex = edge.trackId !== undefined ? edge.trackId : eIdx;
                            const colorStr = getEdgeColor(colorIndex);

                            // Close the loop
                            const pts = [...edge.hull, edge.hull[0]].map(p =>
                                mapTo3D(p[0], p[1], zTime)
                            ) as [number, number, number][];

                            return (
                                <Line
                                    key={`edge-${fIdx}-${eIdx}`}
                                    points={pts}
                                    color={colorStr}
                                    lineWidth={2}
                                    transparent
                                    opacity={0.8}
                                />
                            );
                        })}
                    </group>
                );
            })}

            {/* Draw Tracks (Centroid lines) */}
            {tracks.map(track => {
                if (track.centroids.length < 2) return null;
                const colorStr = getEdgeColor(track.colorIndex);

                const pts = track.centroids.map(c =>
                    mapTo3D(c.x, c.y, c.time)
                );

                return (
                    <group key={`track-${track.trackId}`}>
                        <Line
                            points={pts}
                            color={colorStr}
                            lineWidth={3}
                            transparent
                            opacity={0.9}
                        />
                        {/* Spheres at centroids */}
                        {pts.map((p, i) => (
                            <mesh key={`pt-${i}`} position={p}>
                                <sphereGeometry args={[0.08, 8, 8]} />
                                <meshBasicMaterial color={colorStr} />
                            </mesh>
                        ))}
                    </group>
                );
            })}

            {/* Base Layer Neurons (Context) */}
            <points>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        count={neuronPoints.length}
                        array={new Float32Array(neuronPoints.flat())}
                        itemSize={3}
                    />
                </bufferGeometry>
                <pointsMaterial size={0.05} color="#333333" />
            </points>

            {/* Bounding Box / Grid Help */}
            <gridHelper args={[10, 10, '#333', '#111']} position={[0, 0, -5]} rotation={[Math.PI / 2, 0, 0]} />
        </group>
    );
};

export const Hypergraphs3D: React.FC<Hypergraphs3DProps> = ({ frames, tracks, neurons }) => {
    if (!frames || frames.length === 0) return null;

    return (
        <div className="w-full h-full min-h-[600px] bg-black relative">
            <Canvas camera={{ position: [8, 8, 8], fov: 45 }}>
                <color attach="background" args={['#050505']} />
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 20, 10]} />
                <Hypergraphs3DScene frames={frames} tracks={tracks} neurons={neurons} />
                <OrbitControls makeDefault autoRotate autoRotateSpeed={0.5} />
            </Canvas>
            <div className="absolute bottom-4 left-4 text-xs text-gray-400 font-mono bg-black/50 p-2 rounded pointer-events-none">
                3D Temporal View (Z-Axis = Time) <br />
                Oldest frames at bottom, newest at top. <br />
                Drag to rotate, scroll to zoom.
            </div>
        </div>
    );
};
