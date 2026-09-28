// Builds the offline food seed from the deployed `foods` function.
//
// The seed exists so search, portions and logging work on first launch with no network — and so the
// common case never costs a round trip. It was 46 hand-written staples, which meant "guacamole" and
// "refried beans" took three to six seconds to appear and looked, for those seconds, like foods the
// app had never heard of.
//
// Sourced through our own edge function rather than the FDC bulk download: the function already does
// the mapping, the generic-first ranking, the portion labelling and the zero-energy filtering, so a
// second implementation here would be a second set of those decisions to keep in step. It also keeps
// the USDA key server-side.
//
// Writes src/db/seed/foods.ts only. src/db/seed/staples.ts is hand-written and referred to by exact
// description from the demo data, so it is deliberately not touched here — see src/db/seed/index.ts.
//
// Usage: node scripts/build-food-seed.mjs   (needs .env with VITE_SUPABASE_URL / ANON_KEY)

import { readFileSync, writeFileSync } from 'node:fs'

/**
 * What to ask for.
 *
 * Ordinary food, in the words people type. Not a taxonomy — a shopping list, biased toward things
 * that are hard to guess the macros of and common enough to be worth the bytes.
 */
const QUERIES = [
  // Meat, fish, eggs
  'chicken breast', 'chicken thigh', 'chicken wing', 'rotisserie chicken', 'turkey breast',
  // Lean/fat ratios by name, because that is how mince is sold and how people search for it —
  // "ground beef" alone seeds the generic row and misses every one of them.
  'ground beef', 'ground beef 80 20', 'ground beef 90 10', 'ground beef 93 7', 'ground turkey',
  'beef steak', 'sirloin steak', 'ribeye', 'beef mince', 'pork chop', 'pork loin',
  'bacon', 'sausage', 'italian sausage', 'ham', 'salami', 'pepperoni', 'hot dog', 'meatballs',
  'lamb chop', 'salmon', 'tuna', 'canned tuna', 'shrimp', 'cod', 'tilapia', 'sardines',
  'egg', 'egg white', 'omelette',
  // Dairy
  'milk', 'skim milk', 'whole milk', 'almond milk', 'oat milk', 'soy milk', 'greek yogurt',
  'yogurt', 'cottage cheese', 'cheddar cheese', 'mozzarella cheese', 'parmesan cheese',
  'cream cheese', 'ricotta cheese', 'feta cheese', 'swiss cheese', 'provolone', 'gouda',
  'butter', 'heavy cream', 'half and half',
  'sour cream', 'ice cream', 'whey protein',
  // Grains, starches
  'white rice', 'brown rice', 'pasta', 'spaghetti', 'lasagna noodles', 'egg noodles', 'ramen',
  'bread', 'whole wheat bread', 'sourdough bread', 'bagel', 'english muffin', 'tortilla',
  'corn tortilla', 'pita bread', 'naan', 'oats', 'oatmeal', 'granola', 'cereal', 'cornflakes',
  'quinoa', 'couscous', 'barley', 'potato', 'sweet potato', 'french fries', 'hash browns',
  'crackers', 'pretzels', 'popcorn', 'tortilla chips', 'potato chips',
  // Legumes, nuts
  'black beans', 'kidney beans', 'pinto beans', 'refried beans', 'chickpeas', 'lentils',
  'baked beans', 'hummus', 'peanut butter', 'almond butter', 'peanuts', 'almonds', 'cashews',
  'walnuts', 'pecans', 'pistachios', 'sunflower seeds', 'chia seeds', 'tofu', 'tempeh', 'edamame',
  // Fruit
  'banana', 'apple', 'orange', 'grapes', 'strawberries', 'blueberries', 'raspberries',
  'blackberries', 'pineapple', 'mango', 'watermelon', 'cantaloupe', 'peach', 'pear', 'plum',
  'cherries', 'kiwi', 'avocado', 'lemon', 'lime', 'raisins', 'dates', 'dried apricots',
  // Vegetables
  'broccoli', 'cauliflower', 'spinach', 'kale', 'lettuce', 'romaine lettuce', 'cabbage',
  'carrot', 'celery', 'cucumber', 'tomato', 'cherry tomatoes', 'bell pepper', 'onion',
  'red onion', 'garlic', 'mushrooms', 'zucchini', 'green beans', 'peas', 'corn', 'asparagus',
  'brussels sprouts', 'beets', 'squash', 'pumpkin', 'eggplant', 'jalapeno', 'olives',
  // Fats, sauces, condiments
  'olive oil', 'vegetable oil', 'coconut oil', 'mayonnaise', 'ketchup', 'mustard', 'soy sauce',
  'hot sauce', 'barbecue sauce', 'ranch dressing', 'salsa', 'guacamole', 'marinara sauce',
  'tomato paste', 'tomato sauce', 'pesto', 'alfredo sauce', 'curry sauce', 'gravy', 'honey',
  'maple syrup', 'jam', 'sugar', 'brown sugar', 'flour', 'cocoa powder', 'vinegar',
  // Composite dishes — the reason a meal can be logged without breaking it up
  'pizza', 'cheeseburger', 'hamburger', 'burrito', 'taco', 'quesadilla', 'enchilada',
  'sandwich', 'turkey sandwich', 'grilled cheese', 'club sandwich', 'sushi', 'fried rice',
  'pad thai', 'lo mein', 'chicken curry', 'butter chicken', 'tikka masala', 'biryani',
  'lasagna', 'spaghetti and meatballs', 'macaroni and cheese', 'chili', 'beef stew',
  'chicken noodle soup', 'tomato soup', 'clam chowder', 'caesar salad', 'greek salad',
  'coleslaw', 'potato salad', 'pancakes', 'waffles', 'french toast', 'scrambled eggs',
  'breakfast burrito', 'chicken nuggets', 'fish and chips', 'shepherds pie', 'ramen soup',
  'falafel', 'shawarma', 'gyro', 'burrito bowl', 'poke bowl', 'stir fry',
  // Drinks, sweets
  'coffee', 'latte', 'cappuccino', 'tea', 'orange juice', 'apple juice', 'cola', 'diet cola',
  'sports drink', 'protein shake', 'beer', 'wine', 'whiskey', 'vodka', 'chocolate',
  'dark chocolate', 'cookie',
  'brownie', 'cake', 'donut', 'muffin', 'croissant', 'cheesecake', 'protein bar', 'granola bar',
  'espresso', 'mocha', 'hot chocolate', 'lemonade', 'iced tea', 'smoothie', 'milkshake',
  'frozen yogurt', 'pudding', 'jello', 'gummy candy', 'marshmallow', 'energy drink', 'kombucha',
  'hard cider', 'champagne', 'rum', 'gin', 'tequila', 'margarita',
  'apple pie', 'pumpkin pie', 'cinnamon roll', 'scone', 'biscuit', 'cornbread', 'banana bread',
  'pop tart', 'rice krispie treat',
  'beef jerky', 'chorizo', 'prosciutto', 'deli turkey', 'canned chicken', 'canned salmon',
  'crab', 'lobster', 'scallops', 'mussels', 'calamari', 'anchovies', 'duck', 'brisket',
  'pulled pork', 'pork ribs', 'meatloaf', 'chicken tenders', 'buffalo wings', 'fish sticks',
  'string cheese', 'halloumi', 'paneer', 'kefir', 'skyr', 'mascarpone', 'condensed milk',
  'evaporated milk', 'coconut milk', 'casein protein',
  'wild rice', 'farro', 'bulgur', 'rice noodles', 'soba noodles', 'udon noodles', 'gnocchi',
  'polenta', 'grits', 'breadcrumbs', 'panko', 'almond flour', 'rice cake', 'brioche',
  'rye bread', 'multigrain bread',
  'black eyed peas', 'lima beans', 'split peas', 'tahini', 'macadamia nuts', 'hazelnuts',
  'pumpkin seeds', 'flax seeds', 'hemp seeds', 'trail mix', 'seitan',
  'bok choy', 'snap peas', 'artichoke', 'leek', 'turnip', 'radish', 'sauerkraut', 'kimchi',
  'seaweed', 'okra', 'parsnip', 'butternut squash', 'papaya', 'pomegranate', 'grapefruit',
  'clementine', 'nectarine', 'figs', 'prunes', 'cranberries',
  'chicken parmesan', 'philly cheesesteak', 'reuben sandwich', 'blt sandwich', 'tuna salad',
  'chicken salad', 'egg salad', 'deviled eggs', 'nachos', 'poutine', 'corn dog', 'pot roast',
  'kebab', 'souvlaki', 'tabbouleh', 'baba ganoush', 'tzatziki', 'dumplings', 'spring roll',
  'samosa', 'pierogi', 'empanada', 'pho', 'banh mi', 'bibimbap', 'chicken katsu',
  'teriyaki chicken', 'orange chicken', 'sweet and sour chicken', 'paella', 'risotto',
  'carbonara', 'moussaka', 'shakshuka', 'cobb salad',
]

