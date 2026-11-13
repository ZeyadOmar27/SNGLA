let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!audioCtx && typeof window !== 'undefined') {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function playTone(
  ctx: AudioContext,
  freqStart: number,
  freqEnd: number,
  durationSec: number,
  delaySec: number,
  type: OscillatorType,
  gainPeak: number,
) {
  const start = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), start + durationSec);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationSec + 0.02);
}

/** Playful metallic tongs clamp + bright chime on a clean lunar sample grab. */
export function playCleanGrabSfx(isGenesis: boolean) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (isGenesis) {
      playTone(ctx, 523.25, 523.25, 0.14, 0, 'triangle', 0.14);
      playTone(ctx, 659.25, 659.25, 0.14, 0.09, 'triangle', 0.14);
      playTone(ctx, 783.99, 783.99, 0.16, 0.18, 'triangle', 0.15);
      playTone(ctx, 1046.5, 1046.5, 0.34, 0.27, 'sine', 0.16);
    } else {
      playTone(ctx, 440, 660, 0.12, 0, 'triangle', 0.12);
      playTone(ctx, 880, 987.77, 0.2, 0.09, 'sine', 0.11);
    }
  } catch {
    // Ignore audio context restrictions
  }
}

/** Comical low boing wobble when tongs splash regolith dust instead of grabbing cleanly. */
export function playDustFumbleSfx() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    playTone(ctx, 260, 115, 0.22, 0, 'sawtooth', 0.08);
    playTone(ctx, 155, 92, 0.18, 0.12, 'triangle', 0.09);
  } catch {
    // Ignore audio context restrictions
  }
}

/** Crisp mechanical cockpit toggle click for LRV steering mode & reverse latch switches. */
export function playSwitchClickSfx() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    playTone(ctx, 1120, 540, 0.045, 0, 'square', 0.045);
  } catch {
    // Ignore audio context restrictions
  }
}

