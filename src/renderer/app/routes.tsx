import { createHashRouter, type RouteObject } from 'react-router-dom'

import { AppShell } from './AppShell'
import type { AppRouteHandle } from './route-metadata'
import { ComponentGalleryPage } from '@renderer/pages/ComponentGalleryPage'
import { AdminLoginPage } from '@renderer/pages/AdminLoginPage'
import { BaselinePage } from '@renderer/pages/BaselinePage'
import { DerivedPage } from '@renderer/pages/DerivedPage'
import { ImportPage } from '@renderer/pages/ImportPage'
import { NotFoundPage } from '@renderer/pages/NotFoundPage'
import { RouteErrorPage } from '@renderer/pages/RouteErrorPage'
import { RoutePlaceholderPage } from '@renderer/pages/RoutePlaceholderPage'
import { WelcomePage } from '@renderer/pages/WelcomePage'
import { WorkSessionPage } from '@renderer/pages/WorkSessionPage'

export interface ProductionRouteDefinition {
  path: string
  handle: AppRouteHandle
}

const placeholder = (description: string): NonNullable<AppRouteHandle['placeholder']> => ({
  title: '演示骨架，后续任务替换',
  description
})

export const PRODUCTION_ROUTES: ProductionRouteDefinition[] = [
  { path: '/', handle: { title: '欢迎页', description: '选择项目并开始现场调查。' } },
  { path: '/designer', handle: { title: '问卷设计', description: '组织题目、规则与问卷结构。', placeholder: placeholder('此路由已接入统一应用框架；问卷设计交互将在后续任务中实现。') } },
  { path: '/import', handle: { title: 'EpiData 导入', description: '导入并核对 EpiData 问卷结构。' } },
  { path: '/entry', handle: { title: '单题录入', description: '以一题一屏方式完成现场录入。', placeholder: placeholder('此路由已接入统一应用框架；单题录入交互将在后续任务中实现。') } },
  { path: '/work-session', handle: { title: '工作循环', description: '查看调查工作的标准循环。' } },
  { path: '/admin/login', handle: { title: '管理员验证', description: '了解后续安全管理入口。' } },
  { path: '/admin/data', handle: { title: '数据管理', description: '查看合成记录与管理操作。', placeholder: placeholder('此路由已接入统一应用框架；数据管理交互将在后续任务中实现。') } },
  { path: '/admin/baseline', handle: { title: '基线表', description: '管理基线字段结构。' } },
  { path: '/derived', handle: { title: '衍生变量', description: '配置由已有字段计算的变量。' } }
]

const taskNineElements: Record<string, React.ReactElement> = {
  '/': <WelcomePage />,
  '/import': <ImportPage />,
  '/work-session': <WorkSessionPage />,
  '/admin/login': <AdminLoginPage />,
  '/admin/baseline': <BaselinePage />,
  '/derived': <DerivedPage />
}

export interface CreateAppRouterOptions { isDevelopment: boolean }

export function createAppRoutes({ isDevelopment }: CreateAppRouterOptions): RouteObject[] {
  const productionRoutes: RouteObject[] = PRODUCTION_ROUTES.map((route) => ({
    path: route.path,
    handle: route.handle,
    element: taskNineElements[route.path] ?? <RoutePlaceholderPage />
  }))
  const developmentRoutes: RouteObject[] = isDevelopment ? [{ path: '/__components', handle: { title: '组件展厅' } satisfies AppRouteHandle, element: <ComponentGalleryPage /> }] : []
  return [{ element: <AppShell />, errorElement: <RouteErrorPage />, children: [...productionRoutes, ...developmentRoutes, { path: '*', handle: { title: '页面未找到' } satisfies AppRouteHandle, element: <NotFoundPage /> }] }]
}

export function createAppRouter(options: CreateAppRouterOptions) {
  return createHashRouter(createAppRoutes(options))
}
