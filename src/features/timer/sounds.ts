/**
 * All audio (§6.8). One AudioContext, one entry point.
 *
 * Two constraints shape this:
 *   - The context must be created or resumed from a real user gesture, or
 *     browsers leave it suspended and every cue silently fails. `unlockAudio`
 *     runs on the session's first tap.
 *   - `set-logged` fires 30+ times a session, so it has to sit under
 *     conversation volume. Cue gain is not uniform — frequency of use is
 *     inversely proportional to loudness.
 *
 * Synthesized rather than sampled: no asset loading, no bundle weight, and a
 * cue can be retuned by changing two numbers.
 */

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

/**
 * Unlocks on the first interaction anywhere in the app, and re-arms whenever the
 * tab is backgrounded — iOS suspends the context on background, so a session
 * resumed after a phone call would otherwise be silent for the rest of its life.
 *
 * Installed once at the app root rather than per screen: an earlier version
 * unlocked only on the workout screen, which left every cue elsewhere silent.
 */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {}

  const unlock = () => unlockAudio()

  // `pointerdown` covers taps and clicks; `keydown` covers desktop keyboard use.
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
  /** Hz. */
  frequency: number
  /** Seconds from the cue's start. */
  at: number
  duration: number
  gain: number
  type?: OscillatorType
}

/**
 * Cue definitions. Kept declarative so the whole sound design is legible in
 * one place and tunable without touching playback code.
 */
const CUES: Record<SoundCue, Tone[]> = {
  // Barely-there click. Short envelope, low gain, mid frequency.
  'set-logged': [{ frequency: 880, at: 0, duration: 0.045, gain: 0.055 }],

  // Rising major triad. Rare enough to be prominent.
  pr: [
    { frequency: 587.33, at: 0, duration: 0.12, gain: 0.16 }, // D5
    { frequency: 739.99, at: 0.085, duration: 0.12, gain: 0.16 }, // F#5
    { frequency: 987.77, at: 0.17, duration: 0.26, gain: 0.19 }, // B5
  ],

  // Single soft tick, clearly not the expiry chime.
  'rest-warning': [{ frequency: 523.25, at: 0, duration: 0.06, gain: 0.08 }],

  // Two rising tones — the established rest-over sound.
  'rest-complete': [
    { frequency: 660, at: 0, duration: 0.16, gain: 0.3 },
    { frequency: 880, at: 0.18, duration: 0.18, gain: 0.3 },
  ],

  // Resolving chord, played together rather than in sequence.
  'workout-complete': [
    { frequency: 523.25, at: 0, duration: 0.5, gain: 0.13 }, // C5
    { frequency: 659.25, at: 0.06, duration: 0.5, gain: 0.13 }, // E5
    { frequency: 783.99, at: 0.12, duration: 0.55, gain: 0.13 }, // G5
    { frequency: 1046.5, at: 0.18, duration: 0.6, gain: 0.1 }, // C6
  ],
}

export function playCue(cue: SoundCue): void {
  if (!isEnabled) return

  // Last-ditch unlock, in case a cue fires before any interaction was seen.
  // The resume is async so *this* cue may still be lost, but the next won't be.
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
