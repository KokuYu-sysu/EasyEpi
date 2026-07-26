import React from 'react'
import { useNavigate } from 'react-router-dom'
import { ImportWizard } from '@renderer/components/import/ImportWizard'

export function ImportPage() {
  const navigate = useNavigate()

  const handleComplete = (projectPath: string) => {
    // Navigate to the project
    navigate(`/project/${encodeURIComponent(projectPath)}`)
  }

  const handleCancel = () => {
    navigate(-1)
  }

  return (
    <div className="container mx-auto py-8">
      <ImportWizard onComplete={handleComplete} onCancel={handleCancel} />
    </div>
  )
}