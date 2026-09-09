import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, Screen, SegmentedTabs, useToast, type SegmentedTab } from '@tracker-engine/ui'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { grams } from '@/features/shared/format'
import { CustomFoodPanel } from '@/features/log/CustomFoodPanel'
import { RecipesScreen } from '@/features/recipes/RecipesScreen'
import type { Food, MealTemplate } from '@/domain/types'

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
  const [isAddingFood, setIsAddingFood] = useState(false)

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

  // Adding a food is a whole form, so it takes the screen rather than squeezing into a tab.
  if (isAddingFood) {
    return (
      <Screen title="Add a food" onBack={() => setIsAddingFood(false)}>
        <CustomFoodPanel initialName="" initialBarcode={null} onSaved={() => setIsAddingFood(false)} />
      </Screen>
    )
  }

  return (
    <Screen title="Your library" onBack={onBack}>
      <SegmentedTabs tabs={tabs} active={tab} onSelect={setTab} />
      {tab === 'meals' ? <MealsTab /> : <FoodsTab onAdd={() => setIsAddingFood(true)} />}
    </Screen>
  )
}

function MealsTab() {
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])
  const [open, setOpen] = useState<string | null>(null)

  return (
    <>
      <p className="px-1 text-[12.5px] text-ink-muted">
        A meal is <span className="font-semibold">these exact items again</span> — yesterday&rsquo;s
        lunch, at half or double. There&rsquo;s nothing to create from scratch here: a saved meal
        comes from a real one, so tap the bookmark beside any meal on a day and it lands in this list.
      </p>
      {(templates ?? []).length === 0 ? (
        <Card className="p-4 text-center text-[13.5px] text-ink-muted">Nothing saved yet.</Card>
      ) : (
        (templates ?? []).map((template) => (
          <MealRow
            key={template.id}
            template={template}
            isOpen={open === template.id}
            onToggle={() => setOpen((current) => (current === template.id ? null : template.id))}
          />
        ))
      )}
    </>
  )
}

/**
 * A saved meal, openable to see what's actually in it and to rename it.
 *
 * Both were missing, and the second one especially: the default name is a date, so a list of
 * "Breakfast · 11 Aug" is unusable until you can call one of them "usual breakfast". The contents
 * matter too — nobody remembers what a saved meal holds a fortnight later, which is the same reason
 * logging one shows a preview first.
 */
function MealRow({
  template,
  isOpen,
  onToggle,
}: {
  template: MealTemplate
  isOpen: boolean
  onToggle: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(template.name)
  const foods = useLiveQuery(
    () => repo.foodsByIds(template.items.map((item) => item.foodId).filter(isPresent)),
    [template.id],
    new Map<string, Food>(),
  )

  return (
    <Card className="p-0">
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left active:bg-sunken"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px]">{template.name}</span>
          <span className="tabular block text-[12px] text-ink-muted">
            {template.items.length} item{template.items.length === 1 ? '' : 's'} ·{' '}
            {template.nutrients.kcal} kcal · {grams(template.nutrients.proteinMg)}P{' '}
            {grams(template.nutrients.carbsMg)}C {grams(template.nutrients.fatMg)}F
          </span>
        </span>
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="border-t border-line px-4 py-3">
          <label className="block">
            <span className="text-[11px] text-ink-muted">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                if (name.trim() && name !== template.name) {
                  void repo.renameMealTemplate(template.id, name).then(() => toast.show('Renamed'))
                }
              }}
              className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
            />
          </label>

          <ul className="mt-2.5 divide-y divide-line">
            {template.items.map((item) => (
              <li key={item.id} className="flex items-baseline gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {(item.foodId ? foods?.get(item.foodId)?.description : null) ?? 'Quick add'}
                </span>
                {item.grams > 0 && (
                  <span className="tabular shrink-0 text-[11.5px] text-ink-muted">
                    {Math.round(item.grams)}g
                  </span>
                )}
                <span className="tabular shrink-0 text-[12.5px]">{item.nutrients.kcal}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={() => {
              void repo.deleteMealTemplate(template.id).then(() => toast.show(`Deleted ${template.name}`))
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-[13px] font-semibold active:bg-sunken"
            style={{ color: 'var(--status-critical)' }}
          >
            <Trash2 size={14} />
            Delete this meal
          </button>
        </div>
      )}
    </Card>
  )
}

const isPresent = (value: string | null): value is string => value !== null

function FoodsTab({ onAdd }: { onAdd: () => void }) {
  const foods = useLiveQuery(() => repo.customFoods(), [], [])

  return (
    <>
      <p className="px-1 text-[12.5px] text-ink-muted">
        A food is <span className="font-semibold">one thing off a label</span> that the databases
        don&rsquo;t have.
      </p>
      {/* Addable from here, not only from the moment a search fails — which was the only way in
          and meant you couldn't set one up in advance. */}
      <Button variant="secondary" className="w-full" onClick={onAdd}>
        <Plus size={15} />
        Add a food from its label
      </Button>
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
