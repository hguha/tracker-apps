import { plural } from '@tracker-engine/core'
import { useState } from 'react'
import { Button } from '@tracker-engine/ui'
import { ClipboardList, Link as LinkIcon, Sparkles } from 'lucide-react'
import { estimateIngredients } from '@/features/log/estimate'
import { statedAmount } from '@/lib/parseIngredient'
import { resolveLines, type ResolvedLine } from '@/data/ingredientLines'
import { importRecipeFromUrl, type ImportedRecipe } from '@/data/recipeImport'
import { rowFromFood, rowKey, type Row } from './rows'

type Mode = 'link' | 'paste'

export function ImportLines({
  onImported,
  setRows,
  onNotes,
}: {
  onImported: (imported: ImportedRecipe) => void
  setRows: React.Dispatch<React.SetStateAction<Row[]>>
  onNotes: (notes: string) => void
}) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [input, setInput] = useState('')
  const [needsWeight, setNeedsWeight] = useState<ResolvedLine[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isBusy = progress !== null

  async function convert(lines: readonly string[]) {
    setProgress(`Matching foods — 0 of ${lines.length}`)
    const local = await resolveLines(lines, (done, total) =>
      setProgress(`Matching foods — ${done} of ${total}`),
    )
    const unweighed = local.lines.filter((line) => line.grams === null)
    setRows((current) => [
      ...current,
      ...local.lines.map((line) => ({
        key: rowKey(),
        foodId: line.food?.id ?? null,
        label: line.food?.description ?? line.parsed.name,
        query: line.parsed.name,
        grams: line.grams ?? 0,
        parsed: line.parsed,
        amount: statedAmount(line.parsed),
        needsWeight: line.grams === null && !line.parsed.isToTaste,
      })),
    ])
    onNotes(local.assumptions)
    setNeedsWeight(unweighed.filter((line) => !line.parsed.isToTaste))
  }

  async function run() {
    const text = input.trim()
    if (text.length < 3 || isBusy) return
    setError(null)
    try {
      if (mode === 'link') {
        setProgress('Reading the page…')
        const imported = await importRecipeFromUrl(text)
        onImported(imported)
        await convert(imported.ingredients)
      } else {
        await convert(
          text
            .split('\n')
            .map((line) => line.replace(/^[-*•\s]+/, '').trim())
            .filter((line) => line.length > 1),
        )
      }
      setInput('')
      setMode(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that.')
    } finally {
      setProgress(null)
    }
  }

  async function weighWithModel() {
    if (needsWeight.length === 0 || isBusy) return
    setError(null)
    setProgress('Asking the AI…')
    try {
      const estimate = await estimateIngredients(needsWeight.map((line) => line.parsed.raw))
      if (estimate.items.length === 0) {
        setError('The AI couldn’t weigh those. Pick a food on each and the weight follows.')
        return
      }
      setRows((current) => [
        ...current.filter((row) => !row.needsWeight),
        ...estimate.items.map((item) => rowFromFood(item.food, item.query, item.grams)),
      ])
      setNeedsWeight([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not weigh those lines.')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <ModeButton
          isActive={mode === 'paste'}
          icon={<ClipboardList size={14} />}
          label="Paste a list"
          onClick={() => setMode(mode === 'paste' ? null : 'paste')}
        />
        <ModeButton
          isActive={mode === 'link'}
          icon={<LinkIcon size={14} />}
          label="From a link"
          onClick={() => setMode(mode === 'link' ? null : 'link')}
        />
      </div>

      {mode !== null && (
        <>
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
              rows={4}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={'500g beef mince\n2 tins chopped tomatoes\n1 onion'}
              className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
            />
          )}
          <Button
            variant="secondary"
            className="w-full"
            disabled={input.trim().length < 3 || isBusy}
            onClick={() => void run()}
          >
            {progress ?? (mode === 'link' ? 'Read the ingredients' : 'Add these lines')}
          </Button>
        </>
      )}

      {needsWeight.length > 0 && (
        <div className="space-y-1.5 rounded-xl bg-sunken/60 p-2.5">
          <p className="text-[12.5px] text-ink-secondary">
            {plural(needsWeight.length, 'line')} with no weight
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="min-w-0 flex-1"
              disabled={isBusy}
              onClick={() => void weighWithModel()}
            >
              <Sparkles size={15} />
              {progress ?? 'Ask the AI'}
            </Button>
            <button
              onClick={() => setNeedsWeight([])}
              className="shrink-0 px-2 text-[12.5px] text-ink-muted active:opacity-60"
            >
              Leave uncounted
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[12.5px]" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

function ModeButton({
  isActive,
  icon,
  label,
  onClick,
}: {
  isActive: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={isActive}
      className={
        isActive
          ? 'flex items-center gap-1.5 rounded-lg bg-accent-wash px-2.5 py-1.5 text-[12.5px] font-semibold text-accent'
          : 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-ink-secondary active:bg-sunken'
      }
    >
      {icon}
      {label}
    </button>
  )
}
