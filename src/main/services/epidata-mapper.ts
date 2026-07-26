import { QESField, QESFieldType, QESParseResult } from '@shared/types/epidata'
import { QuestionDef, QuestionType, QuestionnaireDef, ConstraintType, OptionItem } from '@shared/types/qnaire'

export class EpiDataMapper {
  mapFieldToQuestion(field: QESField): QuestionDef {
    const type = this.mapFieldType(field.type)
    const constraint = this.mapConstraint(field)
    const options = this.mapOptions(field)

    return {
      id: this.generateId(),
      content: field.label || field.name,
      variableName: field.name,
      type,
      options,
      constraint,
      isKey: false,
      allowSkip: true,
      order: 0
    }
  }

  mapQESToQuestionnaire(result: QESParseResult): QuestionnaireDef {
    const questions = result.fields.map((field, index) => {
      const question = this.mapFieldToQuestion(field)
      question.order = index
      return question
    })

    return {
      questions,
      conditionRules: [],
      keyQuestionIds: [],
      name: result.metadata.title || 'Imported Questionnaire',
      description: result.metadata.description
    }
  }

  private mapFieldType(qesType: QESFieldType): QuestionType {
    switch (qesType) {
      case QESFieldType.INTEGER:
      case QESFieldType.DECIMAL:
        return 'numeric_range'
      case QESFieldType.TEXT:
        return 'free_text'
      case QESFieldType.UPPERCASE:
        return 'fixed_length'
      case QESFieldType.BOOLEAN:
        return 'single_choice'
      case QESFieldType.DATE_DMY:
      case QESFieldType.DATE_MDY:
        return 'date'
      default:
        return 'free_text'
    }
  }

  private mapConstraint(field: QESField): { type: ConstraintType; fixedLength?: number; minValue?: number; maxValue?: number } {
    switch (field.type) {
      case QESFieldType.INTEGER:
        return { type: 'integer' }
      case QESFieldType.DECIMAL:
        return { type: 'decimal' }
      case QESFieldType.UPPERCASE:
        return { type: 'english', fixedLength: field.length }
      default:
        return { type: 'none' }
    }
  }

  private mapOptions(field: QESField): OptionItem[] {
    if (field.type === QESFieldType.BOOLEAN) {
      return [
        { value: '1', label: 'Yes' },
        { value: '0', label: 'No' }
      ]
    }
    return []
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15)
  }
}