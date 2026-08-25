import { useState } from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Progress, Select } from '@renderer/components/ui'
import { clearAdminSession, syncAdminSession } from '@renderer/stores/admin-session.store'
import type { ImportPreview as ImportPreviewType, ImportProgress } from '@shared/types/epidata'
import type { QuestionDef, QuestionType } from '@shared/types/qnaire'

import { FileSelector } from './FileSelector'
import { ImportPreview } from './ImportPreview'
import { MappingEditor } from './MappingEditor'

type Step = 'select' | 'preview' | 'mapping' | 'importing' | 'complete'

interface ImportWizardProps {
  onComplete: (projectPath: string) => void
  onCancel: () => void
}

export function ImportWizard({ onComplete, onCancel }: ImportWizardProps) {
  const [step, setStep] = useState<Step>('select')
  const [qesFilePath, setQesFilePath] = useState('')
  const [preview, setPreview] = useState<ImportPreviewType>()
  const [mappedQuestions, setMappedQuestions] = useState<QuestionDef[]>([])
  const [targetFolder, setTargetFolder] = useState('')
  const [projectName, setProjectName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [encoding, setEncoding] = useState('auto')
  const [importProgress, setImportProgress] = useState<ImportProgress>()
  const [completedPath, setCompletedPath] = useState('')
  const [error, setError] = useState<string>()

  const handleFileSelected = async (filePath: string) => {
    setQesFilePath(filePath)
    setError(undefined)
    try {
      const result = await window.easyEpi.epidata.preview({
        qesFilePath: filePath,
        encoding: encoding === 'auto' ? undefined : encoding
      })
      setPreview(result)
      setMappedQuestions(result.mappedQuestions)
      setProjectName(result.questionnaire.name || 'Imported EpiData project')
      setStep('preview')
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  const selectTargetFolder = async () => {
    const result = await window.easyEpi.dialog.selectFolder()
    const selected = result.filePaths[0]
    if (!result.canceled && selected !== undefined) setTargetFolder(selected)
  }

  const handleMappingChange = (fieldName: string, questionType: QuestionType) => {
    setMappedQuestions((questions) =>
      questions.map((question) =>
        question.variableName === fieldName ? { ...question, type: questionType } : question
      )
    )
  }

  const validateProjectSettings = (): boolean => {
    if (projectName.trim().length === 0) return thisFail('请输入项目名称')
    if (targetFolder.length === 0) return thisFail('请选择目标文件夹')
    if (password.length < 6) return thisFail('管理员密码至少 6 位')
    if (password !== confirmPassword) return thisFail('两次密码不一致')
    return true
  }

  const thisFail = (message: string): false => {
    setError(message)
    return false
  }

  const startImport = async () => {
    if (!validateProjectSettings() || preview === undefined) return
    setStep('importing')
    setError(undefined)
    clearAdminSession()
    window.easyEpi.epidata.onImportProgress(setImportProgress)
    try {
      const result = await window.easyEpi.epidata.import({
        qesFilePath,
        targetProjectPath: targetFolder,
        projectName: projectName.trim(),
        password,
        encoding: encoding === 'auto' ? undefined : encoding,
        fieldMappings: Object.fromEntries(
          mappedQuestions.map((question) => [question.variableName, question.type])
        )
      })
      if (!result.success) return thisFailAndReturn(result.errors.join(', '))
      setCompletedPath(result.projectPath)
      setStep('complete')
    } catch (caught) {
      thisFailAndReturn((caught as Error).message)
    } finally {
      window.easyEpi.epidata.offImportProgress()
      await syncAdminSession()
    }
  }

  const thisFailAndReturn = (message: string): void => {
    setError(message)
    setStep('mapping')
  }

  const percent = importProgress === undefined || importProgress.total === 0
    ? 0
    : (importProgress.current / importProgress.total) * 100

  return (
    <Card className="mx-auto max-w-4xl">
      <CardHeader><CardTitle>EpiData 导入</CardTitle></CardHeader>
      <CardContent className="grid gap-[var(--space-5)]">
        <ol aria-label="导入步骤" className="grid grid-cols-5 gap-[var(--space-2)] text-center text-[length:var(--font-size-sm)]">
          {['选择文件', '预览', '字段映射', '导入', '完成'].map((label, index) => (
            <li key={label} className={index === ['select', 'preview', 'mapping', 'importing', 'complete'].indexOf(step) ? 'font-bold text-[var(--color-brand)]' : 'text-[var(--color-text-muted)]'}>
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        {step === 'select' && (
          <div className="grid gap-[var(--space-4)]">
            <Select
              label="文件编码"
              value={encoding}
              onValueChange={setEncoding}
              options={[
                { value: 'auto', label: '自动检测' },
                { value: 'utf-8', label: 'UTF-8' },
                { value: 'gbk', label: 'GBK' },
                { value: 'latin1', label: 'Latin-1' }
              ]}
            />
            <FileSelector onFileSelected={handleFileSelected} />
          </div>
        )}

        {step === 'preview' && preview !== undefined && (
          <div className="grid gap-[var(--space-4)]">
            <ImportPreview preview={preview} />
            <div className="flex justify-end gap-[var(--space-3)]">
              <Button variant="secondary" onClick={() => setStep('select')}>返回</Button>
              <Button onClick={() => setStep('mapping')}>下一步：检查映射</Button>
            </div>
          </div>
        )}

        {step === 'mapping' && preview !== undefined && (
          <div className="grid gap-[var(--space-4)]">
            <MappingEditor
              qesFields={preview.fields}
              mappedQuestions={mappedQuestions}
              onMappingChange={handleMappingChange}
            />
            <Input label="项目名称 *" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            <div className="grid gap-[var(--space-2)] sm:grid-cols-[1fr_auto] sm:items-end">
              <Input label="目标文件夹 *" value={targetFolder} readOnly />
              <Button variant="secondary" onClick={selectTargetFolder}>选择目标文件夹</Button>
            </div>
            <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
              <Input label="管理员密码 *" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <Input label="确认密码 *" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            <div className="flex justify-end gap-[var(--space-3)]">
              <Button variant="secondary" onClick={() => setStep('preview')}>返回</Button>
              <Button onClick={startImport}>开始导入</Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <Progress
            label="导入进度"
            value={percent}
            valueLabel={`${Math.round(percent)}%`}
            valueText={importProgress?.message}
          />
        )}

        {step === 'complete' && (
          <div className="grid justify-items-center gap-[var(--space-4)] text-center">
            <h3 className="m-0 text-[length:var(--font-size-xl)] text-[var(--color-success)]">导入完成</h3>
            <p className="m-0 break-all text-[var(--color-text-secondary)]">{completedPath}</p>
            <Button onClick={() => onComplete(completedPath)}>打开已导入项目</Button>
          </div>
        )}

        {error !== undefined && <p role="alert" className="m-0 text-[var(--color-danger)]">{error}</p>}
        {step !== 'importing' && step !== 'complete' && (
          <Button className="justify-self-start" variant="ghost" onClick={onCancel}>取消</Button>
        )}
      </CardContent>
    </Card>
  )
}
