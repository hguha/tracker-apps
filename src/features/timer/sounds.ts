// All audio (§6.8). Synthesized, so there are no assets to load.
//
// Most of the complexity here is iOS. Three separate things silence a PWA there,
// and none of them reports an error:
//
//  1. **The ringer switch.** A page that only ever uses Web Audio gets the
//     *ambient* audio session, which the hardware silent switch hard-mutes. The
//     context still says `running` and the oscillators still run — you just hear
//     nothing. Claiming the `playback` session fixes it; on iOS < 16.4 the only
//     lever is an `<audio>` element that is actually playing, so a silent loop is
//     started during the unlock gesture to promote the session.
//  2. **`'interrupted'`.** WebKit has a fourth, non-standard AudioContext state.
//     Backgrounding the app, locking the screen, or taking a call moves the
//     context there — constantly, mid-workout. Resuming only on `'suspended'`
//     leaves it stuck and every later cue is dropped.
//  3. **Gesture-bound construction.** A context built outside a user gesture
//     starts suspended and is materially harder to resume, so only the gesture
//     handlers construct one; every other path may resume but never create.

import { haptic as deviceHaptic, hapticSuccess } from '@/platform/haptics'

export type SoundCue =
  | 'set-logged'
  | 'pr'
  | 'rest-warning'
  | 'rest-complete'
  | 'workout-complete'
  | 'workout-start'
  | 'exercise-added'
  | 'superset'
  | 'undo'

// WebKit adds 'interrupted', which the DOM types don't know about.
type ExtendedState = AudioContextState | 'interrupted'

let context: AudioContext | null = null
let master: GainNode | null = null
let isEnabled = true
// Kept alive for the whole session: pausing it drops the audio session back to
// ambient and the silent switch starts muting us again.
let sessionKeeper: HTMLAudioElement | null = null

export function setSoundEnabled(enabled: boolean): void {
  isEnabled = enabled
}

function stateOf(ctx: AudioContext): ExtendedState {
  return ctx.state as ExtendedState
}

// A half-second of silence. Played (looping) to claim a non-ambient audio session
// on iOS versions without navigator.audioSession.
const SILENCE_MP3 =
  'data:audio/mpeg;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA' +
  'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC' +
  'AgICAgICAgICAgICAgICAgICAgICAgICAgIAAAAA8TEFNRTMuMTAwBK8AAAAAAAAAABUgJAUHQQ' +
  'AB9AAAAnGMHkkIAAgAAAAAAAAAAAAAAAAA'

// Only a real gesture may reach this: iOS ties a usable context to user activation.
function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (context) return context

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null

  context = new Ctor()
  // One master gain, so per-cue values stay relative and volume has one home.
  master = context.createGain()
  master.gain.value = 1
  master.connect(context.destination)
  return context
}

// iOS 16.4+. 'playback' is the category that ignores the ringer switch.
function claimPlaybackSession(): void {
  const session = (navigator as unknown as { audioSession?: { type: string } })
    .audioSession
  if (session) session.type = 'playback'
}

// For iOS < 16.4, where audioSession doesn't exist: a *playing* media element is
// the only way to get out of the ambient category.
function startSessionKeeper(): void {
  if (sessionKeeper || typeof Audio === 'undefined') return
  const element = new Audio(SILENCE_MP3)
  element.loop = true
  element.volume = 0.0001
  // Otherwise iOS takes the element fullscreen when it starts.
  element.setAttribute('playsinline', '')
  sessionKeeper = element
  // Must be called inside the gesture; a rejection just means no session bump.
  void element.play().catch(() => {})
}

// Resume without constructing. Safe to call from timers, promises and lifecycle
// events, none of which carry user activation.
function resumeContext(): Promise<void> {
  if (!context) return Promise.resolve()
  if (stateOf(context) === 'running') return Promise.resolve()
  // Any non-running state, not just 'suspended' — see (2) above.
  return context.resume().catch(() => {})
}

/** Must be called from within a user gesture. */
export function unlockAudio(): void {
  const ctx = ensureContext()
  if (!ctx) return

  claimPlaybackSession()
  startSessionKeeper()
  void resumeContext()

  // Starting a source inside the gesture is what WebKit's unlock heuristic
  // historically keys on; resume() alone isn't always enough.
  try {
    const source = ctx.createBufferSource()
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
    source.connect(ctx.destination)
    source.start(0)
  } catch {
    // A context too young to allocate a buffer will be unlocked by the next tap.
  }
}

