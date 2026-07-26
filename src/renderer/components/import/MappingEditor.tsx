import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Button } from '@renderer/components/ui'
import type { QESField } from '@shared/types/epidata'
import type { QuestionDef } from '@shared/types/qnaire'

interface MappingEditorProps {
  qesFields: QESField[]
  mappedQuestions: QuestionDef[]
  onMappingChange: (fieldIndex: number, question: Partial<QuestionDef>) => void
}

export function MappingEditor({ qesFields, mappedQuestions, onMappingChange }: MappingEditorProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Field Mapping</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Variable Name</TableHead>
            <TableHead>Original Type</TableHead>
            <TableHead>Mapped To</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {qesFields.map((field, index) => {
            const question = mappedQuestions[index]
            const needsAttention = !question || (question.type === 'free_text' && field.type !== 'TEXT')
            
            return (
              <TableRow key={index}>
                <TableCell className="font-mono">{field.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{field.type}</Badge>
                </TableCell>
                <TableCell>
                  {question ? (
                    <Badge>{question.type}</Badge>
                  ) : (
                    <Badge variant="destructive">Not Mapped</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {needsAttention ? (
                    <Badge variant="warning">⚠️ Needs Attention</Badge>
                  ) : (
                    <Badge variant="success">✅ Auto-mapped</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onMappingChange(index, { type: 'free_text' })}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}