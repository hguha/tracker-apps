// DragList/DragItem re-exported from @tracker-engine/ui, wrapped so REPutation's
// callers keep the workout-flavored prop names (onSuperset, supersetLabel) while the
// shared component stays neutral (onGroup, groupHint).
import type { ReactNode } from 'react'
import { DragItem as CoreDragItem, DragList as CoreDragList } from '@tracker-engine/ui'

export { useDragList } from '@tracker-engine/ui'
export type { DropIntent } from '@tracker-engine/ui'

export function DragList({
  itemIds,
  onReorder,
  onSuperset,
  children,
}: {
  itemIds: string[]
  onReorder: (orderedIds: string[]) => void
  onSuperset?: (draggedId: string, targetId: string) => void
  children: ReactNode
}) {
  return (
    <CoreDragList itemIds={itemIds} onReorder={onReorder} onGroup={onSuperset}>
      {children}
    </CoreDragList>
  )
}

export function DragItem({
  id,
  index,
  supersetLabel,
  children,
}: {
  id: string
  index: number
  supersetLabel?: string
  children: ReactNode
}) {
  return (
    <CoreDragItem
      id={id}
      index={index}
      groupHint={supersetLabel ? `Superset with ${supersetLabel}` : undefined}
    >
      {children}
    </CoreDragItem>
  )
}
