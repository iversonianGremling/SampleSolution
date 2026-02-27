import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, ChevronDown, ChevronRight, Square } from 'lucide-react'
import {
  SAMPLE_SEARCH_CUSTOM_FIELD_OPTIONS,
  SAMPLE_SEARCH_SCOPE_OPTIONS,
  type SampleSearchCustomField,
  type SampleSearchScope,
} from '../utils/sampleSearch'

const MENU_POINTER_DISTANCE_CLOSE_PX = 220

function getDistanceToRect(x: number, y: number, rect: DOMRect): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right)
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  return Math.hypot(dx, dy)
}

interface SampleSearchScopeMenuProps {
  searchScope: SampleSearchScope
  searchScopeHint: string
  customSearchFields: SampleSearchCustomField[]
  onScopeChange: (scope: SampleSearchScope) => void
  onToggleCustomField: (field: SampleSearchCustomField) => void
  onResetCustomFields: () => void
  triggerTourId?: string
}

export function SampleSearchScopeMenu({
  searchScope,
  searchScopeHint,
  customSearchFields,
  onScopeChange,
  onToggleCustomField,
  onResetCustomFields,
  triggerTourId,
}: SampleSearchScopeMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const activeScopeLabel = useMemo(
    () => SAMPLE_SEARCH_SCOPE_OPTIONS.find((option) => option.value === searchScope)?.label ?? 'All fields',
    [searchScope],
  )

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const handleMouseMove = (event: MouseEvent) => {
      const menuRect = menuRef.current?.getBoundingClientRect()
      const dropdownRect = dropdownRef.current?.getBoundingClientRect()
      const distances = [menuRect, dropdownRect]
        .filter((rect): rect is DOMRect => Boolean(rect))
        .map((rect) => getDistanceToRect(event.clientX, event.clientY, rect))

      if (distances.length === 0) return

      const closestDistance = Math.min(...distances)
      if (closestDistance > MENU_POINTER_DISTANCE_CLOSE_PX) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
    }
  }, [isOpen])

  return (
    <div ref={menuRef} className="absolute inset-y-0 right-1 z-20 flex items-center">
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          data-tour={triggerTourId}
          className="inline-flex h-7 max-w-[170px] items-center gap-1 rounded-md border border-surface-border bg-surface-base px-2 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
          title={searchScopeHint}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <span className="truncate">{activeScopeLabel}</span>
          <ChevronDown size={12} className={`${isOpen ? 'rotate-180' : ''} transition-transform`} />
        </button>

        {isOpen && (
          <div
            ref={dropdownRef}
            className="absolute right-0 top-full mt-1 min-w-[170px] overflow-visible rounded-md border border-surface-border bg-surface-raised py-0 shadow-xl"
          >
            {SAMPLE_SEARCH_SCOPE_OPTIONS.map((option) => {
              const isActive = searchScope === option.value
              const isCustomOption = option.value === 'custom'

              return (
                <div key={option.value} className={isCustomOption ? 'group/custom relative' : ''}>
                  <button
                    type="button"
                    onClick={() => {
                      onScopeChange(option.value)
                      if (!isCustomOption) {
                        setIsOpen(false)
                      }
                    }}
                    className={`flex h-7 w-full items-center justify-between px-2.5 text-left text-[11px] transition-colors ${
                      isActive
                        ? 'bg-accent-primary/15 text-accent-primary'
                        : 'text-text-secondary hover:bg-surface-base hover:text-text-primary'
                    }`}
                    role="menuitem"
                  >
                    <span>{option.label}</span>
                    {isCustomOption && <ChevronRight size={12} className="text-text-muted" />}
                  </button>

                  {isCustomOption && (
                    <div className="absolute left-full top-0 -ml-px hidden min-w-[190px] overflow-hidden rounded-md border border-surface-border bg-surface-raised py-0 shadow-xl group-hover/custom:block group-focus-within/custom:block">
                      {SAMPLE_SEARCH_CUSTOM_FIELD_OPTIONS.map((fieldOption) => {
                        const isSelected = customSearchFields.includes(fieldOption.value)
                        return (
                          <button
                            key={fieldOption.value}
                            type="button"
                            onClick={() => {
                              onScopeChange('custom')
                              onToggleCustomField(fieldOption.value)
                            }}
                            className="flex h-7 w-full items-center gap-2 px-2.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-surface-base hover:text-text-primary"
                            title={`Include ${fieldOption.label.toLowerCase()} in custom search`}
                          >
                            {isSelected ? (
                              <CheckSquare size={13} className="shrink-0 text-accent-primary" />
                            ) : (
                              <Square size={13} className="shrink-0 text-text-muted" />
                            )}
                            <span>{fieldOption.label}</span>
                          </button>
                        )
                      })}
                      <div className="h-px bg-surface-border" />
                      <button
                        type="button"
                        onClick={() => {
                          onScopeChange('custom')
                          onResetCustomFields()
                        }}
                        className="h-7 w-full px-2.5 text-left text-[11px] text-text-muted transition-colors hover:bg-surface-base hover:text-text-secondary"
                        title="Reset custom search fields"
                      >
                        Reset fields
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
