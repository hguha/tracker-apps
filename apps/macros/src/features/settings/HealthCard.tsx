import { useEffect, useState } from 'react'
import { Button, Card, useToast } from '@tracker-engine/ui'
import {
  isHealthAvailable,
  openHealthSettings,
  requestWeightAccess,
} from '@tracker-engine/platform'
import { HeartPulse } from 'lucide-react'
import { isHealthSyncOn, setHealthSyncOn, syncHealthWeights } from '@/data/health'

/**
 * Apple Health (and Health Connect on Android): weight in, nothing else.
 *
 * Read-only and weight-only on purpose. Pulling active energy and adding it to the day's budget is
 * the obvious next step and it would make the app wrong: a measured expenditure already includes
 * training, so crediting it again double-counts. Saying that here matters, because "connect Apple
 * Health" usually implies exactly the thing this refuses to do.
 */
export function HealthCard() {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [isOn, setIsOn] = useState(isHealthSyncOn)
  const [isBusy, setIsBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    void isHealthAvailable().then(setIsAvailable)
  }, [])

  // Nothing to show on the web, where there is no health API to connect to.
  if (isAvailable !== true) return null

  async function connect() {
    setIsBusy(true)
    try {
      await requestWeightAccess()
      const imported = await syncHealthWeights()
      setHealthSyncOn(true)
      setIsOn(true)
      toast.show(
        imported > 0
          ? `Imported ${imported} weigh-in${imported === 1 ? '' : 's'}`
          : 'Connected — nothing new to import yet',
      )
    } finally {
      setIsBusy(false)
    }
  }

  async function importNow() {
    setIsBusy(true)
    try {
      const imported = await syncHealthWeights()
      toast.show(imported > 0 ? `Imported ${imported} weigh-ins` : 'Already up to date')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
        <HeartPulse size={16} className="text-accent" />
        Apple Health
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        Imports weigh-ins only, so a smart scale feeds your trend.
      </p>

      {isOn ? (
        <>
          <Button
            variant="secondary"
            className="mt-2.5 w-full"
            disabled={isBusy}
            onClick={() => void importNow()}
          >
            {isBusy ? 'Importing…' : 'Import now'}
          </Button>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                setHealthSyncOn(false)
                setIsOn(false)
                toast.show('Health import off')
              }}
              className="flex-1 py-2 text-[13px] font-semibold text-ink-secondary active:opacity-60"
            >
              Turn off
            </button>
            <button
              onClick={() => void openHealthSettings()}
              className="flex-1 py-2 text-[13px] font-semibold text-accent active:opacity-60"
            >
              Health permissions
            </button>
          </div>
          <p className="mt-1 text-[12px] text-ink-muted">
            Weigh-ins entered here are never overwritten. Health&rsquo;s earliest reading of the day is used.
          </p>
        </>
      ) : (
        <Button className="mt-2.5 w-full" disabled={isBusy} onClick={() => void connect()}>
          {isBusy ? 'Connecting…' : 'Connect Apple Health'}
        </Button>
      )}
    </Card>
  )
}
