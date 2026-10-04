import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'

export function DietNotesCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const [notes, setNotes] = useState<string | null>(null)

  useEffect(() => {
    setNotes(null)
  }, [profile?.dietNotes])

  if (!profile) return null
  const value = notes ?? profile.dietNotes

  return (
    <Card className="p-4">
      <label className="block">
        <span className="text-[13px] font-medium">What the coach should know</span>
        <textarea
          rows={3}
          value={value}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes !== null && notes !== profile.dietNotes) {
              void repo.saveProfile({ dietNotes: notes.trim() })
            }
          }}
          placeholder="Vegetarian, no dairy, hate mushrooms"
          className="mt-1.5 w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[14px] outline-none"
        />
      </label>
    </Card>
  )
}
