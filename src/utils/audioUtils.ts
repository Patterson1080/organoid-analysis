/**
 * Web Audio API utility for generating click sounds
 */

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContext;
};

/**
 * Generate a short click sound (like a Geiger counter)
 */
export const playClickSound = (volume: number = 0.3) => {
    try {
        const ctx = getAudioContext();

        // Create oscillator for click
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        // Very short, high-pitched click
        oscillator.frequency.value = 1200;
        oscillator.type = 'sine';

        // Envelope: instant attack, quick decay
        const now = ctx.currentTime;
        gainNode.gain.setValueAtTime(volume, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.02);

        oscillator.start(now);
        oscillator.stop(now + 0.02);
    } catch (error) {
        console.warn('Audio playback failed:', error);
    }
};

/**
 * Play multiple clicks (batch mode to prevent audio overload)
 * Reverted to setTimeout for "staggered" feel, but with volume normalization to prevent clipping.
 */
export const playMultipleClicks = (count: number, maxClicks: number = 20) => {
    try {
        // Cap the number of distinct clicks
        const clicksToPlay = Math.min(count, maxClicks);

        // Normalization: Reduce volume as count increases to prevent clipping
        // Formula: Base / sqrt(Count)
        const baseVolume = 0.3;
        const normalizedVolume = baseVolume / Math.max(1, Math.sqrt(clicksToPlay));

        for (let i = 0; i < clicksToPlay; i++) {
            // Use setTimeout for the specific "staggered" texture the user liked
            setTimeout(() => {
                playClickSound(normalizedVolume);
            }, i * 5); // 5ms stagger
        }
    } catch (error) {
        console.warn('Audio playback failed:', error);
    }
};

/**
 * Play low-frequency bass pulse for synchronized burst events
 */
export const playBassPulse = (intensity: number = 0.5) => {
    try {
        const ctx = getAudioContext();

        // Create oscillator for bass
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        // Low frequency for subwoofer (60Hz base)
        oscillator.frequency.value = 60;
        oscillator.type = 'sine';

        // Envelope: quick attack, sustained pulse, decay
        const now = ctx.currentTime;
        const volume = Math.min(intensity * 0.3, 0.5); // Cap at 0.5

        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume, now + 0.05); // Attack
        gainNode.gain.setValueAtTime(volume, now + 0.15); // Sustain
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4); // Decay

        oscillator.start(now);
        oscillator.stop(now + 0.4);
    } catch (error) {
        console.warn('Bass pulse playback failed:', error);
    }
};
