/**
 * The product's feature set, as content.
 *
 * `spotlights` are the big alternating sections with a screenshot; `cards` is the
 * grid underneath that covers everything else. Accents come from the app's own
 * region palette, so a card's colour means the same thing here as it does in a
 * chart.
 */

export interface Spotlight {
  id: string
  eyebrow: string
  title: string
  body: string
  /** The featured screen — sits at the front of the stack. */
  screen: string
  /** Phones offset behind the featured one, for a fuller three-up fan. */
  secondScreen?: string
  thirdScreen?: string
  points: { title: string; body: string }[]
  accent: string
}

export const spotlights: Spotlight[] = [
  {
    id: 'logging',
    eyebrow: 'Logging',
    title: 'The set is logged the moment you type it.',
    body: 'No confirm button, no lag while a server thinks. Every row is pre-filled with last time’s numbers — most sets are one tap, and beating a record lights the row green.',
    screen: 'workout',
    secondScreen: 'exercise-detail',
    thirdScreen: 'finish',
    accent: 'var(--region-chest)',
    points: [
      {
        title: 'Last time, right in the row',
        body: 'What you hit last session sits next to what you’re typing now — never a tap or a screen away.',
      },
      {
        title: 'PRs light up as you go',
        body: 'Beat your history and the row earns a trophy, live, measured against past sessions.',
      },
      {
        title: 'One-thumb everything',
        body: 'Swipe to delete or duplicate, drag to reorder, drop one lift on another to superset. The rest timer chimes and keeps your music playing.',
      },
    ],
  },
  {
    id: 'insights',
    eyebrow: 'Insights',
    title: 'A log any app can do. This tells you what it means.',
    body: 'Twenty-two charts across strength, volume, habit, and body — estimated 1RM, volume by body part, stalled-lift detection. Every chart flips to a table for the exact number.',
    screen: 'insights-overview',
    secondScreen: 'insights-strength',
    thirdScreen: 'insights-volume',
    accent: 'var(--region-legs)',
    points: [
      {
        title: 'Estimated 1RM, per lift',
        body: 'A projection and progression line for each exercise, so a plateau shows up before it costs you weeks.',
      },
      {
        title: 'Volume you can trust',
        body: 'Broken out by body part, bodyweight movements counted correctly, cardio kept out of your lifting totals.',
      },
      {
        title: 'Every angle, one tap apart',
        body: 'Strength, volume, habit, and body — with a table behind every chart the moment you want the exact number.',
      },
    ],
  },
  {
    id: 'sync',
    eyebrow: 'Local-first & sync',
    title: 'Instant on your phone. In sync across all of them.',
    body: 'Your device is the source of truth, so logging is instant, signal or not. Sign in and everything syncs to your other devices and the web — new phone, whole history already there.',
    screen: 'home',
    secondScreen: 'history-calendar',
    thirdScreen: 'history',
    accent: 'var(--region-cardio)',
    points: [
      {
        title: 'Instant, signal or not',
        body: 'Every read and write happens on-device. The network is never between you and the set you just did.',
      },
      {
        title: 'One log, every device',
        body: 'Your full history follows you — a new phone, a tablet, the web — so switching never resets your progress.',
      },
      {
        title: 'Start free, sign in later',
        body: 'No account to begin. Add an email whenever, and everything you already logged is claimed from that moment.',
      },
    ],
  },
]

/**
 * The dedicated AI-coach section.
 *
 * The coach is a real back-and-forth: it asks follow-ups when a request is vague,
 * reads your actual log, can see the workout you're in the middle of, and knows
 * the templates you already have. `thread` is a short scripted transcript shown
 * beside the screenshots so the section demonstrates the conversation rather than
 * just claiming it.
 */
export const coach = {
  eyebrow: 'AI coach',
  title: 'A coach you can actually talk to.',
  body: 'Draft a plan, then refine it right in the chat — fewer days, heavier, more arms. It re-plans from your real training, and every version saves as editable templates.',
  accent: 'var(--region-triceps)',
  shots: [
    { screen: 'coach-plan', label: 'Programs, drafted as editable templates' },
    { screen: 'coach', label: 'Spots what you’re neglecting' },
    { screen: 'coach-ask', label: 'Answers from your history' },
  ],
  /**
   * Scripted exchanges — user vs coach — that rotate in the section, each showing
   * a different capability: refining a template, in-workout accessory calls, and
   * reading your progress. AiCoach.astro crossfades between them.
   */
  threads: [
    [
      { from: 'you', text: 'Build me a push/pull/legs plan for size.' },
      { from: 'coach', text: 'Here’s a 3-day PPL, seeded at your working weights.' },
      { from: 'you', text: 'Make it a 6-week strength block.' },
      { from: 'coach', text: 'Done — same split, now 4–6 reps and heavier. Save it as templates?' },
    ],
    [
      { from: 'you', text: 'I want to add an arm day.' },
      { from: 'coach', text: 'You already press twice a week — fold arms in, or add a fourth day?' },
      { from: 'you', text: 'A fourth day.' },
      { from: 'coach', text: 'Here’s “Arms & Delts,” seeded at your curl and pushdown weights.' },
    ],
    [
      { from: 'you', text: 'My bench has stalled.' },
      { from: 'coach', text: 'Flat for 4 weeks. Want me to swap in a heavier top set?' },
      { from: 'you', text: 'Yeah, do that.' },
      { from: 'coach', text: 'Updated your Push day — 3×3 heavy, then your usual back-offs.' },
    ],
  ],
  points: [
    {
      title: 'It asks before it assumes',
      body: 'A vague ask gets a clarifying question back, so plans fit your real training.',
    },
    {
      title: 'Refine, don’t restart',
      body: 'Push back — heavier, fewer days, more arms — and it re-drafts in place. Save any version as templates.',
    },
    {
      title: 'Private by default',
      body: 'No name, notes, or dates leave your device. Inspect the summary before it sends.',
    },
  ],
} as const

