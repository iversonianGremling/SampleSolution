import { Zap, CircleDot, Sparkles } from 'lucide-react'
import type { AnalysisLevel } from '../types'

interface AnalysisLevelSelectorProps {
  value: AnalysisLevel
  onChange: (level: AnalysisLevel) => void
  className?: string
}

const ANALYSIS_LEVELS: Array<{
  value: AnalysisLevel
  label: string
  description: string
  time: string
  icon: typeof Zap
}> = [
  {
    value: 'quick',
    label: 'Quick',
    description: 'Basic features only',
    time: '~15s',
    icon: Zap,
  },
  {
    value: 'standard',
    label: 'Standard',
    description: 'BPM, key detection, spectral features',
    time: '~30s',
    icon: CircleDot,
  },
  {
    value: 'advanced',
    label: 'Advanced',
    description: 'All features including timbral & perceptual analysis',
    time: '~60s',
    icon: Sparkles,
  },
]

export function AnalysisLevelSelector({ value, onChange, className = '' }: AnalysisLevelSelectorProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      <label className="block text-sm font-medium text-white">
        Analysis Level
      </label>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {ANALYSIS_LEVELS.map((level) => {
          const Icon = level.icon
          const isSelected = value === level.value
          return (
            <button
              key={level.value}
              onClick={() => onChange(level.value)}
              className={`
                relative p-4 rounded-lg border-2 transition-all text-left
                ${
                  isSelected
                    ? 'border-accent-primary bg-accent-primary/10'
                    : 'border-surface-border bg-surface-raised hover:border-surface-border/60'
                }
              `}
            >
              <div className="flex items-start gap-3">
                <Icon
                  size={20}
                  className={`flex-shrink-0 mt-0.5 ${
                    isSelected ? 'text-accent-primary' : 'text-slate-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                      {level.label}
                    </span>
                    <span className="text-xs text-slate-500">{level.time}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-tight">
                    {level.description}
                  </p>
                </div>
              </div>
              {isSelected && (
                <div className="absolute top-2 right-2">
                  <div className="w-2 h-2 rounded-full bg-accent-primary" />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
