// The Me tab: a menu of destinations (§5.2 /me), grouped as things you do, then
// things you set, then things that are dangerous.

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
import { Card } from '@/components/Card'
import { useAuth } from '@/auth/AuthContext'
import { initialsOf } from '@/auth/types'
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

      <Card className="overflow-hidden">
        <Row
          icon={<Dumbbell size={19} />}
          label="Exercise library"
          hint="Browse, search, and edit every exercise"
          onClick={onOpenLibrary}
          isFirst
        />
        <Row
          icon={<ClipboardList size={19} />}
          label="Templates"
          hint="Build and edit reusable workout plans"
          onClick={onOpenTemplates}
        />
        <Row
          icon={<Sparkles size={19} />}
          label="Coach"
          hint="Critique your balance and draft a plan from your history"
          onClick={onOpenCoach}
        />
        <Row
          icon={<Trophy size={19} />}
          label="Badges"
          hint="Milestones across strength, consistency, and cardio"
          onClick={onOpenBadges}
        />
      </Card>

      <Card className="overflow-hidden">
        <Row
          icon={<Settings size={19} />}
          label="Settings"
          hint="Units, logging, coaching, and appearance"
          onClick={onOpenSettings}
          isFirst
        />
        <Row
          icon={<HeartPulse size={19} />}
          label="Body"
          hint="Weight, body fat, waist, resting heart rate"
          onClick={onOpenBody}
        />
        <Row
          icon={<Database size={19} />}
          label="Data & sync"
          hint={
            sync.deadLettered > 0
              ? `${sync.deadLettered} change${sync.deadLettered === 1 ? '' : 's'} failed to sync`
              : sync.pending > 0
                ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to upload`
                : 'Backup, restore, and reset'
          }
          isWarning={sync.deadLettered > 0}
          onClick={onOpenData}
        />
      </Card>
    </div>
  )
}

function Row({
  icon,
  label,
  hint,
  onClick,
  isFirst = false,
  isWarning = false,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  isFirst?: boolean
  isWarning?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-accent-wash',
        isFirst ? '' : 'border-t border-line',
      ].join(' ')}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{label}</span>
        <span
          className="block text-[12.5px] text-ink-muted"
          style={isWarning ? { color: 'var(--status-serious)' } : undefined}
        >
          {hint}
        </span>
      </span>
      <ChevronRight size={17} className="shrink-0 text-ink-muted" />
    </button>
  )
}
