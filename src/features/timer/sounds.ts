// All audio (§6.8). Synthesized, so there are no assets to load. The context
// must be unlocked from a real gesture or browsers keep it suspended and every
// cue silently fails.

export type SoundCue =
  'set-logged' | 'pr' | 'rest-warning' | 'rest-complete' | 'workout-complete'

let context: AudioContext | null = null
let isEnabled = true

export function setSoundEnabled(enabled: boolean): void {
  isEnabled = enabled
}

export function unlockAudio(): void {
  if (typeof window === 'undefined') return
  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return
    context = new Ctor()
  }
  if (context.state === 'suspended') void context.resume()
}

// Unlocks on first interaction and re-arms on `visibilitychange`, because iOS
// re-suspends the context on background. Install once at the app root.
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {}

  const unlock = () => unlockAudio()

  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
  document.addEventListener('visibilitychange', unlock)

  return () => {
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    document.removeEventListener('visibilitychange', unlock)
  }
}

interface Tone {
  frequency: number
  // Seconds from the cue's start.
  at: number
  duration: number
  gain: number
  type?: OscillatorType
}

// Gain is inversely proportional to how often a cue fires: set-logged plays 30+
// times a session so it sits under conversation volume; a PR is rare and loud.
const CUES: Record<SoundCue, Tone[]> = {
  'set-logged': [{ frequency: 880, at: 0, duration: 0.045, gain: 0.055 }],

  pr: [
    { frequency: 587.33, at: 0, duration: 0.12, gain: 0.16 },
    { frequency: 739.99, at: 0.085, duration: 0.12, gain: 0.16 },
    { frequency: 987.77, at: 0.17, duration: 0.26, gain: 0.19 },
  ],

  'rest-warning': [{ frequency: 523.25, at: 0, duration: 0.06, gain: 0.08 }],

  'rest-complete': [
    { frequency: 660, at: 0, duration: 0.16, gain: 0.3 },
    { frequency: 880, at: 0.18, duration: 0.18, gain: 0.3 },
  ],

  'workout-complete': [
    { frequency: 523.25, at: 0, duration: 0.5, gain: 0.13 },
    { frequency: 659.25, at: 0.06, duration: 0.5, gain: 0.13 },
    { frequency: 783.99, at: 0.12, duration: 0.55, gain: 0.13 },
    { frequency: 1046.5, at: 0.18, duration: 0.6, gain: 0.1 },
  ],
}

export function playCue(cue: SoundCue): void {
  if (!isEnabled) return

  // resume() is async, so a cue firing before any interaction may still be lost;
  // the next one won't be.
  if (!context || context.state !== 'running') {
    unlockAudio()
    if (!context || context.state !== 'running') return
  }

  const now = context.currentTime
  for (const tone of CUES[cue]) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = tone.type ?? 'sine'
    oscillator.frequency.value = tone.frequency

    const startAt = now + tone.at
    // Ramp both edges — a hard start or stop clicks audibly.
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(tone.gain, startAt + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration)

    oscillator.connect(gain).connect(context.destination)
    oscillator.start(startAt)
    oscillator.stop(startAt + tone.duration + 0.02)
  }
}

/** Haptics where available. A no-op on iOS Safari, which has no Vibration API. */
export function vibrate(pattern: number | number[]): void {
  if (!isEnabled) return
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern)
  }
}

export function signalRestComplete(): void {
  playCue('rest-complete')
  vibrate([120, 60, 120])
}
