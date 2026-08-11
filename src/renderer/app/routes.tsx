import { createHashRouter, type RouteObject } from 'react-router-dom'

import { AppShell } from './AppShell'
import type { AppRouteHandle } from './route-metadata'
import { ComponentGalleryPage } from '@renderer/pages/ComponentGalleryPage'
import { AdminLoginPage } from '@renderer/pages/AdminLoginPage'
import { AdminDashboard } from '@renderer/pages/AdminDashboard'
import { BaselinePage } from '@renderer/pages/BaselinePage'
import { DerivedPage } from '@renderer/pages/DerivedPage'
import { DesignerPage } from '@renderer/pages/DesignerPage'
import { DoubleEntryPage } from '@renderer/pages/DoubleEntryPage'
import { EntryPage } from '@renderer/pages/EntryPage'
import { ImportPage } from '@renderer/pages/ImportPage'
import { NotFoundPage } from '@renderer/pages/NotFoundPage'
import { RouteErrorPage } from '@renderer/pages/RouteErrorPage'
import { WelcomePage } from '@renderer/pages/WelcomePage'
import { WorkSessionPage } from '@renderer/pages/WorkSessionPage'

export interface ProductionRouteDefinition {
  path: string
  handle: AppRouteHandle
}

export const PRODUCTION_ROUTES: ProductionRouteDefinition[] = [
  { path: '/', handle: { title: '欢迎页', description: '选择项目并开始现场调查。' } },
  { path: '/designer', handle: { title: '问卷设计', description: '组织题目、规则与问卷结构。' } },
  {
    path: '/import',
    handle: { title: 'EpiData 导入', description: '导入并核对 EpiData 问卷结构。' }
  },
  { path: '/entry', handle: { title: '单题录入', description: '以一题一屏方式完成现场录入。' } },
  { path: '/work-session', handle: { title: '工作循环', description: '查看调查工作的标准循环。' } },
  { path: '/admin/login', handle: { title: '管理员验证', description: '使用当前项目密码进入数据管理后台。' } },
  { path: '/admin/data', handle: { title: '数据管理', description: '查看、编辑、删除和导出当前项目的加密记录。' } },
  { path: '/admin/baseline', handle: { title: '基线表', description: '生成分组描述统计与统计检验。' } },
  { path: '/admin/double-entry', handle: { title: '双录入验证', description: '导入次录入 CSV 并与当前数据逐字段比对。' } },
  { path: '/derived', handle: { title: '衍生变量', description: '配置由已有字段计算的变量。' } }
]

const implementedRouteElements: Record<string, React.ReactElement> = {
  '/': <WelcomePage />,
  '/designer': <DesignerPage />,
  '/entry': <EntryPage />,
  '/import': <ImportPage />,
  '/work-session': <WorkSessionPage />,
  '/admin/login': <AdminLoginPage />,
  '/admin/data': <AdminDashboard />,
  '/admin/baseline': <BaselinePage />,
  '/admin/double-entry': <DoubleEntryPage />,
  '/derived': <DerivedPage />
}

export interface CreateAppRouterOptions {
  isDevelopment: boolean
}

export function createAppRoutes({ isDevelopment }: CreateAppRouterOptions): RouteObject[] {
  const productionRoutes: RouteObject[] = PRODUCTION_ROUTES.map((route) => ({
    path: route.path,
    handle: route.handle,
    element: implementedRouteElements[route.path]
  }))
  const developmentRoutes: RouteObject[] = isDevelopment
    ? [
        {
          path: '/__components',
          handle: { title: '组件展厅' } satisfies AppRouteHandle,
          element: <ComponentGalleryPage />
        }
      ]
    : []
  return [
    {
      element: <AppShell />,
      errorElement: <RouteErrorPage />,
      children: [
        ...productionRoutes,
        ...developmentRoutes,
        {
          path: '*',
          handle: { title: '页面未找到' } satisfies AppRouteHandle,
          element: <NotFoundPage />
        }
      ]
    }
  ]
}

export function createAppRouter(options: CreateAppRouterOptions) {
  return createHashRouter(createAppRoutes(options))
}
