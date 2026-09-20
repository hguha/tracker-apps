import { dayKey } from '@tracker-engine/core'
import * as repo from '@/data/repository'
import { buildDemoPlan, DEMO_DAYS, MEAL_MINUTE, type DemoRecipe } from '@/lib/demoData'
import { runCheckInsForHistory } from '@/data/backfill'
import { ONBOARDING_VERSION, type MealSlot } from '@/domain/types'

/**
 * Loads the demo history into this device.
 *
 * Everything goes through the repository, so demo rows are indistinguishable from real ones —
 * they sync, they're editable, and they exercise exactly the code paths a real user does. A
 * fixture that bypassed the write path would prove nothing.
 */
export async function loadDemoData(): Promise<{ days: number; entries: number }> {
  const plan = buildDemoPlan()

  await repo.saveProfile({
    heightCm: plan.profile.heightCm,
    birthYear: plan.profile.birthYear,
    sex: plan.profile.sex,
    dietNotes: plan.profile.dietNotes,
    onboardedAt: Date.now(),
    // The current version, not a literal: below it the app re-runs setup, so a stale number here
    // dropped anyone who loaded the demo straight back into onboarding.
    onboardingVersion: ONBOARDING_VERSION,
  })

  const existing = await repo.activeProgram()
  if (!existing) await repo.startProgram(plan.program)

  // A water target, so the card and the chart have a line to be measured against rather than a
  // number with nothing to mean.
  await repo.setWaterTarget(2500)

  const recipeIds = await saveRecipes(plan.recipes)

  let entries = 0
  for (const day of plan.days) {
    if (day.weightKg !== null) await repo.recordWeight(day.weightKg, day.day)

    if (day.waterMl > 0) await repo.addWater(day.day, day.waterMl)

    for (const entry of day.entries) {
      const [food] = await repo.searchFoods(entry.foodQuery, 1)
      if (!food) continue
      await repo.logFood({
        food,
        grams: entry.grams,
        meal: entry.meal,
        day: day.day,
        eatenAt: mealTime(day.day, entry.meal),
        // Dinner is the sitting that varies; everything else is at home by definition of when it
        // happens. A row with no venue is unrecorded, which the patterns code refuses to read as
        // "home" — so leaving it blank would have made the commonest value a non-answer.
        venue: entry.meal === 'dinner' ? day.dinnerVenue : 'home',
        source: 'search',
      })
      entries += 1
    }

    // A cooked dinner writes one row per ingredient under a single dish id, through the same path
    // the recipe screen uses.
    if (day.cook) {
      const id = recipeIds.get(day.cook.recipe)
      const recipe = id === undefined ? undefined : await repo.getRecipe(id)
      if (recipe) {
        entries += await repo.logRecipeIngredients(
          recipe,
          day.cook.servings,
          'dinner',
          mealTime(day.day, 'dinner'),
          'home',
        )
      }
    }
  }

  // Run the weekly check-ins the history earns, so Insights and the target aren't empty.
  await runCheckInsForHistory()

  return { days: DEMO_DAYS, entries }
}

/** Local time, so a day's rows sit where they actually happened in the eating window. */
const mealTime = (day: string, meal: MealSlot): number => {
  const minutes = MEAL_MINUTE[meal]
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0')
  const minute = String(minutes % 60).padStart(2, '0')
  return Date.parse(`${day}T${hour}:${minute}:00`)
}

/**
 * The demo's recipes, matched to real food rows by their exact seeded description.
 *
 * An ingredient whose food is missing is kept with `foodId: null` rather than dropped: that is the
 * same shape an unmatched imported line has, so the screens render what a real import would.
 */
async function saveRecipes(recipes: readonly DemoRecipe[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const recipe of recipes) {
    const ingredients = []
    for (const line of recipe.ingredients) {
      const [food] = await repo.searchFoods(line.foodQuery, 1)
      ingredients.push({
        foodId: food?.id ?? null,
        label: food?.description ?? line.foodQuery,
        grams: line.grams,
        amount: line.amount,
      })
    }
    ids.set(
      recipe.name,
      await repo.saveRecipe({
        name: recipe.name,
        servings: recipe.servings,
        cuisine: recipe.cuisine,
        totalMinutes: recipe.totalMinutes,
        steps: recipe.steps,
        ingredients,
      }),
    )
  }
  return ids
}

export const isDemoLoaded = async (): Promise<boolean> =>
  (await repo.entriesForDay(dayKey(Date.now()))).length > 0
