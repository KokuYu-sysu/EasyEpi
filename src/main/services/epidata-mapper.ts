import { randomUUID } from 'node:crypto'

import { QESFieldType } from '@shared/types/epidata'
import type { QESField, QESParseResult } from '@shared/types/epidata'
import type {
  ConstraintDef,
  OptionItem,
  QuestionDef,
  QuestionnaireDef,
  QuestionType
} from '@shared/types/qnaire'

export type FieldMappingOverrides = Record<string, QuestionType>

export class EpiDataMapper {
  mapFieldToQuestion(field: QESField, overrideType?: QuestionType): QuestionDef {
    const type = overrideType ?? this.mapFieldType(field.type)
    return {
      id: randomUUID(),
      content: field.label || field.name,
      variableName: field.name,
      type,
      options: this.mapOptions(field, type),
      constraint: this.mapConstraint(field, type),
      isKey: field.type === QESFieldType.ID_NUMBER,
      allowSkip: field.type !== QESFieldType.ID_NUMBER,
      order: 0
    }
  }

  mapQESToQuestionnaire(
    result: QESParseResult,
    overrides: FieldMappingOverrides = {}
  ): QuestionnaireDef {
    const questions = result.fields.map((field, index) => {
      const question = this.mapFieldToQuestion(field, overrides[field.name])
      question.order = index
      return question
    })
    return {
      questions,
      conditionRules: [],
      keyQuestionIds: questions.filter((question) => question.isKey).map((question) => question.id),
      name: result.metadata.title || 'Imported Questionnaire'
    }
  }

  private mapFieldType(type: QESFieldType): QuestionType {
    switch (type) {
      case QESFieldType.INTEGER:
      case QESFieldType.DECIMAL:
      case QESFieldType.ID_NUMBER:
        return 'numeric_range'
      case QESFieldType.UPPERCASE:
      case QESFieldType.SOUNDEX:
        return 'fixed_length'
      case QESFieldType.BOOLEAN:
        return 'single_choice'
      case QESFieldType.DATE_DMY:
      case QESFieldType.DATE_MDY:
      case QESFieldType.TODAY_DATE:
        return 'date'
      case QESFieldType.TEXT:
      default:
        return 'free_text'
    }
  }

  private mapConstraint(field: QESField, questionType: QuestionType): ConstraintDef {
    if (questionType === 'date') return { type: 'date' }
    if (questionType === 'numeric_range') {
      return { type: field.type === QESFieldType.DECIMAL ? 'decimal' : 'integer' }
    }
    if (questionType === 'fixed_length') {
      return {
        type: field.type === QESFieldType.UPPERCASE ? 'english' : 'alphanumeric',
        fixedLength: field.length
      }
    }
    return { type: 'none' }
  }

  private mapOptions(field: QESField, questionType: QuestionType): OptionItem[] {
    if (field.valueLabels !== undefined && field.valueLabels.length > 0) {
      return field.valueLabels
    }
    if (field.type === QESFieldType.BOOLEAN || questionType === 'single_choice') {
      return [
        { value: 'Y', label: 'Yes' },
        { value: 'N', label: 'No' }
      ]
    }
    return []
  }
}
