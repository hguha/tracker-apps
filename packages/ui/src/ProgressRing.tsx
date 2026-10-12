/**
 * A circular progress ring — an SVG donut with a value in the middle. Pure and
 * presentational: it draws `value/max` of a stroked circle and renders whatever
 * children sit in the center. Over-completion (value > max) clamps the arc at full
 * rather than winding past 12 o'clock, but the caller can still show "6/5".
 */

import type { ReactNode } from 'react'

export function ProgressRing({
  value,
  max,
  size = 120,
  strokeWidth = 12,
  /** Track (unfilled) color. */
  trackColor = 'var(--surface-sunken)',
  /** Progress arc color. */
  color = 'var(--accent)',
  from = 0,
  fromColor = `color-mix(in srgb, ${color} 32%, transparent)`,
  children,
}: {
  value: number
  max: number
  size?: number
  strokeWidth?: number
  trackColor?: string
  color?: string
  from?: number
  fromColor?: string
  children?: ReactNode
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const share = (amount: number) => (max > 0 ? Math.min(1, Math.max(0, amount / max)) : 0)
  const base = share(from)
  const fraction = share(value)
  const arc = (start: number, end: number, stroke: string, cap: 'round' | 'butt') => (
    <circle
      cx={size / 2}
      cy={size / 2}
      r={radius}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap={cap}
      strokeDasharray={`${(end - start) * circumference} ${circumference}`}
      strokeDashoffset={-start * circumference}
      className="transition-[stroke-dasharray,stroke-dashoffset] duration-500 ease-out"
    />
  )

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {base > 0 && arc(0, base, fromColor, 'butt')}
        {fraction > base && arc(base, fraction, color, base > 0 ? 'butt' : 'round')}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  )
}
