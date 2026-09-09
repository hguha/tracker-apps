import { Card, Screen, useToast } from '@tracker-engine/ui'
import { Trash2 } from 'lucide-react'

export interface ManagedItem {
  id: string
  title: string
  subtitle: string
}

/**
 * A list of things the user has saved, reviewable and removable.
 *
 * Saved meals and own foods were the same screen written twice — same header, same empty card, same
 * row with a trash button, same toast. Recipes need more than this (they have a detail view, a
 * filter and a sort), so they keep their own screen; these two do not, and having one of them
 * silently drift from the other is how a pair of sibling screens ends up feeling like two apps.
 */
export function ManagedList({
  title,
  items,
  empty,
  footnote,
  onDelete,
  onBack,
}: {
  title: string
  items: readonly ManagedItem[]
  /** Shown instead of the list, and worth writing properly: it's where most users first arrive. */
  empty: React.ReactNode
  /** A standing caveat under the list, e.g. that deleting doesn't rewrite history. */
  footnote?: React.ReactNode
  onDelete: (id: string) => Promise<unknown>
  onBack: () => void
}) {
  const toast = useToast()

  return (
    <Screen title={title} onBack={onBack}>
      {items.length === 0 ? (
        <Card className="p-4 text-[13.5px] text-ink-muted">{empty}</Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{item.title}</span>
                  <span className="tabular block text-[12px] text-ink-muted">{item.subtitle}</span>
                </span>
                <button
                  onClick={() => {
                    void onDelete(item.id).then(() => toast.show(`Deleted ${item.title}`))
                  }}
                  aria-label={`Delete ${item.title}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          {footnote !== undefined && (
            <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-muted">
              {footnote}
            </p>
          )}
        </Card>
      )}
    </Screen>
  )
}
