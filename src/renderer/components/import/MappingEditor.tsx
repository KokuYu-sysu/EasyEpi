import { Badge, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui'
import type { QESField } from '@shared/types/epidata'
import type { QuestionDef, QuestionType } from '@shared/types/qnaire'
import { QUESTION_TYPE_LABELS } from '@shared/types/qnaire'

interface MappingEditorProps {
  qesFields: QESField[]
  mappedQuestions: QuestionDef[]
  onMappingChange: (fieldName: string, questionType: QuestionType) => void
}

const typeOptions = Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))

export function MappingEditor({ qesFields, mappedQuestions, onMappingChange }: MappingEditorProps) {
  return (
    <div className="grid gap-[var(--space-3)]">
      <h3 className="m-0 text-[length:var(--font-size-lg)]">字段映射</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>变量名</TableHead>
            <TableHead>问题文本</TableHead>
            <TableHead>原始类型</TableHead>
            <TableHead>EasyEpi 题型</TableHead>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {qesFields.map((field, index) => {
            const question = mappedQuestions[index]
            return (
              <TableRow key={field.name}>
                <TableCell className="font-mono">{field.name}</TableCell>
                <TableCell>{field.label}</TableCell>
                <TableCell><Badge>{field.type}</Badge></TableCell>
                <TableCell>
                  <Select
                    label={`${field.name} 映射题型`}
                    value={question?.type ?? 'free_text'}
                    onValueChange={(value) => onMappingChange(field.name, value as QuestionType)}
                    options={typeOptions}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={question === undefined ? 'danger' : 'success'}>
                    {question === undefined ? '未映射' : '已映射'}
                  </Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
