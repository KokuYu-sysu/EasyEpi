import { useNavigate } from 'react-router-dom'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { ImportWizard } from '@renderer/components/import/ImportWizard'

export function ImportPage() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle()
  if (handle === null) throw new Error('IMPORT_ROUTE_METADATA_MISSING')

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '导入 EpiData 3.1 问卷和数据文件。'}
    >
      <ImportWizard
        onComplete={() => navigate('/designer')}
        onCancel={() => navigate('/')}
      />
    </MilestonePage>
  )
}
