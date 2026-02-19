import React, { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

interface SpoutSenderProps {
    enabled: boolean;
    fps?: number;
}

/**
 * SpoutSender Component
 * 
 * This component captures the WebGL canvas frames and sends them to the Electron main process
 * via IPC. The main process is then responsible for publishing these frames to Spout (Windows)
 * or Syphon (macOS).
 * 
 * Note: High-performance texture sharing requires a native Node.js module in the main process.
 * This component implements the "Frame Copy" fallback which is slower but easier to implement.
 */
export const SpoutSender: React.FC<SpoutSenderProps> = ({ enabled, fps = 30 }) => {
    const { gl, scene, camera } = useThree();
    const intervalRef = useRef<NodeJS.Timeout>();

    useEffect(() => {
        if (!enabled) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }

        // IPC Renderer (Electron)
        // We use 'window.require' to avoid webpack trying to bundle electron
        const electron = (window as any).require ? (window as any).require('electron') : null;

        if (!electron) {
            console.warn("SpoutSender: Electron not detected. Spout integration disabled.");
            return;
        }

        const { ipcRenderer } = electron;

        const sendFrame = () => {
            if (!gl) return;

            // 1. Render the scene explicitly (optional, if not already rendering loop)
            // gl.render(scene, camera);

            // 2. Read pixels from the WebGL context
            const width = gl.domElement.width;
            const height = gl.domElement.height;

            // Create a buffer for the pixels (RGBA)
            const pixels = new Uint8Array(width * height * 4);

            // Get the underlying WebGL context
            const context = gl.getContext();

            // Read pixels
            // Note: readPixels reads from the default framebuffer.
            // If we were using a RenderTarget, we would use gl.readRenderTargetPixels
            if (context) {
                context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);

                // 3. Send to Main Process
                // We send the raw buffer and dimensions
                ipcRenderer.send('spout-frame', {
                    width,
                    height,
                    data: pixels
                });
            }
        };

        // Throttle sending to target FPS
        intervalRef.current = setInterval(sendFrame, 1000 / fps);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [enabled, fps, gl, scene, camera]);

    return null; // This component does not render anything visible
};
