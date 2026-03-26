import { useCallback, useRef } from 'react';

const MIN_INTERVAL_MS = 1200;

export function useNotificationSound() {
  const lastPlayedAtRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  const play = useCallback(() => {
    if (typeof window === 'undefined') return;

    const now = Date.now();
    if (now - lastPlayedAtRef.current < MIN_INTERVAL_MS) return;
    lastPlayedAtRef.current = now;

    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      const ctx = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = ctx;

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }

      const startAt = ctx.currentTime + 0.01;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, startAt);
      master.gain.linearRampToValueAtTime(0.085, startAt + 0.02);
      master.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.1);
      master.connect(ctx.destination);

      const makeTone = (
        frequency: number,
        offset: number,
        duration: number,
        volume: number,
        type: OscillatorType,
      ) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1800, startAt + offset);
        filter.Q.setValueAtTime(0.7, startAt + offset);

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, startAt + offset);

        gain.gain.setValueAtTime(0.0001, startAt + offset);
        gain.gain.linearRampToValueAtTime(volume, startAt + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(master);

        osc.start(startAt + offset);
        osc.stop(startAt + offset + duration + 0.03);
      };

      makeTone(659.25, 0, 0.45, 0.9, 'sine');
      makeTone(987.77, 0.12, 0.62, 0.45, 'triangle');
      makeTone(1318.51, 0.24, 0.5, 0.16, 'sine');
    } catch {
      // Ignore autoplay / audio-context errors silently.
    }
  }, []);

  return play;
}
