import { Search, X } from 'lucide-react'

/** A search box with a clear button. 16px text, because anything smaller makes iOS zoom. */
export function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoFocus?: boolean
}) {
  return (
    <div className="flex h-11 items-center gap-2 rounded-xl bg-sunken px-3">
      <Search size={17} className="shrink-0 text-ink-muted" />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-muted"
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search">
          <X size={17} className="text-ink-muted" />
        </button>
      )}
    </div>
  )
}
