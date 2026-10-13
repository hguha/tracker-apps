import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'

export const COACH_NOTES_MAX = 500

export function CoachNotesCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const [notes, setNotes] = useState<string | null>(null)

  useEffect(() => {
    setNotes(null)
  }, [profile?.coachNotes])

  if (!profile) return null
  const value = notes ?? profile.coachNotes

  return (
    <Card className="p-4">
      <label className="block">
        <span className="text-[13px] font-medium">What the coach should know</span>
        <textarea
          rows={3}
          maxLength={COACH_NOTES_MAX}
          value={value}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes !== null && notes.trim() !== profile.coachNotes) {
              void repo.updateProfile({ coachNotes: notes.trim().slice(0, COACH_NOTES_MAX) })
            }
          }}
          placeholder="Bad left shoulder, home gym with dumbbells to 30 kg, no running"
          className="mt-1.5 w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[14px] outline-none focus:ring-2 focus:ring-accent/40"
        />
      </label>
    </Card>
  )
}
