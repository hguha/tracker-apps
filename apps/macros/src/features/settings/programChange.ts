import { defaultRate } from '@tracker-engine/body'
import type { startProgram } from '@/data/repository'
import type { Goal, Program } from '@/domain/types'

type ProgramInput = Parameters<typeof startProgram>[0]

export function withGoal(
  program: Program,
  goal: Goal,
  ratePctPerWeek: number,
  targetKg: number | null,
): ProgramInput {
  return {
    goal,
    ratePctPerWeek,
    proteinGPerKg: program.proteinGPerKg,
    fatMinPctKcal: program.fatMinPctKcal,
    coachingMode: program.coachingMode,
    cycling: program.cycling,
    targetKg,
  }
}

export const changeDirection = (program: Program, goal: Goal): ProgramInput =>
  withGoal(program, goal, defaultRate(goal), goal === 'maintain' ? null : program.targetKg)

export const dietBreak = (program: Program): ProgramInput => withGoal(program, 'maintain', 0, null)

export const previousGoal = (history: readonly Program[]): Program | undefined =>
  history.find((row) => row.goal !== 'maintain')

export function resumeAfterBreak(
  program: Program,
  history: readonly Program[],
  goal: Exclude<Goal, 'maintain'>,
): ProgramInput {
  const previous = previousGoal(history)
  const rate = previous?.goal === goal ? previous.ratePctPerWeek : defaultRate(goal)
  return withGoal(program, goal, rate, null)
}
