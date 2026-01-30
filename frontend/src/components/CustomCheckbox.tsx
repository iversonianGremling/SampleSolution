import { Check, Minus } from 'lucide-react'

interface CustomCheckboxProps {
  checked: boolean
  indeterminate?: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onClick?: (e: React.MouseEvent) => void
  className?: string
  title?: string
}

export function CustomCheckbox({
  checked,
  indeterminate = false,
  onChange,
  onClick,
  className = '',
  title,
}: CustomCheckboxProps) {
  const handleLabelClick = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  return (
    <label
      className={`relative inline-flex items-center cursor-pointer ${className}`}
      title={title}
      onClick={handleLabelClick}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onClick={onClick}
        className="sr-only peer"
      />
      <div
        className={`
          w-5 h-5 rounded-md border-2 transition-all duration-200 ease-in-out flex items-center justify-center
          peer-focus:ring-2 peer-focus:ring-offset-2 peer-focus:ring-offset-gray-900 peer-focus:ring-indigo-500/50
          ${
            checked || indeterminate
              ? 'bg-gradient-to-br from-indigo-500 to-purple-600 border-indigo-500 shadow-lg shadow-indigo-500/30'
              : 'bg-gray-800 border-gray-600 hover:border-indigo-400 hover:shadow-md hover:shadow-indigo-500/10'
          }
        `}
      >
        {indeterminate ? (
          <Minus
            size={14}
            className="text-white transition-all duration-150 ease-in-out"
            strokeWidth={3}
          />
        ) : checked ? (
          <Check
            size={14}
            className="text-white transition-all duration-150 ease-in-out scale-110"
            strokeWidth={3}
          />
        ) : null}
      </div>
    </label>
  )
}
