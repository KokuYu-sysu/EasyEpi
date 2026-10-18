import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions
} from 'docx'
import type { DocumentQuestion, QuestionnaireDocument } from './questionnaire-document'

// Embedded PNG outlines keep the option shapes independent of installed symbol fonts.
const CIRCLE =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYBAMAAAASWSDLAAAAMFBMVEVMaXEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACbsZG/AAAAD3RSTlMAnOi3IHaCDWzMAf0zMALGJ0nKAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAhElEQVQYlWNgQAcewoYtMPbh/5qT/ttA2M82hTAwuGpngdh88uIgqvDjAgYGBravEAXxCQwMDKcFIBzGvQwMDEYFEA67MgMDC1QVA0O0AwPHFxjHv4GBUQHGYRJgYJ4A43AaoHJQlKEYgGI0iqWozkFxKIoXGJYheY6B4TLI27bYAgQOAFIzJHTUlG5PAAAAAElFTkSuQmCC'
const SQUARE =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYBAMAAAASWSDLAAAADFBMVEVMaXEAAAAAAAAAAAAykov8AAAABHRSTlMAwPCQxo+CIwAAAAlwSFlzAAALEwAACxMBAJqcGAAAACZJREFUGJVjYEAGzIJwYMDAqAhjCwkwMArA1DAOdw6yt1ECBBkAAHkyBbdA6X27AAAAAElFTkSuQmCC'
const CELL_WIDTH = 340
const CELLS_PER_ROW = 28
const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' }

function textRuns(text: string, options: Omit<IRunOptions, 'text' | 'break'> = {}): TextRun[] {
  return text.split(/\r\n|\r|\n/).map(
    (line, index) =>
      new TextRun({
        ...options,
        text: line,
        ...(index > 0 ? { break: 1 } : {})
      })
  )
}

function answerParagraphs(question: DocumentQuestion): (Paragraph | Table)[] {
  if (question.type === 'single_choice' || question.type === 'multiple_choice') {
    return question.options.map(
      (option) =>
        new Paragraph({
          indent: { left: 225 },
          spacing: { before: 50, after: 60 },
          children: [
            new ImageRun({
              type: 'png',
              data: Buffer.from(question.type === 'single_choice' ? CIRCLE : SQUARE, 'base64'),
              transformation: { width: 14, height: 14 },
              altText: {
                title: question.type === 'single_choice' ? '单选圆框' : '多选方框',
                description: '空白选项标记',
                name: 'option'
              }
            }),
            ...textRuns(`  ${option.label}`)
          ]
        })
    )
  }
  if (question.type === 'fixed_length') {
    const tables: (Paragraph | Table)[] = []
    for (let offset = 0; offset < question.fixedLength!; offset += CELLS_PER_ROW) {
      const count = Math.min(CELLS_PER_ROW, question.fixedLength! - offset)
      tables.push(
        new Table({
          layout: TableLayoutType.FIXED,
          width: { size: CELL_WIDTH * count, type: WidthType.DXA },
          columnWidths: Array.from({ length: count }, () => CELL_WIDTH),
          rows: [
            new TableRow({
              cantSplit: true,
              height: { value: 397, rule: HeightRule.EXACT },
              children: Array.from(
                { length: count },
                () =>
                  new TableCell({
                    width: { size: CELL_WIDTH, type: WidthType.DXA },
                    margins: { top: 0, bottom: 0, left: 0, right: 0 },
                    borders: { top: border, bottom: border, left: border, right: border },
                    children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })]
                  })
              )
            })
          ]
        })
      )
      // OOXML requires a paragraph between distinct tables and after the final table.
      tables.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }))
    }
    return tables
  }
  if (question.type === 'date') {
    return [
      new Paragraph({ text: '________ 年 ____ 月 ____ 日', spacing: { before: 100, after: 100 } })
    ]
  }
  return [
    new Paragraph({
      children: [],
      border: { bottom: border },
      spacing: { before: 180, after: 100 }
    }),
    ...(question.rangeHint
      ? [new Paragraph({ children: [new TextRun({ text: question.rangeHint, size: 18 })] })]
      : [])
  ]
}

export async function createQuestionnaireDocx(model: QuestionnaireDocument): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 250 },
      children: textRuns(model.name, { bold: true, size: 40 })
    })
  ]
  if (model.description)
    children.push(new Paragraph({ children: textRuns(model.description), spacing: { after: 300 } }))
  for (const question of model.questions) {
    for (const note of question.notes) {
      children.push(
        new Paragraph({
          keepNext: true,
          spacing: { before: 100, after: 60 },
          children: textRuns(note, { size: 18 })
        })
      )
    }
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 180, after: 100 },
        children: textRuns(`${question.number}. ${question.content}`, { bold: question.isKey })
      }),
      ...answerParagraphs(question)
    )
  }
  return Packer.toBuffer(
    new Document({
      title: model.name,
      styles: {
        default: {
          document: {
            run: { font: { name: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' }, size: 22 },
            paragraph: { spacing: { line: 320 } }
          }
        }
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 }
            }
          },
          children
        }
      ]
    })
  )
}