/** Per query. Enough to cover the obvious variants without three near-identical branded rows. */
const PER_QUERY = 6
/** A ceiling on the asset. Past this the parse cost on first launch starts to show. */
const MAX_FOODS = 2500

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=')
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
    }),
)

const URL_BASE = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL_BASE || !KEY) throw new Error('.env needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')

const byId = new Map()
let failed = 0

for (const [index, query] of QUERIES.entries()) {
  process.stdout.write(`\r[${index + 1}/${QUERIES.length}] ${query.padEnd(28)}`)
  try {
    const response = await fetch(`${URL_BASE}/functions/v1/foods`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'search', q: query, limit: PER_QUERY * 3, off: false }),
    })
    if (!response.ok) {
      failed += 1
      continue
    }
    const { foods = [] } = await response.json()
    // The function already ranks generic before branded, so taking from the top biases the seed
    // toward Foundation and FNDDS rows — the ones with portions and micronutrients.
    for (const food of foods.slice(0, PER_QUERY)) {
      if (!byId.has(food.id)) byId.set(food.id, food)
    }
  } catch {
    failed += 1
  }
}
process.stdout.write('\n')

const foods = [...byId.values()]
  .sort((a, b) => a.description.localeCompare(b.description))
  .slice(0, MAX_FOODS)
  // Sync columns are stamped at seed time, not baked into the asset.
  .map(({ createdAt, updatedAt, deletedAt, clientRev, ...rest }) => rest)

