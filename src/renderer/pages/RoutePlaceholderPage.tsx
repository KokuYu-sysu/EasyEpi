import { EmptyState } from '@renderer/components/ui'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { useCurrentRouteHandle } from '@renderer/app/route-metadata'

export function RoutePlaceholderPage() {
  const handle = useCurrentRouteHandle()
  if (handle?.placeholder === undefined) {
    throw new Error('ROUTE_PLACEHOLDER_METADATA_MISSING')
  }
  return (
    <MilestonePage title={handle.title} description={handle.description ?? handle.placeholder.description}>
      <EmptyState
        title={handle.placeholder.title}
        description={handle.placeholder.description}
      />
    </MilestonePage>
  )
}
