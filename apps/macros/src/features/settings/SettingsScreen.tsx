import { useLiveQuery } from 'dexie-react-hooks'
import { Card, NavList, NavRow } from '@tracker-engine/ui'
import {
  Award,
  ChefHat,
  ChevronRight,
  Database,
  Palette,
  Ruler,
  Sparkles,
  Target,
  Utensils,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useSync } from '@/sync/useSync'
import * as repo from '@/data/repository'
import { formatClock } from '@/lib/mealTiming'
import type { Profile, Program } from '@/domain/types'

export type SettingsRoute =
  | 'targets'
  | 'checkin'
  | 'about'
  | 'preferences'
  | 'appearance'
  | 'badges'
  | 'library'
  | 'meals'
  | 'foods'
  | 'account'
  | 'data'
  | 'coach'

/**
 * Settings as a list of destinations, in REPutation's order: who you are, then things you do,
 * then things you set, then data. The order isn't cosmetic — two apps in the same family that
 * bury the account in different places make the pair feel unrelated.
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
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])
  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const myFoods = useLiveQuery(() => repo.customFoods(), [], [])
  const lastCheckIn = useLiveQuery(() => repo.latestCheckIn(), [], undefined)

  const missing = missingFacts(profile)

  return (
    <div className="space-y-3 px-3 py-3">
      <Card className="overflow-hidden">
        <button
          onClick={() => onOpen('account')}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-accent-wash"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-[14px] font-bold text-accent-contrast">
            {initials(session?.displayName ?? profile?.displayName ?? '')}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">
              {session?.displayName ?? 'Account'}
            </span>
            <span className="block truncate text-[12.5px] text-ink-muted">
              {session && !session.isLocal ? session.email : 'This device only'}
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-muted" />
        </button>
      </Card>

      <NavList>
        <NavRow
          icon={<Sparkles size={17} />}
          label="Coach"
          hint="Ask about your own numbers"
          onClick={() => onOpen('coach')}
        />
        {/* One row, not three. "Recipes", "Saved meals" and "Your foods" side by side told nobody
            which was which — they're one idea with three shapes, so they share a screen that says
            what each shape is for. */}
        <NavRow
          icon={<ChefHat size={17} />}
          label="Your library"
          hint={libraryHint(recipes?.length ?? 0, templates?.length ?? 0, myFoods?.length ?? 0)}
          onClick={() => onOpen('library')}
        />
        <NavRow
          icon={<Award size={17} />}
          label="Badges"
          hint="What you've earned so far"
          onClick={() => onOpen('badges')}
        />
      </NavList>

      <NavList>
        <NavRow
          icon={<Target size={17} />}
          label="Targets & goal"
          hint={goalHint(program)}
          onClick={() => onOpen('targets')}
        />
        <NavRow
          icon={<Ruler size={17} />}
          label="Weekly check-in"
          hint={
            lastCheckIn
              ? `Last run for the week of ${lastCheckIn.weekStart}`
              : 'Not enough data for one yet'
          }
          onClick={() => onOpen('checkin')}
        />
        <NavRow
          icon={<Ruler size={17} />}
          label="About you"
          hint={
            missing.length > 0
              ? `Missing your ${missing.join(', ')} — no target without them`
              : 'Height, age, sex'
          }
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
          icon={<Database size={17} />}
          label="Data & sync"
          hint={dataHint(sync)}
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

/** The facts the cold-start target needs. Surfaced here as well as on Today, since this is
 *  where someone goes looking when the bars won't fill. */
export function missingFacts(profile: Profile | undefined): string[] {
  if (!profile) return []
  return [
    profile.heightCm === null && 'height',
    profile.birthYear === null && 'age',
    profile.sex === null && 'sex',
  ].filter((value): value is string => typeof value === 'string')
}

/** Counts, so the row says what's in there rather than only what it's called. */
function libraryHint(recipes: number, meals: number, foods: number): string {
  const parts = [
    recipes > 0 && `${recipes} recipe${recipes === 1 ? '' : 's'}`,
    meals > 0 && `${meals} meal${meals === 1 ? '' : 's'}`,
    foods > 0 && `${foods} own food${foods === 1 ? '' : 's'}`,
  ].filter((part): part is string => typeof part === 'string')
  return parts.length === 0 ? 'Recipes, saved meals and your own foods' : parts.join(' · ')
}

function goalHint(program: Program | undefined): string {
  if (!program) return 'No goal set'
  const verb =
    program.goal === 'lose' ? 'Losing' : program.goal === 'gain' ? 'Building' : 'Maintaining'
  return program.ratePctPerWeek === 0 ? verb : `${verb} · ${program.ratePctPerWeek}%/week`
}

function preferencesHint(profile: Profile | undefined): string {
  if (!profile) return ''
  const units = profile.units === 'metric' ? 'kg / cm' : 'lb / in'
  if (!profile.eatingWindow) return units
  return `${units} · ${formatClock(profile.eatingWindow.startMinute)}–${formatClock(profile.eatingWindow.endMinute)}`
}

function dataHint(sync: { deadLettered: number; pending: number; enabled: boolean }): string {
  if (sync.deadLettered > 0) {
    return `${sync.deadLettered} change${sync.deadLettered === 1 ? '' : 's'} failed to sync`
  }
  if (sync.pending > 0) {
    return `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to upload`
  }
  return sync.enabled ? 'Backup, restore, and reset' : 'This device only'
}

const schemeLabel = (scheme: string): string =>
  scheme === 'system' ? 'Auto' : scheme === 'light' ? 'Light' : 'Dark'

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'