const withPortions = foods.filter((food) => food.portions.length > 0).length
const generic = foods.filter((food) => (food.dataType ?? '').toLowerCase() !== 'branded').length

// `per100` appears exactly once per food. `id` does not — every portion carries one too, which is
// how this guard first read 1,463 foods as 5,356 and refused a perfectly good run.
const existing = (readFileSync(new URL('../src/db/seed/foods.ts', import.meta.url), 'utf8').match(
  /"per100":/g,
) ?? []).length
if (foods.length < existing && !process.argv.includes('--force')) {
  console.error(
    `Refusing to write: ${foods.length} foods collected, ${existing} already in the seed` +
      (failed > 0 ? ` (${failed} queries failed)` : '') +
      '. Re-run when the rate limit resets, or pass --force.',
  )
  process.exit(1)
}

writeFileSync(
  new URL('../src/db/seed/foods.ts', import.meta.url),
  `import type { Food } from '@/domain/types'

/**
 * Offline food reference data, per 100 g.
 *
 * Generated by scripts/build-food-seed.mjs — do not edit by hand. ${foods.length} foods from
 * ${QUERIES.length} everyday queries, so search, portions and logging all work on first launch with
 * no network, and the common case never costs a round trip.
 *
 * ${generic} of them are generic or composite (Foundation, SR Legacy, FNDDS) rather than branded,
 * which is deliberate: those carry portions and micronutrients, and they are the rows that let a
 * whole dish be logged without breaking it into ingredients. ${withPortions} have at least one
 * portion.
 */
export const SEED_FOODS: Omit<Food, 'createdAt' | 'updatedAt' | 'deletedAt' | 'clientRev'>[] =
${JSON.stringify(foods, null, 2)}
`,
)

console.log(
  `Wrote ${foods.length} foods (${generic} generic, ${withPortions} with portions)` +
    (failed > 0 ? `; ${failed} queries failed` : ''),
)
