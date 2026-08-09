/**
 * Enum slugs to display labels.
 *
 * `horizontal_push` → `Horizontal push`. Sentence case, not title case: these are
 * prose labels in tables and detail rows, not headings. There were three copies
 * of this with two different casings, so the same movement pattern read
 * "Horizontal Push" on Insights and "Horizontal push" on the exercise sheet.
 */
export function humanizeSlug(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
