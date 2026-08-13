import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-contrast active:brightness-90',
  secondary: 'bg-sunken text-ink border border-line active:bg-accent-wash',
  ghost: 'text-ink-secondary active:bg-sunken',
  danger: 'bg-critical text-white active:brightness-90',
}

// Every size clears a 44px touch target at md and above; sm is for chips that
// sit inside a row that is itself tappable.
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px] rounded-lg',
  md: 'h-11 px-4 text-[15px] rounded-xl',
  lg: 'h-14 px-5 text-[17px] rounded-2xl',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: Variant
  size?: Size
}) {
  return (
    <button
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 font-semibold',
        'transition-[filter,background-color] duration-100',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
