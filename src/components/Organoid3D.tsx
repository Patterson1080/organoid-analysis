import { useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Neuron, SpikeEvent } from '../types';
import { SpoutSender } from './SpoutSender';

interface Organoid3DProps {
    neurons: Neuron[];
    spikes: SpikeEvent[];
    currentTime: number;
    currentTimeRef?: React.MutableRefObject<number>;
    isPlaying: boolean;
    burstThreshold?: number;
    trailLength?: number;
    isTransparent?: boolean;
    neuralCurvesEnabled?: boolean;
    lastFiringCount?: number;
    exportRef?: any;
    spoutEnabled?: boolean;
}

// Shared Geometry for Traces (Optimization)
const traceGeometry = new THREE.RingGeometry(0.5, 0.8, 8);

// Optimized Component that handles the animation loop and imperative updates
const OrganoidScene = ({
    neurons,
    spikes,
    currentTime,
    currentTimeRef,
    isPlaying,
    burstThreshold = 20,
    trailLength = 5,
    neuralCurvesEnabled = false,
    lastFiringCount = 5,
    exportRef // New prop to expose export function
}: Organoid3DProps) => {
    const { camera, gl } = useThree(); // Access camera and renderer
    const neuronRefs = useRef<Map<string, THREE.Mesh>>(new Map());
    const lastSpikeIndex = useRef(0);

    // Traces state
    const tracesRef = useRef<{ id: string; x: number; y: number; life: number; poolIndex: number }[]>([]);
    const traceGroupRef = useRef<THREE.Group>(null);

    // Object Pool for Traces
    const POOL_SIZE = 200;
    const tracePoolRef = useRef<{ mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; active: boolean }[]>([]);
    const poolInitialized = useRef(false);

    // Initialize Pool
    useEffect(() => {
        if (!poolInitialized.current && traceGroupRef.current) {
            for (let i = 0; i < POOL_SIZE; i++) {
                const material = new THREE.MeshBasicMaterial({
                    color: 0x00ff41,
                    transparent: true,
                    opacity: 0,
                    side: THREE.DoubleSide
                });
                const mesh = new THREE.Mesh(traceGeometry, material);
                mesh.visible = false; // Start hidden
                traceGroupRef.current.add(mesh);
                tracePoolRef.current.push({ mesh, material, active: false });
            }
            poolInitialized.current = true;
        }

        // Cleanup on unmount
        return () => {
            // We don't dispose here to avoid fighting with React's strict mode double-mount, 
            // but in a real app we might want to. 
            // For now, the pool persists for the lifecycle of the component.
        };
    }, []);

    // Line Trail State (Original)
    const lineRef = useRef<THREE.Line>(null);
    const recentSpikesRef = useRef<string[]>([]); // Stores IDs of last N firing neurons

    // Neural Curves State (Eciton burchellii style)
    const curvesRef = useRef<THREE.Line>(null);
    const lastFiringNeuronIdsRef = useRef<string[]>([]);
    const previousCurrentTimeRef = useRef(currentTime);
    const raidDir = useRef(new THREE.Vector3(0.7, 0.2, 0.6).normalize()); // Global raid direction

    // Expose Export Functions
    useEffect(() => {
        if (exportRef) {
            exportRef.current = {
                // 1. Export SVG (Download)
                exportSVG: () => {
                    const svgString = exportRef.current.getSVGString();
                    if (!svgString) return;

                    const blob = new Blob([svgString], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `organoid_curves_${Math.floor(currentTime)}ms.svg`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                },

                // 2. Get SVG String (For Sequence Export)
                getSVGString: () => {
                    if (!curvesRef.current || !neuralCurvesEnabled) {
                        // Return empty SVG if no curves, to keep sequence going
                        const { width, height } = gl.domElement;
                        return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="black" /></svg>`;
                    }

                    const geometry = curvesRef.current.geometry;
                    const count = geometry.drawRange.count;

                    const { width, height } = gl.domElement;
                    let svgPath = '';

                    if (count > 0) {
                        const positions = geometry.attributes.position.array;

                        // Project 3D points to 2D Screen Space
                        for (let i = 0; i < count; i++) {
                            const x = positions[i * 3];
                            const y = positions[i * 3 + 1];
                            const z = positions[i * 3 + 2];

                            const v = new THREE.Vector3(x, y, z);
                            v.project(camera); // Maps to NDC (-1 to +1)

                            const sx = (v.x + 1) * width / 2;
                            const sy = (-v.y + 1) * height / 2;

                            if (i === 0) {
                                svgPath += `M ${sx.toFixed(2)} ${sy.toFixed(2)}`;
                            } else {
                                svgPath += ` L ${sx.toFixed(2)} ${sy.toFixed(2)}`;
                            }
                        }
                    }

                    return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="black" />
    ${svgPath ? `<path d="${svgPath}" stroke="#00ccff" stroke-width="2" fill="none" />` : ''}
</svg>`;
                },

                // 3. Export OBJ (3D)
                exportOBJ: () => {
                    if (!curvesRef.current || !neuralCurvesEnabled) {
                        alert("No curves to export!");
                        return;
                    }

                    const geometry = curvesRef.current.geometry;
                    const count = geometry.drawRange.count;
                    if (count === 0) {
                        alert("No active curves to export.");
                        return;
                    }

                    const positions = geometry.attributes.position.array;
                    let objContent = "# Organoid Neural Curves\n";

                    // Write Vertices
                    for (let i = 0; i < count; i++) {
                        objContent += `v ${positions[i * 3]} ${positions[i * 3 + 1]} ${positions[i * 3 + 2]}\n`;
                    }

                    // Write Lines (Polyline)
                    objContent += "l";
                    for (let i = 1; i <= count; i++) {
                        objContent += ` ${i}`;
                    }
                    objContent += "\n";

                    // Trigger Download
                    const blob = new Blob([objContent], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `organoid_3d_${Math.floor(currentTime)}ms.obj`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                },

                // 4. Get PNG Data URL (For Sequence Export)
                getPNGDataURL: () => {
                    return gl.domElement.toDataURL('image/png');
                }
            };
        }
    }, [exportRef, gl, camera, neuralCurvesEnabled, currentTime]);

    // Reset index when time resets
    useEffect(() => {
        if (currentTime < 100) {
            lastSpikeIndex.current = 0;
            recentSpikesRef.current = [];
            lastFiringNeuronIdsRef.current = [];
            previousCurrentTimeRef.current = 0;

            if (lineRef.current) {
                lineRef.current.geometry.setDrawRange(0, 0);
            }
            if (curvesRef.current) {
                curvesRef.current.geometry.setDrawRange(0, 0);
            }
        }
    }, [currentTime]);

    useFrame(() => {
        // Use Ref for high-performance time if available and playing
        // Otherwise fall back to prop (for scrubbing/paused state)
        const time = (isPlaying && currentTimeRef) ? currentTimeRef.current : currentTime;

        // Allow update if playing OR if time has changed (scrubbing/stepping)
        if (!isPlaying && time === previousCurrentTimeRef.current) return;

        // 1. Find active spikes in this frame
        const window = 50; // ms
        let idx = lastSpikeIndex.current;

        // Safety check
        if (idx >= spikes.length) idx = 0;
        if (spikes.length > 0 && spikes[idx].timestamp_ms > time) idx = 0;

        const activeIds = new Set<string>();
        const newActiveIds: string[] = [];
        const newCurveIds: string[] = []; // Specifically for curves

        while (idx < spikes.length) {
            const s = spikes[idx];
            if (s.timestamp_ms > time) break; // Future spike

            // For visual activation (flashing)
            if (s.timestamp_ms >= time - window) {
                const idStr = String(s.neuron_id);
                activeIds.add(idStr);
                // Track "newly" active for the trail
                if (recentSpikesRef.current[recentSpikesRef.current.length - 1] !== idStr) {
                    newActiveIds.push(idStr);
                }
            }

            // For Neural Curves: strictly new spikes since last frame
            if (s.timestamp_ms > previousCurrentTimeRef.current && s.timestamp_ms <= time) {
                const idStr = String(s.neuron_id);
                newCurveIds.push(idStr);
            }

            idx++;
        }
        lastSpikeIndex.current = idx; // Save for next frame (approx)
        previousCurrentTimeRef.current = time;

        // Update Recent Spikes Queue (Original Trail)
        if (newActiveIds.length > 0) {
            recentSpikesRef.current = [...recentSpikesRef.current, ...newActiveIds];
            if (recentSpikesRef.current.length > trailLength) {
                recentSpikesRef.current = recentSpikesRef.current.slice(-trailLength);
            }
        }

        // Update Neural Curves Queue
        if (neuralCurvesEnabled && newCurveIds.length > 0) {
            lastFiringNeuronIdsRef.current = [...lastFiringNeuronIdsRef.current, ...newCurveIds];
            if (lastFiringNeuronIdsRef.current.length > lastFiringCount) {
                lastFiringNeuronIdsRef.current = lastFiringNeuronIdsRef.current.slice(-lastFiringCount);
            }
        }

        // Check for Burst
        const isBursting = activeIds.size >= burstThreshold;

        // 2. Imperatively update neuron meshes & Spawn Traces
        neuronRefs.current.forEach((mesh, id) => {
            const isActive = activeIds.has(id);
            const currentZ = mesh.position.z;

            // Jump logic (Z-axis)
            let nextZ = currentZ;
            if (isActive) {
                nextZ = 20; // Jump height (absolute Z)

                // Spawn Trace
                // Find free pool item
                const freeIdx = tracePoolRef.current.findIndex(p => !p.active);
                if (freeIdx !== -1) {
                    const poolItem = tracePoolRef.current[freeIdx];
                    poolItem.active = true;
                    poolItem.mesh.visible = true;
                    poolItem.mesh.position.set(mesh.position.x, mesh.position.y, 0);
                    poolItem.material.opacity = 1.0;

                    tracesRef.current.push({
                        id,
                        x: mesh.position.x,
                        y: mesh.position.y,
                        life: 1.0,
                        poolIndex: freeIdx
                    });
                }

            } else {
                // Decay
                nextZ = currentZ + (0 - currentZ) * 0.1;
            }

            mesh.position.z = nextZ;

            // Color logic
            const material = mesh.material as THREE.MeshStandardMaterial;
            const baseColor = mesh.userData.baseColor;

            if (isActive) {
                if (isBursting) {
                    // Burst Color: Gold/Orange
                    material.color.setHex(0xffaa00);
                    material.emissive.setHex(0xff4400);
                } else {
                    // Normal Active: White
                    material.color.setHex(0xffffff);
                    material.emissive.setHex(0xffffff);
                }
            } else {
                material.color.lerp(baseColor, 0.1);
                material.emissive.lerp(new THREE.Color(0x000000), 0.1);
            }
        });

        // 3. Update Traces
        // Filter out dead traces
        for (let i = tracesRef.current.length - 1; i >= 0; i--) {
            const t = tracesRef.current[i];
            t.life -= 0.05;

            if (t.life <= 0) {
                // Return to pool
                const poolItem = tracePoolRef.current[t.poolIndex];
                if (poolItem) {
                    poolItem.active = false;
                    poolItem.mesh.visible = false;
                }
                tracesRef.current.splice(i, 1);
            } else {
                // Update visual
                const poolItem = tracePoolRef.current[t.poolIndex];
                if (poolItem) {
                    poolItem.material.opacity = t.life;
                }
            }
        }

        // 4. Update Line Trail (Original)
        if (lineRef.current && recentSpikesRef.current.length > 1) {
            const positions = new Float32Array(trailLength * 3);
            let pointCount = 0;

            recentSpikesRef.current.forEach((id, i) => {
                const mesh = neuronRefs.current.get(id);
                if (mesh) {
                    positions[i * 3] = mesh.position.x;
                    positions[i * 3 + 1] = mesh.position.y;
                    positions[i * 3 + 2] = mesh.position.z + 2;
                    pointCount++;
                }
            });

            lineRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            lineRef.current.geometry.setDrawRange(0, pointCount);
            lineRef.current.geometry.attributes.position.needsUpdate = true;
        } else if (lineRef.current) {
            lineRef.current.geometry.setDrawRange(0, 0);
        }

        // 5. Update Neural Curves (Eciton burchellii style)
        if (neuralCurvesEnabled && curvesRef.current && lastFiringNeuronIdsRef.current.length > 1) {
            const ids = lastFiringNeuronIdsRef.current;
            const points: number[] = [];
            const SAMPLES_PER_SEGMENT = 16;
            // const SCALE = 1; // Neurons are already scaled in the scene

            for (let i = 0; i < ids.length - 1; i++) {
                const meshA = neuronRefs.current.get(ids[i]);
                const meshB = neuronRefs.current.get(ids[i + 1]);

                if (meshA && meshB) {
                    const A = meshA.position.clone();
                    const B = meshB.position.clone();

                    // Control points with raid direction bias
                    // k1, k2 scalars
                    const k1 = 20; // Magnitude of control point offset
                    const k2 = 20;

                    // Deterministic noise based on ID
                    const noiseA = (parseInt(ids[i]) % 10) / 10;
                    const noiseB = (parseInt(ids[i + 1]) % 10) / 10;

                    const c1 = A.clone().add(raidDir.current.clone().multiplyScalar(k1)).add(new THREE.Vector3(noiseA, noiseA, 0));
                    const c2 = B.clone().sub(raidDir.current.clone().multiplyScalar(k2)).add(new THREE.Vector3(noiseB, noiseB, 0));

                    const curve = new THREE.CubicBezierCurve3(A, c1, c2, B);
                    const segmentPoints = curve.getPoints(SAMPLES_PER_SEGMENT);

                    segmentPoints.forEach(p => {
                        points.push(p.x, p.y, p.z);
                    });
                }
            }

            const positions = new Float32Array(points);
            curvesRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            curvesRef.current.geometry.setDrawRange(0, points.length / 3);
            curvesRef.current.geometry.attributes.position.needsUpdate = true;

        } else if (curvesRef.current) {
            curvesRef.current.geometry.setDrawRange(0, 0);
        }
    });

    const SCALE = 100; // Scale factor to spread out normalized coordinates

    return (
        <>
            <group>
                {neurons.map((n) => (
                    <mesh
                        key={n.neuron_id}
                        position={[n.x * SCALE, n.y * SCALE, 0]}
                        ref={(el) => {
                            if (el) {
                                neuronRefs.current.set(String(n.neuron_id), el);
                                // Store base color
                                // UPDATED: Brighter Blue for non-backbone (0x4488ff instead of 0x0055ff)
                                if (!el.userData.baseColor) {
                                    el.userData.baseColor = new THREE.Color(n.is_backbone ? 0xff0055 : 0x4488ff);
                                }
                            }
                        }}
                    >
                        <sphereGeometry args={[n.is_backbone ? 1.5 : 0.8, 16, 16]} />
                        <meshStandardMaterial
                            color={n.is_backbone ? 0xff0055 : 0x4488ff}
                            emissive={0x000000}
                            emissiveIntensity={2}
                            toneMapped={false}
                        />
                    </mesh>
                ))}
            </group>

            {/* Traces Group */}
            <group ref={traceGroupRef} position={[0, 0, -1]} />

            {/* Line Trail (Original) */}
            <line ref={lineRef as any}>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        count={trailLength}
                        array={new Float32Array(trailLength * 3)}
                        itemSize={3}
                    />
                </bufferGeometry>
                <lineBasicMaterial color={0x00ffff} linewidth={2} opacity={0.7} transparent />
            </line>

            {/* Neural Curves (Eciton burchellii) */}
            <line ref={curvesRef as any}>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        count={32 * 32 * 3} // Max buffer size (approx)
                        array={new Float32Array(32 * 32 * 3 * 3)}
                        itemSize={3}
                    />
                </bufferGeometry>
                <lineBasicMaterial color={0x00ccff} linewidth={1} opacity={0.6} transparent />
            </line>
        </>
    );
};

export const Organoid3D = (props: Organoid3DProps) => {
    const controlsRef = useRef<any>(null);
    const localExportRef = useRef<any>(null);
    const finalExportRef = props.exportRef || localExportRef;

    const handleTopView = () => {
        if (controlsRef.current) {
            controlsRef.current.reset();
        }
    };

    const handleExport = () => {
        if (finalExportRef.current?.exportSVG) {
            finalExportRef.current.exportSVG();
        }
    };

    return (
        <div style={{ width: '100%', height: '500px', position: 'relative', background: props.isTransparent ? 'transparent' : '#050505', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10, display: 'flex', gap: '8px' }}>
                <button
                    className="btn"
                    onClick={handleExport}
                    title="Export current curves as SVG for TouchDesigner"
                >
                    Export SVG
                </button>
                <button
                    className="btn"
                    onClick={handleTopView}
                >
                    Top View
                </button>
            </div>

            <Canvas
                camera={{ position: [0, -200, 300], fov: 60 }}
                gl={{
                    powerPreference: "high-performance",
                    antialias: true,
                    stencil: false,
                    depth: true,
                    alpha: true, // Enable transparency
                    preserveDrawingBuffer: true // Required for data URL export
                }}
                dpr={[1, 2]} // Handle high-DPI screens, capped at 2x
            >
                {!props.isTransparent && <color attach="background" args={['#050505']} />}
                <ambientLight intensity={0.5} />
                <pointLight position={[100, 100, 100]} intensity={1} />
                <OrbitControls ref={controlsRef} />
                <OrganoidScene {...props} exportRef={finalExportRef} />
                {!props.isTransparent && <gridHelper args={[1000, 20, '#222', '#111']} rotation={[Math.PI / 2, 0, 0]} />}

                {/* Spout Integration (Enabled by default in Electron) */}
                <SpoutSender enabled={!!props.spoutEnabled} fps={30} />
            </Canvas>
        </div>
    );
};
