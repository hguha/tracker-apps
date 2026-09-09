// @tracker-engine/ui — token-driven UI kit. Apps supply the design tokens
// (--color-accent, --color-surface, …) their Tailwind config maps to these classes.
export { Button } from './Button'
export { Card } from './Card'
export { ProgressRing } from './ProgressRing'
export { PillSelect } from './PillSelect'
export { AccentPicker } from './AccentPicker'
export { BottomSheet } from './BottomSheet'
export { ToastProvider, useToast } from './Toast'
export { SwipeableRow, useRowTap, type SwipeAction } from './SwipeableRow'
export { DragList, DragItem, useDragList, type DropIntent } from './DragList'
export { ErrorBoundary } from './ErrorBoundary'
export { Screen, ScreenHeader } from './ScreenHeader'
export { NavRow, NavList } from './NavRow'
export { FilterSheet, FilterChipButton, type FilterOption } from './FilterSheet'
export { SearchField } from './SearchField'
export { SegmentedTabs, type SegmentedTab } from './SegmentedTabs'
export { AppearanceCard, type ThemeOption } from './AppearanceCard'
export { BadgeTile, BadgeDetailSheet, BadgeGrid, type BadgeView } from './Badges'
export { TabBar, type TabDefinition } from './TabBar'
export {
  createAppearance,
  resolveScheme,
  type AppearanceSettings,
  type ColorScheme,
  type ColorSchemePreference,
  type ThemePreset,
} from './appearance'
export { useColorScheme, useAppearanceKey, resolveColor } from './useColorScheme'

// Charts live behind ./charts so an app that has none doesn't pull in echarts.
