import { Plus, X } from 'lucide-react'
import {
  createDefaultFilterRule,
  FILTER_RULE_FIELDS,
  getDefaultOperatorForField,
  getFilterRuleField,
  getFilterRuleOperators,
  getFilterRuleRangeLabel,
  getFilterRuleSuggestions,
  normalizeOperatorForField,
  type FilterRule,
  type FilterRuleFieldId,
  type FilterRuleJoin,
  type FilterRuleOperator,
  type FilterRuleSuggestionMap,
} from '../utils/filterRuleQuery'

interface SourcesRuleFilterBuilderProps {
  rules: FilterRule[]
  onChange: (rules: FilterRule[]) => void
  suggestions?: FilterRuleSuggestionMap
}

export function SourcesRuleFilterBuilder({
  rules,
  onChange,
  suggestions = {},
}: SourcesRuleFilterBuilderProps) {
  const handleAddRule = () => {
    onChange([...rules, createDefaultFilterRule(rules.length)])
  }

  const handleRemoveRule = (ruleId: string) => {
    onChange(rules.filter((rule) => rule.id !== ruleId))
  }

  const handleUpdateRule = (ruleId: string, updates: Partial<FilterRule>) => {
    onChange(
      rules.map((rule) => {
        if (rule.id !== ruleId) return rule
        const nextRule = { ...rule, ...updates }
        nextRule.operator = normalizeOperatorForField(nextRule.field, nextRule.operator)
        return nextRule
      })
    )
  }

  return (
    <div className="rounded-lg border border-surface-border bg-surface-raised p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Query Conditions</div>
          <p className="text-xs text-slate-400 mt-1">
            Build rules with <span className="text-slate-300">AND</span> and <span className="text-slate-300">OR</span>.
          </p>
        </div>
        <button
          onClick={handleAddRule}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
        >
          <Plus size={12} />
          Add condition
        </button>
      </div>

      {rules.length === 0 && (
        <div className="text-xs text-slate-500 rounded border border-surface-border bg-surface-base px-3 py-2">
          No conditions yet. Try <span className="text-slate-300">BPM &gt;= 120</span> or <span className="text-slate-300">Collection includes "Drums"</span>.
        </div>
      )}

      {rules.length > 0 && (
        <div className="space-y-2">
          {rules.map((rule, index) => {
            const field = getFilterRuleField(rule.field)
            const operators = getFilterRuleOperators(rule.field)
            const valueSuggestions = getFilterRuleSuggestions(rule.field, suggestions[rule.field] || [])
            const datalistId = `rule-suggestions-${rule.id}`
            const rangeLabel = getFilterRuleRangeLabel(rule.field)
            const isNumeric = field.type === 'number'
            const isEnumSelect = field.type === 'enum' && valueSuggestions.length > 0
            const inputPlaceholder = isNumeric
              ? [field.min, field.max].every((value) => typeof value === 'number')
                ? `${field.min} - ${field.max}${field.unit ? ` ${field.unit}` : ''}`
                : `Value${field.unit ? ` (${field.unit})` : ''}`
              : 'Value...'

            return (
              <div key={rule.id} className="rounded border border-surface-border bg-surface-base p-2 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {index > 0 ? (
                    <select
                      value={rule.joinWithPrevious}
                      onChange={(e) => handleUpdateRule(rule.id, { joinWithPrevious: e.target.value as FilterRuleJoin })}
                      className="px-2 py-1 text-[11px] rounded border border-surface-border bg-surface-raised text-slate-200 focus:outline-none focus:border-accent-primary"
                      title="Join with previous condition"
                    >
                      <option value="AND">AND</option>
                      <option value="OR">OR</option>
                    </select>
                  ) : (
                    <span className="px-2 py-1 text-[11px] rounded border border-surface-border bg-surface-raised text-slate-400">IF</span>
                  )}

                  <select
                    value={rule.field}
                    onChange={(e) => {
                      const fieldId = e.target.value as FilterRuleFieldId
                      handleUpdateRule(rule.id, {
                        field: fieldId,
                        operator: getDefaultOperatorForField(fieldId),
                        value: '',
                      })
                    }}
                    className="px-2 py-1 text-xs rounded border border-surface-border bg-surface-raised text-slate-200 focus:outline-none focus:border-accent-primary"
                    title="Field"
                  >
                    {FILTER_RULE_FIELDS.map((fieldOption) => (
                      <option key={fieldOption.id} value={fieldOption.id}>
                        {fieldOption.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={normalizeOperatorForField(rule.field, rule.operator)}
                    onChange={(e) => handleUpdateRule(rule.id, { operator: e.target.value as FilterRuleOperator })}
                    className="px-2 py-1 text-xs rounded border border-surface-border bg-surface-raised text-slate-200 focus:outline-none focus:border-accent-primary"
                    title="Operator"
                  >
                    {operators.map((operator) => (
                      <option key={operator.id} value={operator.id}>
                        {operator.label}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1 flex-1 min-w-[180px]">
                    {isEnumSelect ? (
                      <select
                        value={rule.value}
                        onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                        className="flex-1 px-2 py-1 text-xs rounded border border-surface-border bg-surface-raised text-white focus:outline-none focus:border-accent-primary"
                        title="Value"
                      >
                        <option value="">Select...</option>
                        {valueSuggestions.map((value) => (
                          <option key={`${rule.id}-${value}`} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <input
                          type={isNumeric ? 'number' : 'text'}
                          value={rule.value}
                          onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                          placeholder={inputPlaceholder}
                          list={valueSuggestions.length > 0 ? datalistId : undefined}
                          className="flex-1 px-2 py-1 text-xs rounded border border-surface-border bg-surface-raised text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
                          min={typeof field.min === 'number' ? field.min : undefined}
                          max={typeof field.max === 'number' ? field.max : undefined}
                          step={isNumeric ? field.step ?? 0.01 : undefined}
                        />
                        {valueSuggestions.length > 0 && (
                          <datalist id={datalistId}>
                            {valueSuggestions.map((value) => (
                              <option key={`${rule.id}-${value}`} value={value} />
                            ))}
                          </datalist>
                        )}
                      </>
                    )}
                    {field.unit && (
                      <span className="px-2 py-1 text-[11px] rounded bg-surface-raised border border-surface-border text-slate-400 whitespace-nowrap">
                        {field.unit}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleRemoveRule(rule.id)}
                    className="p-1 text-slate-500 hover:text-red-300 transition-colors"
                    title="Remove condition"
                  >
                    <X size={12} />
                  </button>
                </div>

                {rangeLabel && (
                  <div className="text-[11px] text-slate-500">{rangeLabel}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
