import React, { useState, useCallback } from 'react';
import { parseNeuronCSV, parseSpikeCSV } from '../utils/dataProcessing';
import { Neuron, SpikeEvent } from '../types';

interface FileUploaderProps {
    onNeuronsLoaded: (neurons: Neuron[]) => void;
    onSpikesLoaded: (spikes: SpikeEvent[]) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onNeuronsLoaded, onSpikesLoaded }) => {
    const [neuronFile, setNeuronFile] = useState<File | null>(null);
    const [spikeFile, setSpikeFile] = useState<File | null>(null);
    const [dragActiveNeuron, setDragActiveNeuron] = useState(false);
    const [dragActiveSpike, setDragActiveSpike] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [neuronSuccess, setNeuronSuccess] = useState<string | null>(null);
    const [spikeSuccess, setSpikeSuccess] = useState<string | null>(null);

    const handleNeuronFile = useCallback(async (file: File) => {
        try {
            console.log('Parsing neuron file:', file.name);
            setError(null);
            setNeuronSuccess(null);
            setLoading(true);
            setNeuronFile(file);
            const neurons = await parseNeuronCSV(file);
            console.log('Parsed neurons:', neurons.length);

            if (neurons.length === 0) {
                setError(`Parsed 0 neurons. Please check CSV headers. See console (F12) for details.`);
                setNeuronSuccess(null);
            } else {
                onNeuronsLoaded(neurons);
                setNeuronSuccess(`✓ Loaded ${neurons.length} neurons`);
            }
        } catch (err) {
            console.error('Error parsing neuron file:', err);
            setError(`Error parsing neuron file: ${err}`);
            setNeuronFile(null);
            setNeuronSuccess(null);
        } finally {
            setLoading(false);
        }
    }, [onNeuronsLoaded]);

    const handleSpikeFile = useCallback(async (file: File) => {
        try {
            console.log('Parsing spike file:', file.name);
            setError(null);
            setSpikeSuccess(null);
            setLoading(true);
            setSpikeFile(file);
            const spikes = await parseSpikeCSV(file);
            console.log('Parsed spikes:', spikes.length);

            if (spikes.length === 0) {
                setError(`Parsed 0 spike events. Please check CSV headers. See console (F12) for details.`);
                setSpikeSuccess(null);
            } else {
                onSpikesLoaded(spikes);
                setSpikeSuccess(`✓ Loaded ${spikes.length} spike events`);
            }
        } catch (err) {
            console.error('Error parsing spike file:', err);
            setError(`Error parsing spike file: ${err}`);
            setSpikeFile(null);
            setSpikeSuccess(null);
        } finally {
            setLoading(false);
        }
    }, [onSpikesLoaded]);

    const handleDrag = (e: React.DragEvent, setter: (active: boolean) => void) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setter(true);
        } else if (e.type === 'dragleave') {
            setter(false);
        }
    };

    const handleDrop = (e: React.DragEvent, handler: (file: File) => void, setter: (active: boolean) => void) => {
        e.preventDefault();
        e.stopPropagation();
        setter(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handler(e.dataTransfer.files[0]);
        }
    };

    return (
        <div className="data-panel">
            <h2 style={{ marginBottom: 'var(--space-lg)' }}>Data Input</h2>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {/* Neuron Location Upload */}
                <div>
                    <div className="data-label" style={{ marginBottom: 'var(--space-sm)' }}>
                        Neuron Locations
                    </div>
                    <div
                        className={`upload-zone ${dragActiveNeuron ? 'drag-active' : ''}`}
                        onDragEnter={(e) => handleDrag(e, setDragActiveNeuron)}
                        onDragLeave={(e) => handleDrag(e, setDragActiveNeuron)}
                        onDragOver={(e) => handleDrag(e, setDragActiveNeuron)}
                        onDrop={(e) => handleDrop(e, handleNeuronFile, setDragActiveNeuron)}
                    >
                        <input
                            type="file"
                            accept=".csv"
                            onChange={(e) => e.target.files?.[0] && handleNeuronFile(e.target.files[0])}
                        />
                        {neuronFile ? (
                            <>
                                <div style={{ fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-xs)' }}>✓</div>
                                <div className="status-text">{neuronFile.name}</div>
                                {neuronSuccess && (
                                    <div style={{ color: 'var(--color-accent)', fontSize: 'var(--font-size-xs)', marginTop: 'var(--space-xs)' }}>
                                        {neuronSuccess}
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div style={{ fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-xs)' }}>↑</div>
                                <div className="status-text">Drop CSV or Click</div>
                                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-sm)' }}>
                                    neuron_id, x, y, is_backbone
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Spike Activity Upload */}
                <div>
                    <div className="data-label" style={{ marginBottom: 'var(--space-sm)' }}>
                        Spike Activity
                    </div>
                    <div
                        className={`upload-zone ${dragActiveSpike ? 'drag-active' : ''}`}
                        onDragEnter={(e) => handleDrag(e, setDragActiveSpike)}
                        onDragLeave={(e) => handleDrag(e, setDragActiveSpike)}
                        onDragOver={(e) => handleDrag(e, setDragActiveSpike)}
                        onDrop={(e) => handleDrop(e, handleSpikeFile, setDragActiveSpike)}
                    >
                        <input
                            type="file"
                            accept=".csv"
                            onChange={(e) => e.target.files?.[0] && handleSpikeFile(e.target.files[0])}
                        />
                        {spikeFile ? (
                            <>
                                <div style={{ fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-xs)' }}>✓</div>
                                <div className="status-text">{spikeFile.name}</div>
                                {spikeSuccess && (
                                    <div style={{ color: 'var(--color-accent)', fontSize: 'var(--font-size-xs)', marginTop: 'var(--space-xs)' }}>
                                        {spikeSuccess}
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div style={{ fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-xs)' }}>↑</div>
                                <div className="status-text">Drop CSV or Click</div>
                                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-sm)' }}>
                                    timestamp_ms, neuron_id
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {error && (
                <div style={{ marginTop: 'var(--space-md)', color: '#ff0000', fontSize: 'var(--font-size-sm)' }}>
                    {error}
                </div>
            )}

            {loading && (
                <div className="status-text" style={{ marginTop: 'var(--space-md)' }}>
                    Processing...
                </div>
            )}
        </div>
    );
};
