import { useLiveQuery } from 'dexie-react-hooks'
import { unitsFor, type UnitPreference } from '@tracker-engine/core'
import * as repo from '@/data/repository'
import type { UnitSystem } from '@/domain/types'

const REMEMBERED = 'macros.units'

function remembered(): UnitSystem {
  try {
    return localStorage.getItem(REMEMBERED) === 'imperial' ? 'imperial' : 'metric'
  } catch {
    return 'metric'
  }
}

let lastKnown: UnitSystem = remembered()

export function useUnits(): UnitPreference {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  if (profile && profile.units !== lastKnown) {
    lastKnown = profile.units
    try {
      localStorage.setItem(REMEMBERED, profile.units)
    } catch {
      return unitsFor(profile.units)
    }
  }
  return unitsFor(profile?.units ?? lastKnown)
}
