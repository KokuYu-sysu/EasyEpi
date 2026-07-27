import { useState } from 'react'

import { Button, Input } from '@renderer/components/ui'

interface FileSelectorProps {
  onFileSelected: (qesFilePath: string) => void
  disabled?: boolean
}

export function FileSelector({ onFileSelected, disabled }: FileSelectorProps) {
  const [filePath, setFilePath] = useState('')
  const [error, setError] = useState<string | undefined>()

  const handleBrowse = async () => {
    const result = await window.easyEpi.dialog.selectFile([
      { name: 'EpiData Questionnaire', extensions: ['qes'] }
    ])
    const selectedPath = result.filePaths[0]
    if (result.canceled || selectedPath === undefined) return

    setFilePath(selectedPath)
    setError(undefined)
    try {
      const validation = await window.easyEpi.epidata.validate({ qesFilePath: selectedPath })
      if (!validation.valid) {
        setError(validation.errors.join(', '))
        return
      }
      onFileSelected(selectedPath)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  return (
    <div className="grid gap-[var(--space-3)] sm:grid-cols-[1fr_auto] sm:items-end">
      <Input
        label="EpiData 问卷文件 (.qes)"
        value={filePath}
        readOnly
        placeholder="请选择 .qes 文件"
        disabled={disabled}
        error={error}
      />
      <Button onClick={handleBrowse} disabled={disabled}>
        选择文件
      </Button>
    </div>
  )
}
