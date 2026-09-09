import { House, Store, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import type { Venue } from '@/domain/types'

export const VENUE_LABELS: Record<Venue, string> = {
  home: 'Home',
  restaurant: 'Out',
  takeaway: 'Takeaway',
}

/** Longer forms, for a chart legend or a sentence where "Out" alone reads oddly. */
export const VENUE_LONG: Record<Venue, string> = {
  home: 'Cooked at home',
  restaurant: 'Ate out',
  takeaway: 'Takeaway or delivery',
}

export const VENUE_ICONS: Record<Venue, LucideIcon> = {
  home: House,
  restaurant: UtensilsCrossed,
  takeaway: Store,
}

export const venueLabel = (venue: Venue | null): string =>
  venue === null ? 'Not recorded' : VENUE_LABELS[venue]
