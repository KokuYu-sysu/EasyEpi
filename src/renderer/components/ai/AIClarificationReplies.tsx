import { Button } from '@renderer/components/ui'
import type { AIPublicClarification } from '@shared/ai-assistant-contract'

interface AIClarificationRepliesProps {
  clarification: AIPublicClarification
  enabled: boolean
  onSelect: (clarificationId: string, optionId: string) => void
}

export function AIClarificationReplies({
  clarification,
  enabled,
  onSelect
}: AIClarificationRepliesProps) {
  const interactive = enabled && clarification.status === 'unresolved'

  return (
    <div className="mt-[var(--space-3)] flex flex-wrap gap-[var(--space-2)]" aria-label="补充问题选项">
      {clarification.options.slice(0, 5).map((option) => (
        <Button
          key={option.id}
          size="sm"
          variant="secondary"
          disabled={!interactive}
          aria-pressed={clarification.selectedOptionId === option.id}
          onClick={() => onSelect(clarification.clarificationId, option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
