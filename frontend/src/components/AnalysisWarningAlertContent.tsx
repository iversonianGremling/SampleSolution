type AnalysisWarningAlertContentProps = {
  totalWithWarnings: number
  warningMessages: string[]
  phase: 'analysis' | 're-analysis'
}

export function AnalysisWarningAlertContent({
  totalWithWarnings,
  warningMessages,
  phase,
}: AnalysisWarningAlertContentProps) {
  const phaseLabel = phase === 'analysis' ? 'analysis' : 're-analysis'

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300">
        Warning: {totalWithWarnings} sample(s) had potential custom state before {phaseLabel}.
      </p>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-surface-border bg-surface-base/50 px-3 py-2">
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
          {warningMessages.map((message, index) => (
            <li key={`${index}-${message}`}>{message}</li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-slate-400">
        Existing custom tags are left as-is by default; only AI-managed tag suggestions are refreshed.
      </p>
    </div>
  )
}