export interface Card {
  title: string
  body: string
  icon: string
  accent: string
}

// Six, so the grid tiles cleanly at two columns (phone) and three (desktop) with
// no ragged spans.
export const cards: Card[] = [
  {
    title: 'Templates & folders',
    body: 'Save any session as a template, organise them in folders, or repeat a past workout as-is.',
    icon: 'layers',
    accent: 'var(--region-shoulders)',
  },
  {
    title: 'One library, every variation',
    body: 'Pick equipment as you add a lift, so a barbell and a dumbbell bench keep separate records.',
    icon: 'dumbbell',
    accent: 'var(--region-chest)',
  },
  {
    title: 'Muscle map',
    body: 'A body view that fills in from what you’ve logged, so a neglected region is easy to spot.',
    icon: 'target',
    accent: 'var(--region-legs)',
  },
  {
    title: 'Supersets & rest',
    body: 'Drop one lift onto another to superset. Per-exercise rest timers that tick, chime, and buzz.',
    icon: 'zap',
    accent: 'var(--region-cardio)',
  },
  {
    title: 'Your record, building',
    body: 'A weekly goal ring, a training streak, PRs, and milestones you earn as you train.',
    icon: 'flame',
    accent: 'var(--region-back)',
  },
  {
    title: 'Yours to export',
    body: 'Back up the whole log to JSON, restore it anywhere, and delete your account from inside the app.',
    icon: 'download',
    accent: 'var(--region-triceps)',
  },
]

/**
 * Leagues — the one thing that is coming rather than shipping.
 *
 * The name earns itself here: the record you build solo goes multiplayer. Framed
 * honestly as "next," with real design behind it (see the app repo's
 * docs/design-social-leagues.md), so it reads as a promise we can keep, not
 * vaporware.
 */
export const leagues = {
  eyebrow: 'Coming next',
  title: 'Your reputation, made multiplayer.',
  body: 'Everything above is yours alone today. Leagues take the record you’re already building and put it in play — a weekly ladder where showing up and setting PRs earns your rank, and friends can go head-to-head.',
  tiers: [
    { name: 'Bronze', color: 'var(--region-back)' },
    { name: 'Silver', color: 'var(--region-cardio)' },
    { name: 'Gold', color: 'var(--region-shoulders)' },
    { name: 'Platinum', color: 'var(--region-legs)' },
    { name: 'Diamond', color: 'var(--region-chest)' },
  ],
  points: [
    {
      icon: 'flame',
      title: 'A weekly ladder',
      body: 'Sessions, volume, and PRs earn points. Finish near the top of your bracket and you promote — Bronze up to Diamond.',
    },
    {
      icon: 'scale',
      title: 'Fair across bodyweights',
      body: 'A strength rating normalised for bodyweight and sex, so a lighter lifter and a heavier one genuinely compete.',
    },
    {
      icon: 'target',
      title: 'Friends & challenges',
      body: 'Add training partners and race a PR, a volume week, or a streak — with your log staying private the whole time.',
    },
  ],
} as const

/** The self-scrolling gallery under the feature grid. */
export const gallery = [
  { screen: 'onboarding', label: 'Welcome' },
  { screen: 'workout', label: 'Active workout' },
  { screen: 'exercise-detail', label: 'Exercise detail' },
  { screen: 'insights-overview', label: 'Insights · Overview' },
  { screen: 'insights-strength', label: 'Insights · Strength' },
  { screen: 'coach-plan', label: 'Coach · Program' },
  { screen: 'history-calendar', label: 'Calendar' },
  { screen: 'finish', label: 'Finish summary' },
  { screen: 'template-preview', label: 'Template preview' },
  { screen: 'library', label: 'Exercise library' },
  { screen: 'settings', label: 'Themes & settings' },
] as const

export const faqs = [
  {
    q: 'Is it really free?',
    a: 'Yes — no subscription, no paywalled charts, no ads, no “pro” tier. And no account needed to start.',
  },
  {
    q: 'What happens with no signal?',
    a: 'Nothing changes — logging is instant either way. Changes queue and push when you’re back online, in order, with retries.',
  },
  {
    q: 'Is my training data private?',
    a: 'No analytics or crash SDKs. The AI coach is opt-in and only gets a de-identified summary — no name, notes, or dates — which you can inspect first.',
  },
  {
    q: 'What are Leagues?',
    a: 'The one thing coming rather than shipping: your solo record, made multiplayer — opt-in, without exposing your actual workouts.',
  },
  {
    q: 'iOS, Android, or web?',
    a: 'All three, one app. Install natively or open the web app — it works offline and installs to your home screen.',
  },
] as const
