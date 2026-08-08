/**
 * Settings and body metrics (§5.2 `/me`, `/body`).
 *
 * Merged into one tab for the prototype — the split into separate Body and Me
 * routes matters once there are enough biomarker charts to fill a screen.
 */

import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  Dumbbell,
  RefreshCw,
  Sparkles,
  Trophy,
  Upload,
} from 'lucide-react'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import {
  backupFilename,
  countsOf,
  exportToJson,
  importBackup,
  parseBackup,
  BackupParseError,
} from '@/data/backup'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/auth/AuthContext'
import { initialsOf } from '@/auth/types'
import { useSync } from '@/sync/useSync'
import { playCue, setSoundEnabled } from '@/features/timer/sounds'
import { AppearanceSection } from './AppearanceSection'
import { cn } from '@/lib/cn'
import { formatRelativeDay } from '@/lib/dates'
import { useDraftInput } from '@/lib/useDraftInput'
import {
  lengthFromCm,
  lengthToCm,
  parseNumber,
  weightFromKg,
  weightToKg,
} from '@/lib/units'
import type { DistanceUnit, LengthUnit, Profile, WeightUnit } from '@/domain/types'

/** The handful worth logging often. The rest live behind "all metrics". */
const QUICK_METRIC_KEYS = ['bodyweight', 'body_fat_pct', 'waist', 'resting_hr']

