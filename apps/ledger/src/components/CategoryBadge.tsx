import type { Category } from '@/domain/types'
import { UNCATEGORIZED_COLOR } from '@/domain/categories'
import { cn } from '@/lib/cn'

// A category's colored dot + label. `category` is undefined for an uncategorized
// entry, which falls back to the neutral token. Color is a CSS value the category
// carries (a --cat-* token for defaults, a hex for custom), so it stays theme-aware.
export function CategoryBadge({
  category,
  className,
  showLabel = true,
}: {
  category: Category | undefined
  className?: string
  showLabel?: boolean
}) {
  const color = category?.color ?? UNCATEGORIZED_COLOR
  const label = category ? `${category.icon} ${category.name}` : 'Uncategorized'
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {showLabel && <span className="truncate">{label}</span>}
    </span>
  )
}
