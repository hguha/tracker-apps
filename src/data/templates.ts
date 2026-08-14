import { buildExerciseResolver } from './resolveExerciseName'
import { db, syncStamp } from '@/db/database'
import { getActiveUserId } from '@/db/seed'
import {
  type Equipment,
  type Template,
  type TemplateExercise,
  type WeightUnit,
} from '@/domain/types'
import { nextTarget } from '@/lib/progression'
import { formatWeight, weightToKg } from '@/lib/units'
import { lastEquipmentMap, listExercises } from './exercises'
import { enqueue, newId, patchRow } from './outbox'
import { getProfile } from './profile'
import { getLastPerformance } from './records'
import { addSet, listSets, type SetPlaceholder } from './sets'
import { type WorkoutPreview } from './summaries'
import {
  addExerciseToWorkout,
  getWorkout,
  listWorkoutExercises,
  savePlaceholderOverrides,
  startWorkout,
  updateWorkoutExercise,
} from './workouts'

export async function listTemplates(): Promise<Template[]> {
  const all = await db.templates.toArray()
  return all
    .filter((t) => t.deletedAt === null && !t.isArchived)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
}

export async function getTemplate(id: string): Promise<Template | undefined> {
  const template = await db.templates.get(id)
  return template?.deletedAt === null ? template : undefined
}

export async function listTemplateExercises(
  templateId: string,
): Promise<TemplateExercise[]> {
  const rows = await db.templateExercises.where('templateId').equals(templateId).toArray()
  return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.position - b.position)
}

// A workout keeps its own copy of what was planned, so editing a template never rewrites history (§4.7).

export async function createTemplate(
  name: string,
  folder: string | null = null,
): Promise<string> {
  const template: Template = {
    id: newId(),
    userId: getActiveUserId(),
    name: name.trim() || 'New template',
    description: '',
    folder,
    lastUsedAt: null,
    timesUsed: 0,
    isArchived: false,
    ...syncStamp(),
  }
  await db.templates.add(template)
  await enqueue('templates', template.id)
  return template.id
}

export async function updateTemplate(
  id: string,
  patch: Partial<Template>,
): Promise<void> {
  await patchRow(db.templates, 'templates', id, patch)
}

export async function deleteTemplate(id: string): Promise<void> {
  await patchRow(db.templates, 'templates', id, { deletedAt: Date.now() })
}

// A template the + button created and the user backed straight out of is scratch,
// not data. Left behind, it appears in "Log a workout" as a startable option that
// can't start, named "New template". Only removes an untouched one.

export async function discardUntouchedTemplate(id: string): Promise<boolean> {
  const template = await db.templates.get(id)
  if (!template || template.deletedAt !== null) return false
  if (template.name.trim() !== 'New template' || template.description !== '') return false
  if ((await listTemplateExercises(id)).length > 0) return false
  await deleteTemplate(id)
  return true
}

export async function restoreTemplate(id: string): Promise<void> {
  await patchRow(db.templates, 'templates', id, { deletedAt: null })
}

export async function addExerciseToTemplate(
  templateId: string,
  exerciseId: string,
  equipment: Equipment,
): Promise<string> {
  const existing = await listTemplateExercises(templateId)
  const row: TemplateExercise = {
    id: newId(),
    templateId,
    exerciseId,
    equipment,
    position: existing.length,
    supersetGroup: null,
    targetSets: 3,
    targetRepsLow: null,
    targetRepsHigh: null,
    targetWeightKg: null,
    targetRpe: null,
    restSeconds: null,
    notes: '',
    progression: null,
    ...syncStamp(),
  }
  await db.templateExercises.add(row)
  await enqueue('templateExercises', row.id)
  return row.id
}

export async function updateTemplateExercise(
  id: string,
  patch: Partial<TemplateExercise>,
): Promise<void> {
  await patchRow(db.templateExercises, 'templateExercises', id, patch)
}

export async function removeTemplateExercise(id: string): Promise<void> {
  await patchRow(db.templateExercises, 'templateExercises', id, { deletedAt: Date.now() })
}

export async function reorderTemplateExercises(orderedIds: string[]): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await updateTemplateExercise(id, { position: index })
  }
}

