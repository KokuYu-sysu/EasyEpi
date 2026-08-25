import { useEffect, useState, type PropsWithChildren } from 'react'
import { Navigate } from 'react-router-dom'

import { Skeleton } from '@renderer/components/ui'
import { syncAdminSession, useAdminSession } from '@renderer/stores/admin-session.store'

export function AdminRouteGuard({ children }: PropsWithChildren) {
  const authenticated = useAdminSession((state) => state.authenticated)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let active = true
    void syncAdminSession().finally(() => {
      if (active) setChecking(false)
    })
    return () => {
      active = false
    }
  }, [])

  if (checking) {
    return <Skeleton className="h-24" statusText="正在验证管理员会话" />
  }
  if (!authenticated) {
    return <Navigate to="/admin/login" replace />
  }
  return <>{children}</>
}
