import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, Screen, SegmentedTabs, useToast } from '@tracker-engine/ui'
import { ClipboardList, Link as LinkIcon, Sparkles, Wand2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { nutrientsFor, recipeNutrients, scale } from '@/lib/nutrition'
import { CUISINE_LABELS } from '@/lib/cuisine'
import { grams } from '@/features/shared/format'
import { FoodSearchPicker } from '@/features/shared/FoodSearchPicker'
import { GramsRow } from '@/features/shared/GramsRow'
import { estimateIngredients, estimateMeal } from '@/features/log/estimate'
import { resolveAmount } from '@/lib/resolveAmount'
import type { ParsedIngredient } from '@/lib/parseIngredient'
import { resolveLines } from '@/data/ingredientLines'
import { importRecipeFromUrl, type ImportedRecipe } from '@/data/recipeImport'
import { CUISINES, type CuisineKey, type Food } from '@/domain/types'

interface Draft {
  foodId: string | null
  label: string
  grams: number
  /**
   * The line this row was read from, kept for the session.
   *
   * Because "2 cups" cannot be weighed without knowing what's in the cup: a cup of flour is 120 g
   * and a cup of oil is 218 g. So an unmatched line has a perfectly good amount and no grams — and
   * the moment the user picks a food, that amount becomes weighable against *its* portions. Without
   * this the pick set the name and left the row at 0 g, which is the same wrong total with a
   * right-looking name on it.
   */
  parsed?: ParsedIngredient
}

/**
 * Lines read from somewhere but not yet turned into weights.
 *
 * They exist as their own state, rather than being converted in the same breath they're read,
 * because converting nineteen ingredient lines takes most of a minute and can fail on its own. Held
 * here, a failed conversion costs a retry instead of the whole import.
 */
interface Pending {
  lines: string[]
  from: string
}

type StartMode = 'link' | 'paste' | 'describe'

const START_TABS = [
  { key: 'link' as const, label: 'From a link' },
  { key: 'paste' as const, label: 'Paste it' },
  { key: 'describe' as const, label: 'Describe it' },
]

/**
 * Building or editing a recipe.
 *
 * Three ways in, because entering fifteen ingredients by hand is why nobody uses recipe features:
 * import a link, paste an ingredient list, or describe the dish. All three land in the same place —
 * verbatim lines, then weights, then an editable list — so there's one path to understand and one
 * to fix when a line converts wrongly. Every number comes from a matched food row; nothing
 * nutritional is ever read off a web page.
 */
export function RecipeEditor({
  recipeId,
  onBack,
}: {
  recipeId: string | null
  onBack: () => void
}) {
  const toast = useToast()
  const existing = useLiveQuery(
    () => (recipeId ? repo.getRecipe(recipeId) : Promise.resolve(undefined)),
    [recipeId],
    undefined,
  )

  const [name, setName] = useState('')
  const [servings, setServings] = useState('4')
  const [cuisine, setCuisine] = useState<CuisineKey | ''>('')
  const [items, setItems] = useState<Draft[]>([])
  const [steps, setSteps] = useState('')
  const [totalMinutes, setTotalMinutes] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [source, setSource] = useState<string | null>(null)
  /** What the parse assumed or skipped — shown, because a silent skip is a silent undercount. */
  const [notes, setNotes] = useState('')
  /** Which ingredient row has its food-swap box open. */
  const [editing, setEditing] = useState<number | null>(null)

  const [mode, setMode] = useState<StartMode>('link')
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load once, when the row arrives; later edits are local until saved.
  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setServings(String(existing.servings))
    setCuisine(existing.cuisine ?? '')
    setSteps(existing.steps.join('\n'))
    setTotalMinutes(existing.totalMinutes)
    setTags(existing.tags)
    setSource(existing.sourceUrl)
    setItems(
      existing.ingredients.map((ingredient) => ({
        foodId: ingredient.foodId,
        label: ingredient.label,
        grams: ingredient.grams,
      })),
    )
  }, [existing?.id])

  const foods = useLiveQuery(
    () => repo.foodsByIds(items.map((item) => item.foodId).filter(isPresent)),
    [items],
    new Map<string, Food>(),
  )

  const total = recipeNutrients(
    { ingredients: items.map((item, index) => ({ ...item, id: String(index), optional: false })) },
    foods ?? new Map(),
  )
  const each = scale(total, 1 / Math.max(1, Number(servings) || 1))
  const unmatched = items.filter((item) => item.foodId === null).length

  /** Stage one: read the page. Fast, and everything it found is kept even if stage two fails. */
  async function read() {
    const url = input.trim()
    if (url.length < 8) return
    setIsReading(true)
    setError(null)
    try {
      const imported = await importRecipeFromUrl(url)
      applyImported(imported)
      setPending({ lines: imported.ingredients, from: hostOf(imported.sourceUrl) })
      setInput('')
      // Straight into the conversion, so the common case is still one tap — but from a state
      // where a failure leaves the lines on screen instead of discarding the whole import.
      await convert(imported.ingredients)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that link.')
    } finally {
      setIsReading(false)
    }
  }

  function applyImported(imported: ImportedRecipe) {
    setName((current) => current || imported.name)
    if (imported.servings) setServings(String(imported.servings))
    if (imported.cuisine) setCuisine(imported.cuisine)
    if (imported.steps.length > 0) setSteps(imported.steps.join('\n'))
    setTotalMinutes(imported.totalMinutes)
    setTags(imported.tags)
    setSource(imported.sourceUrl)
  }

  /**
   * Stage two: the amounts each line states, at the amounts it states them.
   *
   * Read locally first (`resolveLines`), because "1/2 pound lean ground beef" is a quantity, a unit
   * and a food — not a language problem. That takes a second, can't be rate limited, and is the same
   * answer every time. The model is asked only for the lines the parser genuinely couldn't weigh,
   * and if it isn't available those lines simply stay visible and uncounted.
   */
  async function convert(lines: readonly string[]) {
    if (lines.length === 0 || isConverting) return
    setIsConverting(true)
    setError(null)
    try {
      const local = await resolveLines(lines)
      const resolved = local.lines.filter((line) => line.grams !== null && line.grams > 0)
      const unreadable = local.lines.filter((line) => line.grams === null && !line.parsed.isToTaste)

      setItems((current) => [
        ...current,
        ...resolved.map((line) => ({
          foodId: line.food?.id ?? null,
          label: line.food?.description ?? line.parsed.name,
          grams: line.grams!,
          parsed: line.parsed,
        })),
      ])
      // Said out loud, because from outside the two paths are indistinguishable and it looked like
      // every import went to the model. Nineteen lines read in a second, or two lines that needed a
      // request, are different facts about how much of this you should double-check.
      setNotes(
        [readingNote(resolved.length, unreadable.length), local.assumptions]
          .filter(Boolean)
          .join('. '),
      )
      setPending(null)

      // Only the leftovers go to the model, so a nineteen-line import spends a request on the two
      // lines that needed one — or none at all.
      if (unreadable.length > 0) {
        try {
          const estimate = await estimateIngredients(unreadable.map((line) => line.parsed.raw))
          setItems((current) => [...current, ...estimate.items.map(toDraft)])
        } catch (cause) {
          // Kept, with the amount the line stated, rather than dropped. A recipe is worth having as
          // a recipe even when a line's macros aren't known — and the stated amount is the thing
          // that makes it one, so throwing it away to leave a bare "red pepper flakes" would lose
          // the only part of the line nobody has to guess at.
          setItems((current) => [
            ...current,
            ...unreadable.map((line) => ({
              foodId: line.food?.id ?? null,
              label: withAmount(line.parsed),
              grams: 0,
              parsed: line.parsed,
            })),
          ])
          setError(
            `${cause instanceof Error ? cause.message : 'Could not weigh every line.'} ` +
              `${unreadable.length} line${unreadable.length === 1 ? '' : 's'} kept at the amount written — pick a food on each and the weight follows.`,
          )
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} The ingredient list is still here — try again.`
          : 'Could not read those lines.',
      )
    } finally {
      setIsConverting(false)
    }
  }

  /** Pasted text: one ingredient per line, converted by the same path as an import. */
  async function fromPaste() {
    const lines = input
      .split('\n')
      .map((line) => line.replace(/^[-*•\s]+/, '').trim())
      .filter((line) => line.length > 1)
    if (lines.length === 0) return
    setPending({ lines, from: 'what you pasted' })
    setInput('')
    await convert(lines)
  }

  /** A described dish, where nobody stated an amount and ordinary portions are the right guess. */
  async function fromDescription() {
    const text = input.trim()
    if (text.length < 3) return
    setIsConverting(true)
    setError(null)
    try {
      const estimate = await estimateMeal(text)
      setItems((current) => [...current, ...estimate.items.map(toDraft)])
      setName((current) => current || text)
      setInput('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not work that out.')
    } finally {
      setIsConverting(false)
    }
  }

  const isBusy = isReading || isConverting
  const canSave = items.length > 0 && name.trim().length > 0

  function save() {
    if (isSaving || !canSave) return
    setIsSaving(true)
    return repo
      .saveRecipe(
        {
          name,
          servings: Number(servings) || 1,
          ingredients: items,
          steps: steps.split('\n').map((step) => step.trim()).filter(Boolean),
          cuisine: cuisine === '' ? null : cuisine,
          totalMinutes,
          tags,
          sourceUrl: source,
        },
        recipeId ?? undefined,
      )
      .then(() => {
        toast.show(recipeId ? 'Recipe updated' : 'Recipe saved')
        onBack()
      })
      .finally(() => setIsSaving(false))
  }

  return (
    <Screen
      title={recipeId ? 'Edit recipe' : 'New recipe'}
      onBack={onBack}
      action={
        <button
          disabled={!canSave || isSaving}
          onClick={() => void save()}
          className="h-9 shrink-0 rounded-lg px-2.5 text-[14px] font-semibold text-accent disabled:opacity-40 active:bg-sunken"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <Card className="space-y-3 p-4">
        <label className="block">
          <span className="text-[11px] text-ink-muted">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sunday chilli"
            className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
          />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="text-[11px] text-ink-muted">Servings</span>
            <input
              type="number"
              inputMode="numeric"
              value={servings}
              onChange={(event) => setServings(event.target.value)}
              className="tabular mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
            />
          </label>
          <label className="block flex-[1.4]">
            <span className="text-[11px] text-ink-muted">Cuisine</span>
            <select
              value={cuisine}
              onChange={(event) => setCuisine(event.target.value as CuisineKey | '')}
              className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
            >
              <option value="">Not set</option>
              {CUISINES.map((key) => (
                <option key={key} value={key}>
                  {CUISINE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {totalMinutes !== null && (
          <p className="text-[12px] text-ink-muted">Takes about {totalMinutes} minutes.</p>
        )}
      </Card>

      <Card className="space-y-2 p-4">
        <SegmentedTabs
          tabs={START_TABS}
          active={mode}
          onSelect={(next) => {
            setMode(next)
            setInput('')
            setError(null)
          }}
        />

        {mode === 'link' ? (
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            inputMode="url"
            placeholder="https://…"
            className="w-full rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
          />
        ) : (
          <textarea
            rows={mode === 'paste' ? 4 : 2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              mode === 'paste'
                ? '500g beef mince\n2 tins chopped tomatoes\n1 onion'
                : 'A big bowl of chilli with rice and sour cream'
            }
            className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
          />
        )}

        <Button
          variant="secondary"
          className="w-full"
          disabled={input.trim().length < 3 || isBusy}
          onClick={() => {
            if (mode === 'link') void read()
            else if (mode === 'paste') void fromPaste()
            else void fromDescription()
          }}
        >
          {mode === 'link' ? <LinkIcon size={15} /> : mode === 'paste' ? <ClipboardList size={15} /> : <Sparkles size={15} />}
          {isReading
            ? 'Reading the page…'
            : isConverting
              ? 'Working out the amounts…'
              : mode === 'link'
                ? 'Read the ingredients'
                : mode === 'paste'
                  ? 'Convert these lines'
                  : 'Break it into ingredients'}
        </Button>

        <p className="text-[12px] text-ink-muted">
          {mode === 'link'
            ? 'Reads the recipe the site publishes for search engines — its name, servings, cuisine and ingredient lines. Nothing nutritional comes from the page: the weights come from the amounts it states, and every macro from the food database.'
            : mode === 'paste'
              ? 'One ingredient per line, at the amounts written. Works for any site, including the ones a link can’t read.'
              : 'For a dish with no written recipe. Ordinary portions are assumed, so check the weights.'}
        </p>

        {error && (
          <p role="alert" className="text-[12.5px]" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </Card>

      {pending && (
        <Card className="space-y-2 p-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            Read from {pending.from}
          </h2>
          <ul className="space-y-0.5">
            {pending.lines.map((line, index) => (
              <li key={index} className="text-[13px] text-ink-secondary">
                {line}
              </li>
            ))}
          </ul>
          <Button
            className="w-full"
            disabled={isConverting}
            onClick={() => void convert(pending.lines)}
          >
            <Wand2 size={15} />
            {isConverting
              ? 'Working out the amounts…'
              : `Convert ${pending.lines.length} amounts to weights`}
          </Button>
          <button
            onClick={() => setPending(null)}
            className="w-full py-1 text-[12.5px] text-ink-muted active:opacity-60"
          >
            Discard these lines
          </button>
        </Card>
      )}

      <Card className="p-0">
        <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            Ingredients
          </h2>
          {unmatched > 0 && (
            <span className="text-[11.5px]" style={{ color: 'var(--status-serious)' }}>
              {unmatched} without macros
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-4 pb-3 text-[13px] text-ink-muted">Nothing added yet.</p>
        ) : (
          <ul className="divide-y divide-line px-4">
            {items.map((item, index) => {
              const setGrams = (grams: number) =>
                setItems(items.map((draft, i) => (i === index ? { ...draft, grams } : draft)))
              // Deliberately not asserted: the food lookup is a live query, so a row added a
              // moment ago is legitimately absent from the map for one render. Asserting it
              // crashed the editor every time an ingredient was added.
              const food = item.foodId === null ? undefined : foods?.get(item.foodId)
              return (
                <GramsRow
                  key={index}
                  after={
                    // Every row, not only the unmatched ones. An import always leaves a few lines
                    // with no row (which count zero, so the total reads low) — but it also matches
                    // some of them to the *wrong* row, and there was no way to correct that but
                    // delete and search again from the bottom of the screen.
                    editing === index || item.foodId === null ? (
                      <FoodSearchPicker
                        placeholder={
                          item.foodId === null
                            ? `Find a match for “${item.label}”`
                            : `Swap “${item.label}” for something else`
                        }
                        branded={false}
                        limit={5}
                        onPick={(food) => {
                          setItems(
                            items.map((draft, i) =>
                              i === index ? matchDraftTo(draft, food) : draft,
                            ),
                          )
                          setEditing(null)
                        }}
                      />
                    ) : undefined
                  }
                  title={food?.description ?? item.label}
                  subtitle={
                    item.foodId === null ? (
                      <span style={{ color: 'var(--status-serious)' }}>
                        stays in the recipe, but no food matched it, so it adds no macros
                      </span>
                    ) : (
                      <span className="tabular text-ink-muted">
                        {food ? `${Math.round(nutrientsFor(food, item.grams).kcal)} kcal` : '…'}
                        {' · '}
                        <button
                          onClick={() => setEditing(editing === index ? null : index)}
                          className="font-semibold text-accent active:opacity-60"
                        >
                          {editing === index ? 'cancel' : 'change food'}
                        </button>
                      </span>
                    )
                  }
                  grams={item.grams}
                  onGrams={setGrams}
                  onRemove={() => setItems(items.filter((_, i) => i !== index))}
                />
              )
            })}
          </ul>
        )}

        <div className="border-t border-line px-4 py-3">
          <FoodSearchPicker
            placeholder="Add an ingredient by hand"
            branded={false}
            onPick={(food) =>
              setItems((current) => [
                ...current,
                { foodId: food.id, label: food.description, grams: 100 },
              ])
            }
          />
          <p className="mt-1 text-[11.5px] text-ink-muted">
            Comes in at 100 g — set the amount on the row. Usually quicker to paste the whole
            ingredient list above and correct what it got wrong.
          </p>
        </div>
      </Card>

      <Card className="space-y-1.5 p-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          Method
        </h2>
        <textarea
          rows={Math.min(12, Math.max(3, steps.split('\n').length))}
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
          placeholder="One step per line. Imported recipes fill this in."
          className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[13.5px] leading-relaxed outline-none"
        />
      </Card>

      <Card className="p-4">
        <p className="tabular text-[13.5px] font-semibold">
          {total.kcal} kcal total · {each.kcal} kcal per serving
        </p>
        <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
          Per serving: {grams(each.proteinMg)}P {grams(each.carbsMg)}C {grams(each.fatMg)}F
        </p>
        {notes && <p className="mt-1.5 text-[12px] text-ink-muted">{notes}</p>}
        {unmatched > 0 && (
          <p className="mt-1.5 text-[12px]" style={{ color: 'var(--status-serious)' }}>
            {unmatched} ingredient{unmatched === 1 ? '' : 's'} matched no food, so{' '}
            {unmatched === 1 ? 'it adds' : 'they add'} nothing to this total. The recipe saves with{' '}
            {unmatched === 1 ? 'it' : 'them'} either way — match a food above to have it counted.
          </p>
        )}
        {source && (
          <p className="mt-2 truncate text-[12px] text-ink-muted">From {hostOf(source)}</p>
        )}

        {/* Also in the header, for a long form — but the end of the form is where you finish, and
            a header-only Save reads as "no way to save this". */}
        <Button className="mt-3 w-full" disabled={!canSave || isSaving} onClick={() => void save()}>
          {isSaving ? 'Saving…' : recipeId ? 'Save changes' : 'Save recipe'}
        </Button>
        {!canSave && (
          <p className="mt-1.5 text-center text-[12px] text-ink-muted">
            {name.trim().length === 0
              ? 'Give it a name first.'
              : 'Add at least one ingredient first.'}
          </p>
        )}
      </Card>
    </Screen>
  )
}

const toDraft = (item: { food: Food | null; query: string; grams: number }): Draft => ({
  foodId: item.food?.id ?? null,
  label: item.food?.description ?? item.query,
  grams: item.grams,
})

/**
 * Points a row at a food, and re-weighs it against that food's own portions.
 *
 * The weight is the whole reason this isn't a one-line setter: "9 lasagna noodles" has a perfectly
 * clear amount that no table can convert, because it depends on the noodle. USDA measured it, so the
 * moment there's a food the number is available — and only ever falls back to what was already on
 * the row, never to a guess.
 */
function matchDraftTo(draft: Draft, food: Food): Draft {
  const weighed = draft.parsed ? resolveAmount(draft.parsed, food).grams : null
  return {
    ...draft,
    foodId: food.id,
    label: food.description,
    grams: weighed ?? (draft.grams > 0 ? draft.grams : 100),
  }
}

/** The food with the amount the line stated, for a row that has no grams to show instead. */
function withAmount(parsed: ParsedIngredient): string {
  if (parsed.quantity === null) return parsed.name
  const rounded = Math.round(parsed.quantity * 100) / 100
  return `${parsed.name} (${rounded}${parsed.unit && parsed.unit !== 'piece' ? ` ${parsed.unit}` : ''})`
}

/** How much of the list was read without a model, in a sentence rather than a spinner. */
function readingNote(readLocally: number, neededModel: number): string {
  if (readLocally === 0) return ''
  if (neededModel === 0) return `Read all ${readLocally} lines directly — no AI involved`
  return `Read ${readLocally} of ${readLocally + neededModel} lines directly; ${neededModel} needed the AI`
}

const isPresent = (value: string | null): value is string => value !== null

/** The site's name, which is what a person recognises — not the whole tracking-laden URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
