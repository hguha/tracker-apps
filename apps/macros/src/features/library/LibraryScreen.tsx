import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card, Screen, SegmentedTabs, useToast, type SegmentedTab } from '@tracker-engine/ui'
import { Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { grams } from '@/features/shared/format'
import { RecipesScreen } from '@/features/recipes/RecipesScreen'

type Tab = 'recipes' | 'meals' | 'foods'

/**
 * Everything the user has saved, in one place with three tabs.
 *
 * These were three separate rows in Settings — "Recipes", "Saved meals", "Your foods" — which is
 * where the confusion came from: the names don't tell you which is which, and Settings is the last
 * place you'd look for something you cook. They're one idea (things I've saved) with three shapes,
 * so they get one screen, and each tab says what its shape is *for* rather than only listing it.
 *
 * Recipes lead because they're the only one you go looking for deliberately; the other two are
 * mostly byproducts of logging and are visited to prune.
 */
export function LibraryScreen({ initialTab = 'recipes', onBack }: {
  initialTab?: Tab
  onBack: () => void
}) {
  const [tab, setTab] = useState<Tab>(initialTab)

  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])
  const foods = useLiveQuery(() => repo.customFoods(), [], [])

  const tabs: SegmentedTab<Tab>[] = [
    { key: 'recipes', label: 'Recipes', badge: (recipes ?? []).length || undefined },
    { key: 'meals', label: 'Meals', badge: (templates ?? []).length || undefined },
    { key: 'foods', label: 'Foods', badge: (foods ?? []).length || undefined },
  ]

  // Recipes own a whole screen of their own — a list, filters, a sort, a detail view and an editor
  // — so this tab hands over to it rather than reimplementing a thinner version.
  if (tab === 'recipes') {
    return (
      <RecipesScreen
        onBack={onBack}
        header={<SegmentedTabs tabs={tabs} active={tab} onSelect={setTab} />}
      />
    )
  }

  return (
    <Screen title="Your library" onBack={onBack}>
      <SegmentedTabs tabs={tabs} active={tab} onSelect={setTab} />
      {tab === 'meals' ? <MealsTab /> : <FoodsTab />}
    </Screen>
  )
}

function MealsTab() {
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])

  return (
    <>
      <p className="px-1 text-[12.5px] text-ink-muted">
        A meal is <span className="font-semibold">these exact items again</span> — yesterday&rsquo;s
        lunch, at half or double. Save one with the bookmark beside any meal on a day.
      </p>
      <Rows
        rows={(templates ?? []).map((template) => ({
          id: template.id,
          title: template.name,
          subtitle:
            `${template.items.length} item${template.items.length === 1 ? '' : 's'} · ` +
            `${template.nutrients.kcal} kcal · ${grams(template.nutrients.proteinMg)}P ` +
            `${grams(template.nutrients.carbsMg)}C ${grams(template.nutrients.fatMg)}F`,
        }))}
        onDelete={repo.deleteMealTemplate}
        empty="Nothing saved yet."
      />
    </>
  )
}

function FoodsTab() {
  const foods = useLiveQuery(() => repo.customFoods(), [], [])

  return (
    <>
      <p className="px-1 text-[12.5px] text-ink-muted">
        A food is <span className="font-semibold">one thing off a label</span> that the databases
        don&rsquo;t have. Added from the Add food screen when a search or a barcode comes up empty.
      </p>
      <Rows
        rows={(foods ?? []).map((food) => ({
          id: food.id,
          title: food.description,
          subtitle:
            `${food.brand ? `${food.brand} · ` : ''}${food.per100.kcal} kcal / 100g · ` +
            `${grams(food.per100.proteinMg)}P ${grams(food.per100.carbsMg)}C ` +
            `${grams(food.per100.fatMg)}F`,
        }))}
        onDelete={repo.deleteCustomFood}
        empty="Nothing added yet."
        footnote="Deleting a food leaves what you already logged alone — entries keep the nutrients they were logged with."
      />
    </>
  )
}

function Rows({
  rows,
  onDelete,
  empty,
  footnote,
}: {
  rows: { id: string; title: string; subtitle: string }[]
  onDelete: (id: string) => Promise<unknown>
  empty: string
  footnote?: string
}) {
  const toast = useToast()

  if (rows.length === 0) {
    return <Card className="p-4 text-center text-[13.5px] text-ink-muted">{empty}</Card>
  }

  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px]">{row.title}</span>
              <span className="tabular block text-[12px] text-ink-muted">{row.subtitle}</span>
            </span>
            <button
              onClick={() => {
                void onDelete(row.id).then(() => toast.show(`Deleted ${row.title}`))
              }}
              aria-label={`Delete ${row.title}`}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      {footnote !== undefined && (
        <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-muted">{footnote}</p>
      )}
    </Card>
  )
}
