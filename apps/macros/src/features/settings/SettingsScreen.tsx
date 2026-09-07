import { useLiveQuery } from 'dexie-react-hooks'
import { Card, NavList, NavRow } from '@tracker-engine/ui'
import {
  Award,
  Database,
  Palette,
  Ruler,
  Sparkles,
  Target,
  User,
  Utensils,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useSync } from '@/sync/useSync'
import * as repo from '@/data/repository'
import { formatClock } from '@/lib/mealTiming'

export type SettingsRoute =
  | 'targets'
  | 'about'
  | 'preferences'
  | 'appearance'
  | 'badges'
  | 'account'
  | 'data'
  | 'coach'

/**
 * Settings as a list of destinations, matching REPutation.
 *
 * Everything used to be stacked on one scroll, which made the page long enough that the things
 * people change most — the goal and the pace — were below the fold under an accent-colour picker.
 */
export function SettingsScreen({
  onOpen,
  onConnect,
}: {
  onOpen: (route: SettingsRoute) => void
  onConnect: () => void
}) {
  const { session } = useAuth()
  const sync = useSync()
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)

  const missing = profile
    ? [
        profile.heightCm === null && 'height',
        profile.birthYear === null && 'age',
        profile.sex === null && 'sex',
      ].filter((value): value is string => typeof value === 'string')
    : []

  return (
    <div className="space-y-3 px-3 py-3">
      <h1 className="px-1 text-[17px] font-semibold tracking-tight">Settings</h1>

      <NavList>
        <NavRow
          icon={<Target size={17} />}
          label="Targets & goal"
          hint={program ? goalHint(program.goal, program.ratePctPerWeek) : 'No goal set'}
          onClick={() => onOpen('targets')}
        />
        <NavRow
          icon={<Ruler size={17} />}
          label="About you"
          hint={missing.length > 0 ? `Missing your ${missing.join(', ')}` : 'Height, age, sex'}
          tone={missing.length > 0 ? 'warning' : undefined}
          onClick={() => onOpen('about')}
        />
        <NavRow
          icon={<Utensils size={17} />}
          label="Food & units"
          hint={preferencesHint(profile)}
          onClick={() => onOpen('preferences')}
        />
        <NavRow
          icon={<Palette size={17} />}
          label="Appearance"
          hint={profile ? `${schemeLabel(profile.colorScheme)} · ${profile.theme}` : ''}
          onClick={() => onOpen('appearance')}
        />
      </NavList>

      <NavList>
        <NavRow
          icon={<Sparkles size={17} />}
          label="Coach"
          hint="Ask about your numbers"
          onClick={() => onOpen('coach')}
        />
        <NavRow
          icon={<Award size={17} />}
          label="Badges"
          hint="What you've earned"
          onClick={() => onOpen('badges')}
        />
        <NavRow
          icon={<User size={17} />}
          label="Account"
          hint={session?.email ?? 'This device only'}
          onClick={() => onOpen('account')}
        />
        <NavRow
          icon={<Database size={17} />}
          label="Data & sync"
          hint={sync.enabled ? 'Syncing to your account' : 'This device only'}
          tone={sync.deadLettered > 0 ? 'warning' : undefined}
          onClick={() => onOpen('data')}
        />
      </NavList>

      {!sync.enabled && (
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Sync across devices</h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Everything you have logged here moves onto the account — nothing is replaced.
          </p>
          <button
            onClick={onConnect}
            className="mt-2 w-full rounded-xl bg-sunken py-2.5 text-[14px] font-semibold text-accent active:opacity-60"
          >
            Connect an account
          </button>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Connect REPutation</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Not built yet. It will read training days and bodyweight to sharpen your targets — and
          deliberately won&rsquo;t add &ldquo;calories burned&rdquo; to your budget, because a
          measured expenditure already includes training.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Getting started</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Nothing you&rsquo;ve logged is affected.
        </p>
        <button
          onClick={() => void repo.saveProfile({ onboardingVersion: 0 })}
          className="mt-2 w-full rounded-xl border border-line py-2.5 text-[14px] font-semibold text-accent active:bg-accent-wash"
        >
          Replay setup
        </button>
      </Card>
    </div>
  )
}

function goalHint(goal: string, ratePctPerWeek: number): string {
  const verb = goal === 'lose' ? 'Losing' : goal === 'gain' ? 'Building' : 'Maintaining'
  return ratePctPerWeek === 0 ? verb : `${verb} · ${ratePctPerWeek}%/week`
}

function preferencesHint(
  profile: { units: string; eatingWindow: { startMinute: number; endMinute: number } | null } | undefined,
): string {
  if (!profile) return ''
  const units = profile.units === 'metric' ? 'kg / cm' : 'lb / in'
  if (!profile.eatingWindow) return units
  return `${units} · ${formatClock(profile.eatingWindow.startMinute)}–${formatClock(profile.eatingWindow.endMinute)}`
}

const schemeLabel = (scheme: string): string =>
  scheme === 'system' ? 'Auto' : scheme === 'light' ? 'Light' : 'Dark'
