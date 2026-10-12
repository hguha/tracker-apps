// The Me tab: a menu of destinations (§5.2 /me), grouped as things you do, then
// things you set, then things that are dangerous.

import { useLiveQuery } from 'dexie-react-hooks'
import {
  ChevronRight,
  ClipboardList,
  Database,
  Dumbbell,
  HeartPulse,
  Settings,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { plural } from '@tracker-engine/core'
import { NavList, NavRow } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { useAuth } from '@/auth/AuthContext'
import { initialsOf } from '@/auth/types'
import { THEME_PRESETS } from '@/lib/theme'
import { useSync } from '@/sync/useSync'

export function MeScreen({
  onOpenLibrary,
  onOpenTemplates,
  onOpenAccount,
  onOpenCoach,
  onOpenBadges,
  onOpenSettings,
  onOpenBody,
  onOpenData,
}: {
  onOpenLibrary: () => void
  onOpenTemplates: () => void
  onOpenAccount: () => void
  onOpenCoach: () => void
  onOpenBadges: () => void
  onOpenSettings: () => void
  onOpenBody: () => void
  onOpenData: () => void
}) {
  const { session } = useAuth()
  const sync = useSync()
  const counts = useLiveQuery(async () => {
    const [exercises, templates, profile] = await Promise.all([
      repo.listExercises(),
      repo.listTemplates(),
      repo.getProfile(),
    ])
    return { exercises: exercises.length, templates: templates.length, profile }
  }, [])
  const theme = THEME_PRESETS.find((preset) => preset.id === counts?.profile.theme)?.label

  return (
    <div className="space-y-3 px-3 py-3">
      <Card className="overflow-hidden">
        <button
          onClick={onOpenAccount}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-accent-wash"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-[14px] font-bold text-accent-contrast">
            {initialsOf(session?.displayName ?? '')}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">
              {session?.displayName ?? 'Account'}
            </span>
            <span className="block truncate text-[12.5px] text-ink-muted">
              {session?.isVerified ? session.email : 'This device only'}
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-muted" />
        </button>
      </Card>

      <NavList>
        <NavRow
          icon={<Dumbbell size={18} />}
          label="Exercise library"
          hint={counts ? plural(counts.exercises, 'exercise') : 'Browse and edit exercises'}
          onClick={onOpenLibrary}
        />
        <NavRow
          icon={<ClipboardList size={18} />}
          label="Templates"
          hint={
            counts && counts.templates > 0
              ? plural(counts.templates, 'template')
              : 'Build reusable workout plans'
          }
          onClick={onOpenTemplates}
        />
        <NavRow
          icon={<Sparkles size={18} />}
          label="Coach"
          hint="Critique your balance and draft a plan"
          onClick={onOpenCoach}
        />
        <NavRow
          icon={<Trophy size={18} />}
          label="Badges"
          hint="Milestones you have earned and are close to"
          onClick={onOpenBadges}
        />
      </NavList>

      <NavList>
        <NavRow
          icon={<Settings size={18} />}
          label="Settings"
          hint={
            counts
              ? [counts.profile.unitWeight, counts.profile.unitDistance, theme]
                  .filter(Boolean)
                  .join(' · ')
              : 'Units, logging, coaching, and appearance'
          }
          onClick={onOpenSettings}
        />
        <NavRow
          icon={<HeartPulse size={18} />}
          label="Body"
          hint="Weight and body measurements"
          onClick={onOpenBody}
        />
        <NavRow
          icon={<Database size={18} />}
          label="Data & sync"
          hint={
            !sync.enabled
              ? 'Backup, restore, and reset'
              : sync.deadLettered > 0
                ? `${plural(sync.deadLettered, 'change')} failed to sync`
                : sync.pending > 0
                  ? `${plural(sync.pending, 'change')} waiting to upload`
                  : 'Backup, restore, and reset'
          }
          tone={sync.deadLettered > 0 ? 'warning' : undefined}
          onClick={onOpenData}
        />
      </NavList>
    </div>
  )
}
