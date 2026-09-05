import { syncStamp } from '@tracker-engine/local-first'
import { db } from '@/db'
import { SEED_FOODS } from './foods'

/**
 * Puts the starter foods in place, once. `bulkPut` rather than a count check, so editing the
 * seed list ships corrections to existing installs instead of only reaching new ones.
 */
export async function seedFoods(): Promise<number> {
  const stamp = syncStamp()
  await db.foods.bulkPut(SEED_FOODS.map((food) => ({ ...food, ...stamp })))
  return SEED_FOODS.length
}
