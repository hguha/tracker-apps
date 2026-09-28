/**
 * The product's feature set, as content.
 *
 * `spotlights` are the big alternating sections with a screenshot; `cards` is the grid underneath
 * that covers everything else. Accents come from the app's own macro palette, so a section's colour
 * means the same thing here as it does in a bar.
 *
 * The claims are deliberately specific — 120 g of flour, 227 g of beef, one row per ingredient —
 * because the whole difference between this app and the big ones is that it refuses to invent a
 * number, and a vague claim is indistinguishable from one.
 */

import type { Card, Conversation, Faq, GalleryItem, Spotlight } from '@tracker-engine/site-kit'

export const spotlights: Spotlight[] = [
  {
    id: 'logging',
    eyebrow: 'Logging',
    title: 'Four foods is one visit, not four.',
    body: 'Tick everything you ate and log it in one go. Each row arrives at the amount you had last time — the portion, “2 slices”, not the grams it came to — so most days are typing nothing at all.',
    screen: 'log',
    secondScreen: 'amount',
    thirdScreen: 'day',
    accent: 'var(--macro-carbs)',
    points: [
      {
        title: 'The amount is already right',
        body: '“1 serving” is wrong for almost everybody on almost every food. Yours is remembered per food, and re-typing 180 g of chicken daily is the friction that ends a diary.',
      },
      {
        title: 'Every portion carries its weight',
        body: '“4 oz · 113 g”, “1 cup · 158 g”. USDA’s own labels are a mix of units with no common scale, and “1 RACC” means nothing to anybody.',
      },
      {
        title: 'And the ways in when search fails',
        body: 'Scan a barcode, photograph the plate, describe the meal in a sentence, or type calories only. A food the databases have never heard of takes thirty seconds to add.',
      },
    ],
  },
  {
    id: 'targets',
    eyebrow: 'Targets',
    title: 'Your target is measured, not predicted.',
    body: 'Most apps compute what someone your height and age burns. This one watches what your weight and your intake actually did, and works backwards to what you burn — with an error bar, because it is an estimate and pretending otherwise would be the lie.',
    screen: 'today',
    secondScreen: 'insights',
    thirdScreen: 'insights-body',
    accent: 'var(--macro-fiber)',
    points: [
      {
        title: 'It re-measures every week',
        body: 'A check-in compares the trend against the plan and moves the target if it has to. You approve the change; nothing is adjusted behind your back.',
      },
      {
        title: 'A goal with an end',
        body: 'A rate is a good input and a useless thing to aim at — nothing ever satisfies “lose 0.5% a week”. Set a weight, and the date comes from the measured trend as well as the intended one. Where those disagree is the interesting part.',
      },
      {
        title: 'Yesterday is scored against yesterday’s target',
        body: 'History uses the target that was in force then, not today’s. Otherwise changing your goal silently rewrites whether last month went well.',
      },
    ],
  },
  {
    id: 'recipes',
    eyebrow: 'Recipes',
    title: 'Paste a link. Cook from it. Log a serving.',
    body: 'Recipes arrive whole — the ingredients as written, the method, the servings — and end up as food you can log by the half-serving. Nothing nutritional is ever read off the web page.',
    screen: 'recipe',
    secondScreen: 'recipes',
    thirdScreen: 'insights-habits',
    accent: 'var(--macro-fat)',
    points: [
      {
        title: 'The amounts are read, not guessed',
        body: '“1/2 pound lean ground beef” is 227 g, worked out on your device in about a second. A cup becomes grams from that food’s own USDA portions, because a cup of flour is 120 g and a cup of oil is 218 g.',
      },
      {
        title: 'One row per ingredient',
        body: 'So the day keeps its micronutrients, each amount stays editable, and it can tell you the ricotta was a third of the calories. A single total has no food behind it.',
      },
      {
        title: 'And it knows what to suggest',
        body: 'What fits in what’s left of today, what you actually cook, what you haven’t had in a while — ranked, with the cuisine mix kept honest by counting sittings rather than rows.',
      },
    ],
  },
]

/**
 * The AI section.
 *
 * Framed around the thing that is actually unusual: it reads your own numbers by asking for them,
 * and anything it wants to log comes back as a card you confirm. The transcripts are scripted; the
 * screenshots beside them are real.
 */
