// First-run seeding of the client-authored defaults: the category taxonomy and the
// profile row. Both push like any other user data, so a second device inherits them
// through sync rather than re-seeding. Idempotent — a no-op once seeded.

import { db } from '@/db'
import { syncStamp } from '@tracker-engine/local-first'
import { DEFAULT_CATEGORIES, defaultCategoryId } from '@/domain/categories'
import type { Category, Profile } from '@/domain/types'
import { enqueue } from './outbox'

export async function seedIfNeeded(): Promise<void> {
  if ((await db.categories.count()) === 0) {
    const categories: Category[] = DEFAULT_CATEGORIES.map((c) => ({
      id: defaultCategoryId(c.key),
      name: c.name,
      icon: c.icon,
      color: c.color,
      isIncome: c.isIncome,
      archived: false,
      ...syncStamp(),
    }))
    await db.categories.bulkPut(categories)
    for (const c of categories) await enqueue('categories', c.id)
  }

  if ((await db.profile.get('me')) === undefined) {
    const profile: Profile = {
      id: 'me',
      displayName: 'You',
      currency: 'USD',
      theme: 'default',
      colorScheme: 'system',
      onboardedAt: null,
      ...syncStamp(),
    }
    // Device-local: the profile isn't synced (see ledgerSchema), so no enqueue.
    await db.profile.put(profile)
  }
}
