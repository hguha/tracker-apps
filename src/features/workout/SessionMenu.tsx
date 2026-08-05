/**
 * The session menu (§6.4) — rename, change date and time, save as template,
 * discard.
 *
 * Changing the date is why there is no separate "log a past workout" entry
 * point: a backdated session is just a normal session with a different date, so
 * one control covers both instead of two flows that do the same thing.
 */

import { useState } from 'react'
import { CalendarClock, FileText, Pencil, Trash2, X } from 'lucide-react'
import * as repo from '@/data/repository'
import { Button } from '@/components/Button'
import { cn } from '@/lib/cn'
import { fromDateTimeInputValue, toDateTimeInputValue } from '@/lib/dates'
import type { Workout } from '@/domain/types'

type Panel = 'menu' | 'rename' | 'datetime' | 'template'

export function SessionMenu({
  workout,
  /** Absent when the session already came from a template. */
  canSaveAsTemplate,
  onDiscard,
  onDismiss,
  onSaved,
}: {
  workout: Workout
  canSaveAsTemplate: boolean
  onDiscard: () => void
  onDismiss: () => void
  onSaved: (message: string) => void
}) {
  const [panel, setPanel] = useState<Panel>('menu')
  const [title, setTitle] = useState(workout.title)
  const [startedAt, setStartedAt] = useState(() =>
    toDateTimeInputValue(workout.startedAt),
  )
  const [templateName, setTemplateName] = useState(workout.title)
  const [isBusy, setIsBusy] = useState(false)

  async function saveTitle() {
    setIsBusy(true)
    try {
      await repo.updateWorkout(workout.id, { title: title.trim() })
      onSaved(title.trim() ? 'Renamed' : 'Title cleared')
      onDismiss()
    } finally {
      setIsBusy(false)
    }
  }

  async function saveDateTime() {
    setIsBusy(true)
    try {
      await repo.updateWorkout(workout.id, {
        startedAt: fromDateTimeInputValue(startedAt),
      })
      onSaved('Date updated')
      onDismiss()
    } finally {
      setIsBusy(false)
    }
  }

  async function saveTemplate() {
    if (!templateName.trim()) return
    setIsBusy(true)
    try {
      await repo.saveWorkoutAsTemplate(workout.id, templateName.trim())
      onSaved(`Saved "${templateName.trim()}" as a template`)
      onDismiss()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
      <div className="rounded-t-3xl bg-surface pb-safe">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-bold tracking-tight">
            {panel === 'menu'
              ? 'Workout options'
              : panel === 'rename'
                ? 'Rename workout'
                : panel === 'datetime'
                  ? 'Date and time'
                  : 'Save as template'}
          </h2>
          <button
            onClick={panel === 'menu' ? onDismiss : () => setPanel('menu')}
            aria-label={panel === 'menu' ? 'Close' : 'Back'}
            className="flex size-9 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
          >
            <X size={19} />
          </button>
        </div>

        {panel === 'menu' && (
          <div className="p-3">
            <MenuRow
              icon={<Pencil size={18} />}
              label="Rename"
              hint={workout.title || 'Currently auto-titled'}
              onClick={() => setPanel('rename')}
            />
            <MenuRow
              icon={<CalendarClock size={18} />}
              label="Change date and time"
              hint="For a workout you did earlier"
              onClick={() => setPanel('datetime')}
            />
            {canSaveAsTemplate && (
              <MenuRow
                icon={<FileText size={18} />}
                label="Save as template"
                hint="Reuse this structure later"
                onClick={() => setPanel('template')}
              />
            )}
            <MenuRow
              icon={<Trash2 size={18} />}
              label="Discard workout"
              hint="Deletes everything logged here"
              destructive
              onClick={onDiscard}
            />
          </div>
        )}

        {panel === 'rename' && (
          <Panel
            onCancel={() => setPanel('menu')}
            onConfirm={() => void saveTitle()}
            confirmLabel="Save"
            isBusy={isBusy}
          >
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Leave blank for an automatic title"
              className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
            />
            <p className="mt-2 text-[12.5px] text-ink-muted">
              Blank titles become the date, time of day, and body parts worked.
            </p>
          </Panel>
        )}

        {panel === 'datetime' && (
          <Panel
            onCancel={() => setPanel('menu')}
            onConfirm={() => void saveDateTime()}
            confirmLabel="Save"
            isBusy={isBusy}
          >
            <input
              type="datetime-local"
              value={startedAt}
              onChange={(event) => setStartedAt(event.target.value)}
              className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
            />
            <p className="mt-2 text-[12.5px] text-ink-muted">
              Moving a workout re-sorts your history and recalculates the charts
              for both dates.
            </p>
          </Panel>
        )}

        {panel === 'template' && (
          <Panel
            onCancel={() => setPanel('menu')}
            onConfirm={() => void saveTemplate()}
            confirmLabel="Save template"
            isBusy={isBusy || !templateName.trim()}
          >
            <input
              autoFocus
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="e.g. Pull A"
              className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] outline-none focus:border-accent"
            />
            <p className="mt-2 text-[12.5px] text-ink-muted">
              Saves the exercises and set counts. Weights come from your history
              each time you run it.
            </p>
          </Panel>
        )}
      </div>
    </div>
  )
}

function MenuRow({
  icon,
  label,
  hint,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-sunken"
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          destructive ? 'bg-critical/10 text-critical' : 'bg-sunken text-ink-secondary',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-[15px] font-semibold',
            destructive && 'text-critical',
          )}
        >
          {label}
        </span>
        <span className="block truncate text-[12.5px] text-ink-muted">{hint}</span>
      </span>
    </button>
  )
}

function Panel({
  children,
  onCancel,
  onConfirm,
  confirmLabel,
  isBusy,
}: {
  children: React.ReactNode
  onCancel: () => void
  onConfirm: () => void
  confirmLabel: string
  isBusy: boolean
}) {
  return (
    <div className="p-5">
      {children}
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="lg" className="flex-1" disabled={isBusy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