export const conversation = {
  eyebrow: 'Coach',
  title: 'It answers from your log, not from the internet.',
  body: 'Ask what’s left for today, why the week stalled, or what to make with 700 calories to spend. It fetches your own days, weights and targets to answer — and anything it offers to log arrives as a card you confirm.',
  accent: 'var(--macro-alcohol)',
  screens: ['coach', 'today'],
  threads: [
    [
      { from: 'you', text: 'What’s left for today?' },
      { from: 'coach', text: '640 kcal and 48 g of protein. Fat is already at target.' },
      { from: 'you', text: 'Give me a dinner that fits.' },
      { from: 'coach', text: 'Your chicken and rice bowl at one serving lands at 610. Log it?' },
    ],
    [
      { from: 'you', text: 'Why has my weight stalled?' },
      { from: 'coach', text: 'It hasn’t — the trend is down 0.4 kg over three weeks. Last week scattered because of two unlogged days.' },
      { from: 'you', text: 'Should I cut more?' },
      { from: 'coach', text: 'Not yet. You’re averaging 240 kcal under target already.' },
    ],
    [
      { from: 'you', text: 'Am I getting enough protein?' },
      { from: 'coach', text: '1.5 g/kg on average, against the 1.8 your plan asks for.' },
      { from: 'you', text: 'Where’s the shortfall?' },
      { from: 'coach', text: 'Breakfast. It averages 11 g; every other meal clears 40.' },
    ],
  ],
  points: [
    {
      title: 'It asks for the numbers',
      body: 'Days, weights, targets, recipes — fetched by name when the question needs them, so an answer can be checked against the screen it came from.',
    },
    {
      title: 'Nothing is logged behind your back',
      body: 'A suggestion arrives as a card with its calories on it. You tap to accept, and it writes the same rows any other path would.',
    },
    {
      title: 'And it still answers offline',
      body: 'With no key and no signal, a local coach answers the countable questions — what’s left, how the week went — instead of showing you an error.',
    },
  ],
} as const satisfies Conversation

// Six, so the grid tiles cleanly at two columns (phone) and three (desktop) with no ragged spans.
export const cards: Card[] = [
  {
    title: 'Scan it or shoot it',
    body: 'A barcode resolves against USDA, then Open Food Facts — no key needed, so it works on a device that has never signed in. A photo of the plate comes back as separate foods you can correct.',
    icon: 'camera',
    accent: 'var(--macro-carbs)',
  },
  {
    title: 'Water, and reminders you set',
    body: 'A glass is one tap. Reminders are times you choose — including for snacks and the weigh-in — rather than five presets that never include 12:15.',
    icon: 'droplet',
    accent: 'var(--macro-fiber)',
  },
  {
    title: 'Weigh-ins that expect noise',
    body: 'A trend line through the scatter, every reading still visible behind it, and Apple Health read for you on iOS. Weight only, read-only.',
    icon: 'scale',
    accent: 'var(--macro-protein)',
  },
  {
    title: 'The micronutrients too',
    body: 'Fibre, sodium, potassium, calcium, iron, sugar and saturated fat, scored against a daily reference — because the generic USDA rows carry them.',
    icon: 'activity',
    accent: 'var(--macro-fat)',
  },
  {
    title: 'Home, out, or takeaway',
    body: 'Asked once, on the finished meal, and counted by sitting — so a restaurant dinner logged as six items doesn’t outvote a home one logged as one.',
    icon: 'list',
    accent: 'var(--macro-alcohol)',
  },
  {
    title: 'Yours to take away',
    body: 'Export every row as JSON, restore it anywhere, and delete the account from inside the app. The device is the source of truth; the server is a copy.',
    icon: 'download',
    accent: 'var(--macro-carbs)',
  },
]

/** The self-scrolling gallery under the hero. */
export const gallery: readonly GalleryItem[] = [
  { screen: 'today', label: 'Today' },
  { screen: 'log', label: 'Log several at once' },
  { screen: 'amount', label: 'Portions, with weights' },
  { screen: 'day', label: 'A day, editable' },
  { screen: 'recipe', label: 'Cook from it' },
  { screen: 'recipes', label: 'What should I cook' },
  { screen: 'insights', label: 'Insights · Overview' },
  { screen: 'insights-body', label: 'Measured expenditure' },
  { screen: 'insights-habits', label: 'Where you eat' },
  { screen: 'history', label: 'History' },
  { screen: 'coach', label: 'Coach' },
  { screen: 'settings', label: 'Settings' },
  { screen: 'onboarding', label: 'First run' },
] as const

export const faqs: readonly Faq[] = [
  {
    q: 'Is it really free?',
    a: 'Yes — no subscription, no paywalled charts, no ads, and no account needed to start. The paid tiers in other trackers are mostly the parts that are here by default.',
  },
  {
    q: 'Where do the numbers come from?',
    a: 'USDA FoodData Central, and Open Food Facts for barcodes. Over 2,200 generic and composite rows ship with the app, so search works with no signal at all — and they carry portions and micronutrients, which crowd-sourced entries usually don’t.',
  },
  {
    q: 'What happens with no signal?',
    a: 'Everything except a web import and the AI. Logging, search over what’s on the device, editing a day, weighing in — all instant, because the device is the source of truth and the network is never in the way.',
  },
  {
    q: 'Is my food diary private?',
    a: 'There are no analytics or crash SDKs. Signing in is optional. The one thing worth knowing: a food search sends the words you typed, and the photo feature sends the photo — both to answer that request, nothing else. The privacy policy lists every path that leaves the device.',
  },
  {
    q: 'Does it count calories from exercise?',
    a: 'It doesn’t have to. Expenditure is measured from your own weight trend and intake, so the training you did is already in the number. Adding a watch’s active energy on top would count it twice.',
  },
  {
    q: 'iPhone, Android, or web?',
    a: 'One app. The iPhone build is on its way to the App Store; on Android and the desktop, open the web app and install it to your home screen. Same build, offline either way.',
  },
] as const