export function MeScreen({
  onOpenLibrary,
  onOpenTemplates,
  onOpenAccount,
  onOpenCoach,
  onOpenBadges,
}: {
  onOpenLibrary: () => void
  onOpenTemplates: () => void
  onOpenAccount: () => void
  onOpenCoach: () => void
  onOpenBadges: () => void
}) {
  const toast = useToast()
  const { session } = useAuth()
  const sync = useSync()
  // The reason the most recent write was rejected, so "Failed to sync" explains
  // itself (e.g. an RLS or missing-column error) instead of being opaque.
  const lastSyncError = useLiveQuery(async () => {
    const last = await db.deadLetter.orderBy('seq').last()
    return last?.error ?? null
  }, [])
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [isClearing, setIsClearing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    if (isExporting) return
    setIsExporting(true)
    try {
      const json = await exportToJson()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      // A sortable date stamp; toISOString is UTC but fine for a filename.
      link.download = backupFilename(new Date().toISOString().slice(0, 10))
      link.click()
      URL.revokeObjectURL(url)
      toast.show('Backup downloaded')
    } catch {
      toast.show('Could not export')
    } finally {
      setIsExporting(false)
    }
  }

  async function handleImportFile(file: File) {
    setIsImporting(true)
    try {
      const backup = parseBackup(await file.text())
      const counts = countsOf(backup)
      const ok = window.confirm(
        `Import ${counts.workouts} workouts, ${counts.templates} templates, ` +
          `${counts.exercises} custom exercises, and ${counts.metricEntries} measurements? ` +
          `Existing items with the same id are overwritten; nothing is deleted.`,
      )
      if (!ok) return
      await importBackup(backup)
      toast.show('Backup imported')
      // A hard reload is the simplest way to refresh every live query at once.
      window.location.reload()
    } catch (error) {
      toast.show(
        error instanceof BackupParseError ? error.message : 'Could not import that file',
      )
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const data = useLiveQuery(async () => {
    const profile = await repo.getProfile()
    const definitions = await db.metricDefinitions.toArray()

    const quick = await Promise.all(
      QUICK_METRIC_KEYS.map(async (key) => {
        const definition = definitions.find((d) => d.key === key)
        if (!definition) return null
        const entries = await repo.listMetricEntries(definition.id, 5)
        return { definition, latest: entries[0], entries }
      }),
    )

    const workoutCount = (await repo.listWorkouts(500)).filter(
      (w) => w.endedAt !== null,
    ).length

    return {
      profile,
      quick: quick.filter((q): q is NonNullable<typeof q> => q !== null),
      workoutCount,
    }
  }, [])

  if (!data) return <div className="p-6 text-ink-muted">Loading…</div>

  const { profile, quick, workoutCount } = data

  /** Converts a typed display value into canonical storage units. */
  function toCanonical(unitType: string, raw: number): number {
    if (unitType === 'mass') return weightToKg(raw, profile.unitWeight)
    if (unitType === 'length') return lengthToCm(raw, profile.unitLength)
    return raw
  }

  function toDisplay(unitType: string, value: number): number {
    if (unitType === 'mass') return weightFromKg(value, profile.unitWeight, 0.1)
    if (unitType === 'length') return lengthFromCm(value, profile.unitLength)
    return value
  }

  function unitSuffix(unitType: string): string {
    if (unitType === 'mass') return profile.unitWeight
    if (unitType === 'length') return profile.unitLength
    if (unitType === 'percent') return '%'
    return ''
  }

  async function saveMetric(definitionId: string, unitType: string) {
    const raw = draftValues[definitionId]
    if (!raw || raw.trim() === '') return
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.show('Enter a positive number')
      return
    }

    await repo.addMetricEntry({
      definitionId,
      value: toCanonical(unitType, parsed),
    })
    setDraftValues((current) => ({ ...current, [definitionId]: '' }))
    toast.show('Logged')
  }

  return (
    <div className="space-y-3 px-3 py-3">
      <Card className="overflow-hidden">
        <button
          onClick={onOpenAccount}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-accent-wash"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-[14px] font-bold text-white">
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
        <button
          onClick={onOpenLibrary}
          className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left active:bg-accent-wash"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
            <Dumbbell size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Exercise library</span>
            <span className="block text-[12.5px] text-ink-muted">
              Browse, search, and edit every exercise
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-muted" />
        </button>
        <button
          onClick={onOpenTemplates}
          className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left active:bg-accent-wash"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
            <ClipboardList size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Templates</span>
            <span className="block text-[12.5px] text-ink-muted">
              Build and edit reusable workout plans
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-muted" />
        </button>
        <button
          onClick={onOpenCoach}
          className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left active:bg-accent-wash"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
            <Sparkles size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Coach</span>
            <span className="block text-[12.5px] text-ink-muted">
              Critique your balance and draft a plan from your history
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-muted" />
        </button>
        <button
          onClick={onOpenBadges}
          className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left active:bg-accent-wash"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
            <Trophy size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Badges</span>
            <span className="block text-[12.5px] text-ink-muted">
              Milestones across strength, consistency, and cardio
            </span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-muted" />
        </button>
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Body metrics</h2>
        <div className="mt-3 space-y-3">
          {quick.map(({ definition, latest }) => (
            <div key={definition.id}>
              <div className="flex items-baseline justify-between">
                <label className="text-[13.5px] font-medium">{definition.label}</label>
                {latest && (
                  <span className="text-[12px] text-ink-muted">
                    {toDisplay(definition.unitType, latest.value)}
                    {unitSuffix(definition.unitType)} ·{' '}
                    {formatRelativeDay(latest.measuredAt)}
                  </span>
                )}
              </div>
              <div className="mt-1 flex gap-2">
                <input
                  value={draftValues[definition.id] ?? ''}
                  onChange={(event) =>
                    setDraftValues((current) => ({
                      ...current,
                      [definition.id]: event.target.value,
                    }))
                  }
                  inputMode="decimal"
                  placeholder={
                    latest
                      ? String(toDisplay(definition.unitType, latest.value))
                      : unitSuffix(definition.unitType)
                  }
                  className="h-11 flex-1 rounded-xl border border-line bg-surface px-3.5 tabular text-[16px] outline-none focus:border-accent"
                />
                <Button
                  variant="secondary"
                  onClick={() => void saveMetric(definition.id, definition.unitType)}
                  disabled={!draftValues[definition.id]?.trim()}
                  aria-label={`Log ${definition.label}`}
                >
                  <Check size={17} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Units</h2>
        <div className="mt-3 space-y-3">
          <UnitToggle<WeightUnit>
            label="Weight"
            value={profile.unitWeight}
            options={['lb', 'kg']}
            onChange={(unitWeight) => void repo.updateProfile({ unitWeight })}
          />
          <UnitToggle<DistanceUnit>
            label="Distance"
            value={profile.unitDistance}
            options={['mi', 'km']}
            onChange={(unitDistance) => void repo.updateProfile({ unitDistance })}
          />
          <UnitToggle<LengthUnit>
            label="Length"
            value={profile.unitLength}
            options={['in', 'cm']}
            onChange={(unitLength) => void repo.updateProfile({ unitLength })}
          />
        </div>
      </Card>

      <CoachingCard profile={profile} />

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Logging</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label className="text-[13.5px] font-medium">Default rest timer</label>
            <div className="mt-1.5 flex gap-1.5">
              {[30, 60, 90, 120, 180].map((seconds) => (
                <button
                  key={seconds}
                  onClick={() => void repo.updateProfile({ defaultRestSeconds: seconds })}
                  className={cn(
                    'h-10 flex-1 rounded-lg text-[13px] font-semibold',
                    profile.defaultRestSeconds === seconds
                      ? 'bg-accent text-white'
                      : 'bg-sunken text-ink-secondary',
                  )}
                >
                  {seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[13.5px] font-medium">Weekly workout goal</label>
            <p className="text-[12px] text-ink-muted">
              The target the Home ring fills toward.
            </p>
            <div className="mt-1.5 flex gap-1.5">
              {[2, 3, 4, 5, 6].map((count) => (
                <button
                  key={count}
                  onClick={() => void repo.updateProfile({ weeklyWorkoutGoal: count })}
                  className={cn(
                    'h-10 flex-1 rounded-lg text-[13px] font-semibold',
                    profile.weeklyWorkoutGoal === count
                      ? 'bg-accent text-white'
                      : 'bg-sunken text-ink-secondary',
                  )}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-[13.5px] font-medium">Track RPE</span>
              <span className="block text-[12px] text-ink-muted">
                Adds an effort field to every set
              </span>
            </span>
            <input
              type="checkbox"
              checked={profile.showRpe}
              onChange={(event) =>
                void repo.updateProfile({ showRpe: event.target.checked })
              }
              className="size-5 accent-[var(--accent)]"
            />
          </label>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-[13.5px] font-medium">
                Start rest automatically
              </span>
              <span className="block text-[12px] text-ink-muted">
                Begin the timer as soon as you log a set
              </span>
            </span>
            <input
              type="checkbox"
              checked={profile.autoStartRest}
              onChange={(event) =>
                void repo.updateProfile({ autoStartRest: event.target.checked })
              }
              className="size-5 accent-[var(--accent)]"
            />
          </label>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-[13.5px] font-medium">Sounds</span>
              <span className="block text-[12px] text-ink-muted">
                Cues for logging a set, records, and rest
              </span>
            </span>
            <input
              type="checkbox"
              checked={profile.soundEnabled}
              onChange={(event) => {
                setSoundEnabled(event.target.checked)
                void repo.updateProfile({ soundEnabled: event.target.checked })
                // Play the cue being enabled, so the choice is audible.
                if (event.target.checked) playCue('pr')
              }}
              className="size-5 accent-[var(--accent)]"
            />
          </label>

          <label className="flex items-center justify-between">
            <span>
              <span className="block text-[13.5px] font-medium">Training avatar</span>
              <span className="block text-[12px] text-ink-muted">
                A body on Home that buffs up and deflates with your training
              </span>
            </span>
            <input
              type="checkbox"
              checked={profile.showAvatar}
              onChange={(event) =>
                void repo.updateProfile({ showAvatar: event.target.checked })
              }
              className="size-5 accent-[var(--accent)]"
            />
          </label>
        </div>
      </Card>

      <AppearanceSection
        theme={profile.theme}
        colorScheme={profile.colorScheme}
        accentOverride={profile.accentOverride}
        onChange={(patch) => void repo.updateProfile(patch)}
      />

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Data</h2>
        <dl className="mt-2.5 space-y-1.5 text-[13.5px]">
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Workouts logged</dt>
            <dd className="tabular font-semibold">{workoutCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Queued for sync</dt>
            <dd className="tabular font-semibold">{sync.pending}</dd>
          </div>
          {sync.deadLettered > 0 && (
            <>
              <div className="flex justify-between">
                <dt style={{ color: 'var(--status-serious)' }}>Failed to sync</dt>
                <dd
                  className="tabular font-semibold"
                  style={{ color: 'var(--status-serious)' }}
                >
                  {sync.deadLettered}
                </dd>
              </div>
              {lastSyncError && (
                <p className="text-[12px] text-ink-muted">Reason: {lastSyncError}</p>
              )}
            </>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-secondary">Sync</dt>
            <dd className="font-semibold">
              {sync.enabled ? 'On — syncs to your account' : 'This device only'}
            </dd>
          </div>
        </dl>

        {sync.enabled ? (
          <>
            <Button
              variant="secondary"
              className="mt-3 w-full"
              disabled={sync.phase === 'syncing'}
              onClick={() => {
                void sync.syncNow().then(() => {
                  toast.show(
                    sync.pending === 0 ? 'Everything is synced' : 'Sync finished',
                  )
                })
              }}
            >
              <RefreshCw
                size={16}
                className={sync.phase === 'syncing' ? 'animate-spin' : undefined}
              />
              {sync.phase === 'syncing'
                ? 'Syncing…'
                : sync.pending > 0
                  ? `Sync now (${sync.pending} pending)`
                  : 'Sync now'}
            </Button>
            {sync.deadLettered > 0 && (
              <Button
                variant="secondary"
                className="mt-2 w-full"
                disabled={sync.phase === 'syncing'}
                onClick={() => {
                  void sync.retryFailed().then((count) => {
                    toast.show(
                      count > 0
                        ? `Retrying ${count} failed ${count === 1 ? 'change' : 'changes'}…`
                        : 'Nothing to retry',
                    )
                  })
                }}
              >
                <RefreshCw size={16} />
                Retry {sync.deadLettered} failed
              </Button>
            )}
            <p className="mt-2.5 text-[12px] text-ink-muted">
              Everything saves on this device instantly and syncs to your account in the
              background. Use “Sync now” to push right away.
              {sync.deadLettered > 0 &&
                ' “Retry failed” re-attempts changes that were rejected — use it after a connection or server issue is resolved.'}
            </p>
          </>
        ) : (
          <p className="mt-2.5 text-[12px] text-ink-muted">
            This account keeps everything in this browser. Nothing is uploaded.
          </p>
        )}

        {/* Export / import: the portable backup that makes depending on a free
            tier acceptable (§11.3). Pure client-side JSON. */}
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={isExporting}
            onClick={() => void handleExport()}
          >
            <Download size={16} />
            {isExporting ? 'Exporting…' : 'Export'}
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} />
            {isImporting ? 'Importing…' : 'Import'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleImportFile(file)
            }}
          />
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">
          Export a full JSON backup of your workouts, templates, custom exercises, and
          measurements — or import one to restore or move devices.
        </p>

        {/* Removes finished sessions that contain no completed set — pulled from
            an older build, or left by an interrupted session. */}
        <button
          onClick={() => {
            if (isClearing) return
            setIsClearing(true)
            void repo
              .purgeEmptyWorkouts()
              .then((removed) => {
                setIsClearing(false)
                toast.show(
                  removed === 0
                    ? 'No empty workouts found'
                    : `Removed ${removed} empty ${removed === 1 ? 'workout' : 'workouts'}`,
                )
              })
              .catch(() => {
                setIsClearing(false)
                toast.show('Could not remove empty workouts')
              })
          }}
          disabled={isClearing}
          className="mt-3 w-full py-2 text-[13px] font-semibold text-ink-secondary active:opacity-60 disabled:opacity-40"
        >
          Remove empty workouts
        </button>

        {/* The real reset: tombstones every row through the outbox, so the
            deletions reach the server instead of being re-pulled. This is what
            "clear my test data" actually needs. */}
        <button
          onClick={() => {
            if (isClearing) return
            const ok = window.confirm(
              sync.enabled
                ? 'Delete ALL workouts, templates, custom exercises, and measurements — on this device AND the server, on every device? This cannot be undone. Export first if you want a copy.'
                : 'Delete ALL workouts, templates, custom exercises, and measurements? This cannot be undone. Export first if you want a copy.',
            )
            if (!ok) return
            setIsClearing(true)
            void repo
              .deleteAllTrainingData()
              .then((counts) => {
                toast.show(
                  `Deleted ${counts.workouts} workouts, ${counts.templates} templates, ` +
                    `${counts.customExercises} custom exercises, ${counts.metricEntries} measurements`,
                )
                // Push the tombstones right away so the server matches.
                return sync.enabled ? sync.syncNow() : undefined
              })
              .then(() => window.location.reload())
              .catch(() => {
                setIsClearing(false)
                toast.show('Could not delete training data')
              })
          }}
          disabled={isClearing}
          className="mt-1 w-full py-2 text-[13px] font-semibold text-critical active:opacity-60 disabled:opacity-40"
        >
          {isClearing ? 'Working…' : 'Delete all my training data'}
        </button>

        {/* Clears IndexedDB. On a synced account the next pull rehydrates from
            the server; on an offline account this is a genuine reset. */}
        <button
          onClick={() => {
            if (isClearing) return
            const ok = window.confirm(
              sync.enabled
                ? 'Clear this device’s local copy? Your data stays on the server and will re-download on the next sync.'
                : 'Clear all local data on this device? This cannot be undone — export first if you want a copy.',
            )
            if (!ok) return
            setIsClearing(true)
            void repo
              .clearLocalData()
              .then(() => window.location.reload())
              .catch(() => {
                setIsClearing(false)
                toast.show('Could not clear data')
              })
          }}
          disabled={isClearing}
          className="mt-3 w-full py-2 text-[13px] font-semibold text-critical active:opacity-60 disabled:opacity-40"
        >
          {isClearing ? 'Clearing…' : 'Clear local data'}
        </button>
      </Card>
    </div>
  )
}

/**
 * Height + training goal — the profile fields the AI coach personalizes against
 * (§13). Height is stored metric and shown in the user's length unit; the goal
 * is free text. Both are optional. What's sent to the coach is always visible in
 * the coach's "data sent" disclosure.
 */
function CoachingCard({ profile }: { profile: Profile }) {
  const unit = profile.unitLength
  // Height display value (in the user's unit), one decimal for cm-free inches.
  const heightValue =
    profile.heightCm === null ? '' : String(lengthFromCm(profile.heightCm, unit))

  const height = useDraftInput({
    value: heightValue,
    onCommit: (draft) => {
      const trimmed = draft.trim()
      if (trimmed === '') return void repo.updateProfile({ heightCm: null })
      const parsed = parseNumber(trimmed)
      if (parsed !== null && parsed > 0) {
        void repo.updateProfile({ heightCm: lengthToCm(parsed, unit) })
      }
    },
  })

  const goal = useDraftInput({
    value: profile.trainingGoal ?? '',
    onCommit: (draft) => void repo.updateProfile({ trainingGoal: draft.trim() }),
  })

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
        <Sparkles size={15} className="text-accent" />
        Coaching
      </h2>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        Helps the AI coach tailor advice. Shared with the coach only — you can see exactly
        what's sent from the coach screen.
      </p>

      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="me-height" className="text-[13.5px] font-medium">
            Height
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="me-height"
              inputMode="decimal"
              placeholder="—"
              {...height.inputProps}
              className="h-10 w-24 rounded-lg border border-line bg-surface px-3 text-right text-[15px] outline-none focus:border-accent"
            />
            <span className="w-6 text-[13px] text-ink-muted">{unit}</span>
          </div>
        </div>

        <div>
          <label htmlFor="me-goal" className="text-[13.5px] font-medium">
            Training goal
          </label>
          <input
            id="me-goal"
            placeholder='e.g. "gain strength", "lean out for summer"'
            {...goal.inputProps}
            className="mt-1.5 h-10 w-full rounded-lg border border-line bg-surface px-3 text-[15px] outline-none focus:border-accent"
          />
        </div>
      </div>
    </Card>
  )
}

function UnitToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: T[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13.5px] font-medium">{label}</span>
      <div className="flex gap-1 rounded-lg bg-sunken p-0.5">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={cn(
              'h-8 rounded-md px-3.5 text-[13px] font-semibold',
              value === option ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}
