import { convertWeight, type WeightUnit } from '@tracker-engine/core'
import { plural } from '@tracker-engine/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card, NavList, NavRow } from '@tracker-engine/ui'
import {
  Award,
  Bell,
  ChefHat,
  ChevronRight,
  Database,
  Palette,
  Sparkles,
  Target,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useSync } from '@/sync/useSync'
import * as repo from '@/data/repository'
import { useUnits } from '@/features/shared/useUnits'
import { describeReminders } from '@/data/reminders'
import type { Profile, Program } from '@/domain/types'

export type SettingsRoute =
  | 'targets'
  | 'about'
  | 'reminders'
  | 'appearance'
  | 'badges'
  | 'library'
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
}: {
  onOpen: (route: SettingsRoute) => void
}) {
  const { session } = useAuth()
  const sync = useSync()
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const myFoods = useLiveQuery(() => repo.customFoods(), [], [])

  const missing = missingFacts(profile)
  const weights = useLiveQuery(() => repo.weights(), [], [])
  const units = useUnits()

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
        <NavRow
          icon={<ChefHat size={17} />}
          label="Your library"
          hint={libraryHint(recipes?.length ?? 0, myFoods?.length ?? 0)}
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
          hint={
            missing.length > 0
              ? `Add your ${missing.join(', ')} to get a target`
              : goalHint(program, weights?.[weights.length - 1]?.kg ?? null, units.weight)
          }
          tone={missing.length > 0 ? 'warning' : undefined}
          onClick={() => onOpen('targets')}
        />
        <NavRow
          icon={<Bell size={17} />}
          label="Reminders"
          hint={describeReminders(profile?.reminders ?? null)}
          onClick={() => onOpen('reminders')}
        />
        <NavRow
          icon={<Palette size={17} />}
          label="Units & appearance"
          hint={
            profile
              ? `${profile.units === 'metric' ? 'kg' : 'lb'} · ${schemeLabel(profile.colorScheme)} · ${profile.theme}`
              : ''
          }
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

    </div>
  )
}

/** The facts the cold-start target needs. Surfaced here as well as on Today, since this is
 *  where someone goes looking when the bars won't fill. */
function missingFacts(profile: Profile | undefined): string[] {
  if (!profile) return []
  return [
    profile.heightCm === null && 'height',
    profile.birthYear === null && 'age',
    profile.sex === null && 'sex',
  ].filter((value): value is string => typeof value === 'string')
}

/** Counts, so the row says what's in there rather than only what it's called. */
function libraryHint(recipes: number, foods: number): string {
  const parts = [
    recipes > 0 && plural(recipes, 'recipe'),
    foods > 0 && plural(foods, 'own food'),
  ].filter((part): part is string => typeof part === 'string')
  return parts.length === 0 ? 'Recipes and your own foods' : parts.join(' · ')
}

function goalHint(
  program: Program | undefined,
  latestKg: number | null,
  unit: WeightUnit,
): string {
  if (!program) return 'No goal set'
  const verb =
    program.goal === 'lose' ? 'Losing' : program.goal === 'gain' ? 'Building' : 'Maintaining'
  if (program.ratePctPerWeek === 0) return verb
  if (latestKg === null) return `${verb} · ${Math.abs(program.ratePctPerWeek)}%/week`
  const perWeek = Math.abs(convertWeight((program.ratePctPerWeek / 100) * latestKg, unit))
  return `${verb} · ${perWeek.toFixed(1)} ${unit}/week`
}

function dataHint(sync: { deadLettered: number; pending: number; enabled: boolean }): string {
  if (sync.deadLettered > 0) {
    return `${plural(sync.deadLettered, 'change')} failed to sync`
  }
  if (sync.pending > 0) {
    return `${plural(sync.pending, 'change')} waiting to upload`
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