// Unlocks on first interaction and re-arms afterwards. Install once at the app
// root. Listeners are deliberately never removed on first success: iOS
// re-interrupts the context repeatedly over a session.
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {}

  const options = { passive: true } as const
  // Only gestures may construct.
  const gestures: (keyof WindowEventMap)[] = [
    'pointerdown',
    'touchend',
    'click',
    'keydown',
  ]
  const onGesture = () => unlockAudio()
  // Coming back to the foreground carries no activation, so this can only resume
  // an existing context — it must not create one.
  const onReturn = () => void resumeContext()

  for (const event of gestures) window.addEventListener(event, onGesture, options)
  window.addEventListener('focus', onReturn, options)
  // iOS fires pageshow on back-forward-cache restore, which visibilitychange misses.
  window.addEventListener('pageshow', onReturn, options)
  document.addEventListener('visibilitychange', onReturn, options)

  return () => {
    for (const event of gestures) window.removeEventListener(event, onGesture)
    window.removeEventListener('focus', onReturn)
    window.removeEventListener('pageshow', onReturn)
    document.removeEventListener('visibilitychange', onReturn)
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
// Raised across the board — through a phone speaker in a gym the old values were
// close to inaudible, which reads as "sound is broken".
const CUES: Record<SoundCue, Tone[]> = {
  'set-logged': [{ frequency: 880, at: 0, duration: 0.045, gain: 0.11 }],

  pr: [
    { frequency: 587.33, at: 0, duration: 0.12, gain: 0.24 },
    { frequency: 739.99, at: 0.085, duration: 0.12, gain: 0.24 },
    { frequency: 987.77, at: 0.17, duration: 0.26, gain: 0.28 },
  ],

  'rest-warning': [{ frequency: 523.25, at: 0, duration: 0.06, gain: 0.16 }],

  'rest-complete': [
    { frequency: 660, at: 0, duration: 0.16, gain: 0.42 },
    { frequency: 880, at: 0.18, duration: 0.18, gain: 0.42 },
  ],

  'workout-complete': [
    { frequency: 523.25, at: 0, duration: 0.5, gain: 0.2 },
    { frequency: 659.25, at: 0.06, duration: 0.5, gain: 0.2 },
    { frequency: 783.99, at: 0.12, duration: 0.55, gain: 0.2 },
    { frequency: 1046.5, at: 0.18, duration: 0.6, gain: 0.16 },
  ],

  // A rising two-note open, the mirror of workout-complete's fall.
  'workout-start': [
    { frequency: 440, at: 0, duration: 0.14, gain: 0.16 },
    { frequency: 659.25, at: 0.1, duration: 0.22, gain: 0.16 },
  ],

  'exercise-added': [
    { frequency: 698.46, at: 0, duration: 0.05, gain: 0.1, type: 'triangle' },
  ],

  superset: [
    { frequency: 587.33, at: 0, duration: 0.06, gain: 0.12, type: 'triangle' },
    { frequency: 880, at: 0.055, duration: 0.08, gain: 0.12, type: 'triangle' },
  ],

  // Deliberately falling: it should read as "that was taken back".
  undo: [
    { frequency: 587.33, at: 0, duration: 0.06, gain: 0.1 },
    { frequency: 415.3, at: 0.05, duration: 0.09, gain: 0.1 },
  ],
}

// Haptics that pair with a cue. Kept as data next to CUES so a new cue can opt in
// without another bespoke `signalX` wrapper.
const CUE_HAPTICS: Partial<Record<SoundCue, number | number[]>> = {
  'rest-complete': [120, 60, 120],
  pr: [40, 40, 90],
  'workout-complete': [90, 50, 90, 50, 140],
}

function emit(cue: SoundCue, ctx: AudioContext, destination: AudioNode): void {
  const now = ctx.currentTime
  for (const tone of CUES[cue]) {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = tone.type ?? 'sine'
    oscillator.frequency.value = tone.frequency

    const startAt = now + tone.at
    // Ramp both edges — a hard start or stop clicks audibly.
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(tone.gain, startAt + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration)

    oscillator.connect(gain).connect(destination)
    oscillator.start(startAt)
    oscillator.stop(startAt + tone.duration + 0.02)
  }
}

export function playCue(cue: SoundCue): void {
  if (!isEnabled) return
  // Haptics are worth firing even when the context is asleep, and they're the only
  // feedback that survives a silenced phone.
  if (cue === 'pr') hapticSuccess()
  else {
    const pattern = CUE_HAPTICS[cue]
    if (pattern !== undefined) vibrate(pattern)
  }

  const ctx = context
  const out = master
  // No context yet means no gesture yet, and only a gesture may create one.
  if (!ctx || !out) return

  if (stateOf(ctx) !== 'running') {
    // resume() is async, so the old code's synchronous re-check could never
    // succeed and dropped the cue. Play it when the context actually wakes.
    void resumeContext().then(() => {
      if (stateOf(ctx) === 'running') emit(cue, ctx, out)
    })
    return
  }

  emit(cue, ctx, out)
}

/** Haptics where available. Independent of the sound toggle. */
export function vibrate(pattern: number | number[]): void {
  deviceHaptic(pattern)
}

export function signalRestComplete(): void {
  playCue('rest-complete')
}

// Nodes queued for a future time, so they can be torn down if rest is cancelled.
let scheduled: AudioScheduledSourceNode[] = []

export function cancelScheduledRest(): void {
  for (const node of scheduled) {
    try {
      node.stop()
    } catch {
      // Already finished; nothing to stop.
    }
  }
  scheduled = []
}

/**
 * Queues the rest chime on the audio clock instead of a JS timer.
 *
 * `setInterval` is frozen while an installed PWA is backgrounded or the screen is
 * locked — which is exactly what happens when you pocket the phone during a
 * three-minute rest — so the timer-driven chime never fired. A node started at an
 * absolute `currentTime` is owned by the audio thread and plays regardless.
 *
 * Best-effort: it needs an unlocked context, and iOS may still interrupt the
 * session. The visible bar and the timer-driven cue remain the source of truth.
 */
export function scheduleRestComplete(secondsFromNow: number): void {
  cancelScheduledRest()
  if (!isEnabled || secondsFromNow <= 0) return
  const ctx = context
  const out = master
  if (!ctx || !out || stateOf(ctx) !== 'running') return

  const base = ctx.currentTime + secondsFromNow
  for (const tone of CUES['rest-complete']) {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = tone.type ?? 'sine'
    oscillator.frequency.value = tone.frequency

    const startAt = base + tone.at
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(tone.gain, startAt + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration)

    oscillator.connect(gain).connect(out)
    oscillator.start(startAt)
    oscillator.stop(startAt + tone.duration + 0.02)
    scheduled.push(oscillator)
  }
}
