// Picks the coach provider once: the live Gemini coach when a backend + session are
// available, else the offline mock (always available). Same swappable-provider pattern
// as REPutation (principle #9).

import { useEffect, useState } from 'react'
import { geminiCoachProvider } from './geminiProvider'
import { mockCoachProvider } from './mockProvider'
import type { CoachProvider } from './types'

export function useCoach(): { provider: CoachProvider | null; ready: boolean } {
  const [provider, setProvider] = useState<CoachProvider | null>(null)

  useEffect(() => {
    let cancelled = false
    void geminiCoachProvider.isAvailable().then((live) => {
      if (!cancelled) setProvider(live ? geminiCoachProvider : mockCoachProvider)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { provider, ready: provider !== null }
}
