import { useEffect, useRef, useState, type ReactNode } from 'react'

export type MenuItem = {
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
}

type Props = {
  label: ReactNode
  title?: string
  items: Array<MenuItem | 'separator'>
  align?: 'left' | 'right'
  className?: string
}

export function Menu({ label, title, items, align = 'left', className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className={`menu menu-${align}`} ref={ref}>
      <button
        type="button"
        className={`small-button menu-trigger ${className}`}
        onClick={() => setOpen((value) => !value)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label} <span className="menu-caret">▾</span>
      </button>

      {open && (
        <div className="menu-popover" role="menu">
          {items.map((item, index) =>
            item === 'separator' ? (
              <div className="menu-separator" key={`separator-${index}`} />
            ) : (
              <button
                type="button"
                className="menu-item"
                key={`${item.label}-${index}`}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
              >
                <span className="menu-item-label">{item.label}</span>
                {item.hint && <span className="menu-item-hint">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
