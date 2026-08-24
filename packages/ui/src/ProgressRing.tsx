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
  children,
}: {
  value: number
  max: number
  size?: number
  strokeWidth?: number
  trackColor?: string
  color?: string
  children?: ReactNode
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const dashOffset = circumference * (1 - fraction)

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
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  )
}
