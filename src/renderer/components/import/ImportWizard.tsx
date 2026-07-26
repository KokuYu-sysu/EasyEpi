import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import { FileSelector } from './FileSelector'
import { ImportPreview } from './ImportPreview'
import { MappingEditor } from './MappingEditor'
import type { ImportPreview as ImportPreviewType, ImportProgress, QESField } from '@shared/types/epidata'
import type { QuestionDef } from '@shared/types/qnaire'

type Step = 'select' | 'preview' | 'mapping' | 'importing' | 'complete'

interface ImportWizardProps {
  onComplete: (projectPath: string) => void
  onCancel: () => void
}

export function ImportWizard({ onComplete, onCancel }: ImportWizardProps) {
  const [step, setStep] = useState<Step>('select')
  const [qesFilePath, setQesFilePath] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreviewType | null>(null)
  const [qesFields, setQesFields] = useState<QESField[]>([])
  const [mappedQuestions, setMappedQuestions] = useState<QuestionDef[]>([])
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileSelected = async (filePath: string) => {
    setQesFilePath(filePath)
    try {
      const previewResult = await window.easyEpi.epidata.preview({ qesFilePath: filePath })
      setPreview(previewResult)
      setStep('preview')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handlePreviewNext = async () => {
    if (!qesFilePath) return
    
    // Parse QES file to get fields for mapping
    try {
      // For now, we'll use the preview data
      // In a real implementation, we would parse the QES file to get fields
      setStep('mapping')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleMappingNext = async () => {
    if (!qesFilePath) return
    
    setStep('importing')
    setError(null)
    
    // Set up progress listener
    window.easyEpi.epidata.onImportProgress((progress) => {
      setImportProgress(progress)
    })
    
    try {
      // Call import API
      const result = await window.easyEpi.epidata.import({
        qesFilePath,
        targetProjectPath: '/path/to/target' // This should come from user input
      })
      
      if (result.success) {
        setStep('complete')
      } else {
        setError(result.errors.join(', '))
        setStep('mapping')
      }
    } catch (err) {
      setError((err as Error).message)
      setStep('mapping')
    } finally {
      // Clean up progress listener
      window.easyEpi.epidata.offImportProgress()
    }
  }

  const handleMappingChange = (fieldIndex: number, question: Partial<QuestionDef>) => {
    const newQuestions = [...mappedQuestions]
    newQuestions[fieldIndex] = { ...newQuestions[fieldIndex], ...question } as QuestionDef
    setMappedQuestions(newQuestions)
  }

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>Import EpiData Project</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress indicator */}
        <div className="flex justify-between">
          {(['select', 'preview', 'mapping', 'importing', 'complete'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`flex items-center ${
                step === s ? 'text-primary font-semibold' : 'text-muted-foreground'
              }`}
            >
              <span className="mr-2">{i + 1}.</span>
              <span className="capitalize">{s}</span>
            </div>
          ))}
        </div>

        {/* Step content */}
        {step === 'select' && (
          <FileSelector onFileSelected={handleFileSelected} />
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4">
            <ImportPreview preview={preview} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('select')}>
                Back
              </Button>
              <Button onClick={handlePreviewNext}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-4">
            <MappingEditor
              qesFields={qesFields}
              mappedQuestions={mappedQuestions}
              onMappingChange={handleMappingChange}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('preview')}>
                Back
              </Button>
              <Button onClick={handleMappingNext}>
                Import
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4">
            <Progress value={importProgress ? (importProgress.current / importProgress.total) * 100 : 0} />
            <p className="text-center text-muted-foreground">
              {importProgress?.message || 'Importing...'}
            </p>
          </div>
        )}

        {step === 'complete' && (
          <div className="space-y-4 text-center">
            <p className="text-lg font-semibold text-green-600">
              Import Complete!
            </p>
            <Button onClick={() => onComplete('/path/to/project')}>
              Open Project
            </Button>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Cancel button */}
        {step !== 'importing' && step !== 'complete' && (
          <div className="flex justify-start">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}