// Materialize a coach plan (§13) into templates, one per session. Exercises are matched
// to the library by name/alias; unmatched names are skipped (not invented) and returned.

export async function createTemplatesFromPlan(plan: {
  sessions: {
    name: string
    exercises: {
      name: string
      sets: number
      repLow: number
      repHigh: number
      weight: number | null
      equipment?: Equipment | null
      autoProgress?: boolean
    }[]
  }[]
  unitWeight: WeightUnit
  folder?: string | null
}): Promise<{ templateIds: string[]; unmatched: string[] }> {
  // The coach answers with names like "Cable Face Pull"; equipment is a separate
  // column here, so the name has to be split into both. This used to stamp every
  // plan exercise `barbell`, which turned a cable movement into "Barbell Face Pull"
  // and filed its records under an implement the user never touched.
  const resolve = buildExerciseResolver(await listExercises(), await lastEquipmentMap())

  const incrementKg = plan.unitWeight === 'kg' ? 2.5 : weightToKg(5, 'lb')

  const templateIds: string[] = []
  const unmatched: string[] = []

  for (const session of plan.sessions) {
    // Resolve matches first, so a session where nothing matched creates no empty template.
    const matched = session.exercises.map((pe) => ({
      pe,
      hit: resolve(pe.name, pe.equipment ?? null),
    }))
    for (const { pe, hit } of matched) {
      if (!hit) unmatched.push(pe.name)
    }
    const resolved = matched.filter(
      (m): m is { pe: (typeof m)['pe']; hit: NonNullable<(typeof m)['hit']> } =>
        m.hit !== null,
    )
    if (resolved.length === 0) continue

    const templateId = await createTemplate(session.name, plan.folder ?? null)
    templateIds.push(templateId)

    for (const { pe, hit } of resolved) {
      const teId = await addExerciseToTemplate(templateId, hit.exerciseId, hit.equipment)
      await updateTemplateExercise(teId, {
        targetSets: pe.sets,
        targetRepsLow: pe.repLow,
        targetRepsHigh: pe.repHigh,
        targetWeightKg:
          pe.weight === null ? null : weightToKg(pe.weight, plan.unitWeight),
        progression: pe.autoProgress ? { kind: 'double', incrementKg, maxRpe: 8 } : null,
      })
    }
  }

  return { templateIds, unmatched }
}

export async function getTemplatePreview(
  templateId: string,
): Promise<WorkoutPreview | null> {
  const template = await getTemplate(templateId)
  if (!template) return null
  const profile = await getProfile()
  const templateExercises = await listTemplateExercises(templateId)

  const exercises: WorkoutPreview['exercises'] = []
  let totalSets = 0

  for (const te of templateExercises) {
    const exercise = await db.exercises.get(te.exerciseId)
    if (!exercise) continue
    const region = exercise.region
    const sets = te.targetSets ?? 3
    totalSets += sets
    exercises.push({
      name: exercise.name,
      region,
      detail: describeTemplateTarget(te, profile.unitWeight),
      setCount: sets,
    })
  }

  return { title: template.name, performedAt: null, exercises, totalSets }
}

export function describeTemplateTarget(
  te: TemplateExercise,
  weightUnit: WeightUnit,
): string {
  const sets = te.targetSets ?? 3
  const parts: string[] = [`${sets} sets`]
  if (te.targetRepsLow !== null || te.targetRepsHigh !== null) {
    const low = te.targetRepsLow
    const high = te.targetRepsHigh
    if (low !== null && high !== null && low !== high)
      parts[0] = `${sets} × ${low}-${high}`
    else parts[0] = `${sets} × ${low ?? high}`
  }
  if (te.targetWeightKg !== null)
    parts.push(`@ ${formatWeight(te.targetWeightKg, weightUnit)}`)
  if (te.targetRpe !== null) parts.push(`RPE ${te.targetRpe}`)
  return parts.join(' ')
}

// Captures a finished session as a reusable template, with targets pre-filled from what was done (§7).

