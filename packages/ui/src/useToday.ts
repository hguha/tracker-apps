import { useEffect, useState } from 'react'
import { dayKey } from '@tracker-engine/core'

const untilNextDay = (now: number): number => {
  const next = new Date(now)
  next.setHours(24, 0, 1, 0)
  return next.getTime() - now
}

export function useToday(): string {
  const [today, setToday] = useState(() => dayKey(Date.now()))

  useEffect(() => {
    const check = () => setToday(dayKey(Date.now()))
    const timer = window.setTimeout(check, untilNextDay(Date.now()))
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [today])

  return today
}
