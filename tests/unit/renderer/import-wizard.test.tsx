import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { ImportWizard } from '@renderer/components/import/ImportWizard'
import { QESFieldType } from '@shared/types/epidata'

describe('ImportWizard', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'easyEpi')
  })

  it('collects a real target project configuration and opens the returned project path', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    let progressListener: ((progress: {
      stage: 'importing_data'
      current: number
      total: number
      message: string
    }) => void) | undefined
    const qesFields = [
      {
        name: 'age',
        label: 'Participant age',
        type: QESFieldType.INTEGER,
        length: 3,
        decimals: 0,
        comment: null
      }
    ]
    const mappedQuestions = [
      {
        id: 'age-id',
        content: 'Participant age',
        variableName: 'age',
        type: 'numeric_range' as const,
        options: [],
        constraint: { type: 'integer' as const },
        isKey: false,
        allowSkip: true,
        order: 0
      }
    ]
    const importMock = vi.fn(async () => {
      progressListener?.({
        stage: 'importing_data',
        current: 1,
        total: 1,
        message: 'Prepared 1 of 1 record(s)'
      })
      return {
        success: true,
        projectPath: 'D:\\projects\\People.easyepi',
        recordCount: 1,
        warnings: [],
        errors: []
      }
    })
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: {
        dialog: {
          selectFile: vi.fn().mockResolvedValue({
            canceled: false,
            filePaths: ['D:\\source\\people.qes']
          }),
          selectFolder: vi.fn().mockResolvedValue({
            canceled: false,
            filePaths: ['D:\\projects']
          })
        },
        epidata: {
          validate: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
          preview: vi.fn().mockResolvedValue({
            questionnaire: { name: 'People' },
            fieldCount: 1,
            recordCount: 1,
            encoding: 'utf-8',
            warnings: [],
            fields: qesFields,
            mappedQuestions
          }),
          import: importMock,
          onImportProgress: vi.fn((callback) => {
            progressListener = callback
          }),
          offImportProgress: vi.fn()
        }
      }
    })

    render(<ImportWizard onComplete={onComplete} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    expect(await screen.findByText('People')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '下一步：检查映射' }))
    expect(screen.getByText('Participant age')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '选择目标文件夹' }))
    await user.clear(screen.getByLabelText('项目名称 *'))
    await user.type(screen.getByLabelText('项目名称 *'), 'People imported')
    await user.type(screen.getByLabelText('管理员密码 *'), 'secure-password')
    await user.type(screen.getByLabelText('确认密码 *'), 'secure-password')
    await user.click(screen.getByRole('button', { name: '开始导入' }))

    expect(await screen.findByText('导入完成')).toBeVisible()
    expect(importMock).toHaveBeenCalledWith({
      qesFilePath: 'D:\\source\\people.qes',
      targetProjectPath: 'D:\\projects',
      projectName: 'People imported',
      password: 'secure-password',
      encoding: undefined,
      fieldMappings: { age: 'numeric_range' }
    })
    await user.click(screen.getByRole('button', { name: '打开已导入项目' }))
    expect(onComplete).toHaveBeenCalledWith('D:\\projects\\People.easyepi')
  })
})