export async function saveWorkoutAsTemplate(
  workoutId: string,
  name: string,
  folder: string | null = null,
): Promise<string> {
  const workout = await getWorkout(workoutId)
  if (!workout) throw new Error('Workout not found')

  const template: Template = {
    id: newId(),
    userId: getActiveUserId(),
    name: name.trim(),
    description: '',
    folder,
    lastUsedAt: null,
    timesUsed: 0,
    isArchived: false,
    ...syncStamp(),
  }
  await db.templates.add(template)
  await enqueue('templates', template.id)

  const workoutExercises = await listWorkoutExercises(workoutId)
  for (const we of workoutExercises) {
    const sets = (await listSets(we.id)).filter((s) => s.isCompleted)
    const reps = sets.map((s) => s.reps).filter((r): r is number => r !== null)
    const weights = sets.map((s) => s.weightKg).filter((w): w is number => w !== null)

    const row: TemplateExercise = {
      id: newId(),
      templateId: template.id,
      exerciseId: we.exerciseId,
      equipment: we.equipment,
      position: we.position,
      supersetGroup: we.supersetGroup,
      targetSets: sets.length || null,
      targetRepsLow: reps.length > 0 ? Math.min(...reps) : null,
      targetRepsHigh: reps.length > 0 ? Math.max(...reps) : null,
      targetWeightKg: weights.length > 0 ? Math.max(...weights) : null,
      targetRpe: null,
      restSeconds: we.restSeconds,
      notes: '',
      progression: null,
      ...syncStamp(),
    }
    await db.templateExercises.add(row)
    await enqueue('templateExercises', row.id)
  }

  return template.id
}

// Instantiates a template as a live workout, planned sets laid out as unchecked rows (§7).

export async function startWorkoutFromTemplate(templateId: string): Promise<string> {
  const template = await getTemplate(templateId)
  if (!template) throw new Error('Template not found')

  const workoutId = await startWorkout({ title: template.name, templateId })
  const templateExercises = await listTemplateExercises(templateId)
  const placeholders: Record<string, SetPlaceholder> = {}

  for (const te of templateExercises) {
    const workoutExerciseId = await addExerciseToWorkout(
      workoutId,
      te.exerciseId,
      te.equipment,
    )
    if (te.supersetGroup !== null) {
      await updateWorkoutExercise(workoutExerciseId, {
        supersetGroup: te.supersetGroup,
        restSeconds: te.restSeconds,
      })
    }

    // Apply a progression rule (§7 Phase 4) if present; with no rule or history it returns the template's own targets.
    let seedWeightKg = te.targetWeightKg
    let targetReps = te.targetRepsLow ?? te.targetRepsHigh
    if (te.progression) {
      const last = (await getLastPerformance(te.exerciseId, te.equipment))?.sessions[0]
      const stepped = nextTarget({
        rule: te.progression,
        targetWeightKg: te.targetWeightKg,
        targetRepsLow: te.targetRepsLow,
        targetRepsHigh: te.targetRepsHigh,
        lastSets: (last?.sets ?? []).map((s) => ({
          weightKg: s.weightKg,
          reps: s.reps,
          rpe: s.rpe ?? null,
        })),
      })
      seedWeightKg = stepped.targetWeightKg
      targetReps = stepped.targetReps
    }

    // The template supplies the shape (set count); a target seeds the ghost, else the placeholder falls back to history (§6.2).
    const targetSets = te.targetSets ?? 3
    for (let index = 0; index < targetSets; index += 1) {
      const setId = await addSet({ workoutExerciseId })
      if (seedWeightKg !== null || targetReps !== null) {
        placeholders[setId] = {
          weightKg: seedWeightKg,
          reps: targetReps,
          durationSeconds: null,
          distanceM: null,
        }
      }
    }
  }

  if (Object.keys(placeholders).length > 0) {
    await savePlaceholderOverrides(workoutId, placeholders)
  }

  // Through updateTemplate so this bump enqueues and bumps clientRev; a raw db.update would leave the revision stale and be clobbered by a pull.
  await updateTemplate(templateId, {
    lastUsedAt: Date.now(),
    timesUsed: template.timesUsed + 1,
  })

  return workoutId
}

// Following a template ends the moment the exercise list diverges from it. The
// session no longer describes that template, so keeping the link would credit it
// as an instance and skew adherence — and would offer "save as template" for a
// workout that already is one. Set-level changes are normal progression and don't
// count; only the shape does. Returns the template's name for the UI to explain
// the change, or null when there was nothing to detach.
