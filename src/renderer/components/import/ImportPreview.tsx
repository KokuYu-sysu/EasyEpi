import { Card, CardContent, CardHeader, CardTitle, Badge } from '@renderer/components/ui'
import type { ImportPreview as ImportPreviewType } from '@shared/types/epidata'

interface ImportPreviewProps {
  preview: ImportPreviewType
}

export function ImportPreview({ preview }: ImportPreviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Questionnaire Name</p>
            <p className="text-lg font-semibold">{preview.questionnaire.name}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Field Count</p>
            <p className="text-lg font-semibold">{preview.fieldCount}</p>
          </div>
          {preview.recordCount !== undefined && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Record Count</p>
              <p className="text-lg font-semibold">{preview.recordCount.toLocaleString()}</p>
            </div>
          )}
          {preview.encoding && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Encoding</p>
              <Badge variant="info">{preview.encoding}</Badge>
            </div>
          )}
          {preview.version && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">EpiData Version</p>
              <Badge variant="info">{preview.version}</Badge>
            </div>
          )}
        </div>
        
        {preview.warnings.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Warnings</p>
            <ul className="list-disc list-inside space-y-1">
              {preview.warnings.map((warning, index) => (
                <li key={index} className="text-sm text-yellow-600">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
