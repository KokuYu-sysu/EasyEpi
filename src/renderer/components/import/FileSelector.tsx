import { useState } from 'react'
import { Button, Input, Label } from '@renderer/components/ui'

interface FileSelectorProps {
  onFileSelected: (qesFilePath: string) => void
  disabled?: boolean
}

export function FileSelector({ onFileSelected, disabled }: FileSelectorProps) {
  const [filePath, setFilePath] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleBrowse = async () => {
    // Use Electron dialog
    const result = await window.easyEpi.dialog.selectFile([
      { name: 'EpiData Questionnaire', extensions: ['qes'] },
      { name: 'All Files', extensions: ['*'] }
    ])

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]
      setFilePath(selectedPath)
      setError(null)
      
      // Validate the file
      try {
        const validation = await window.easyEpi.epidata.validate({ qesFilePath: selectedPath })
        if (validation.valid) {
          onFileSelected(selectedPath)
        } else {
          setError(validation.errors.join(', '))
        }
      } catch (err) {
        setError((err as Error).message)
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="qes-file">EpiData Questionnaire File (.qes)</Label>
        <div className="flex gap-2">
          <Input
            id="qes-file"
            value={filePath}
            readOnly
            placeholder="Select a .qes file..."
            disabled={disabled}
          />
          <Button onClick={handleBrowse} disabled={disabled}>
            Browse
          </Button>
        </div>
      </div>
      
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}