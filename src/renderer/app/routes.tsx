import { createHashRouter, type RouteObject } from 'react-router-dom'

import { AppShell } from './AppShell'
import { ComponentGalleryPage } from '@renderer/pages/ComponentGalleryPage'
import { NotFoundPage } from '@renderer/pages/NotFoundPage'
import { RouteErrorPage } from '@renderer/pages/RouteErrorPage'
import { RoutePlaceholderPage } from '@renderer/pages/RoutePlaceholderPage'

export interface ProductionRouteDefinition { path: string; title: string; description: string }

export const PRODUCTION_ROUTES: ProductionRouteDefinition[] = [
  { path: '/', title: '欢迎页', description: '选择项目并开始现场调查。' },
  { path: '/designer', title: '问卷设计', description: '组织题目、规则与问卷结构。' },
  { path: '/import', title: 'EpiData 导入', description: '导入并核对 EpiData 问卷结构。' },
  { path: '/entry', title: '单题录入', description: '以一题一屏方式完成现场录入。' },
  { path: '/work-session', title: '工作循环', description: '查看调查工作的标准循环。' },
  { path: '/admin/login', title: '管理员验证', description: '了解后续安全管理入口。' },
  { path: '/admin/data', title: '数据管理', description: '查看合成记录与管理操作。' },
  { path: '/admin/baseline', title: '基线表', description: '管理基线字段结构。' },
  { path: '/derived', title: '衍生变量', description: '配置由已有字段计算的变量。' }
]

export interface CreateAppRouterOptions { isDevelopment: boolean }

export function createAppRoutes({ isDevelopment }: CreateAppRouterOptions): RouteObject[] {
  const productionRoutes: RouteObject[] = PRODUCTION_ROUTES.map((route) => ({
    path: route.path,
    handle: { title: route.title },
    element: <RoutePlaceholderPage title={route.title} description={route.description} />
  }))
  const developmentRoutes: RouteObject[] = isDevelopment ? [{ path: '/__components', handle: { title: '组件展厅' }, element: <ComponentGalleryPage /> }] : []
  return [{ element: <AppShell />, errorElement: <RouteErrorPage />, children: [...productionRoutes, ...developmentRoutes, { path: '*', element: <NotFoundPage /> }] }]
}

export function createAppRouter(options: CreateAppRouterOptions) {
  return createHashRouter(createAppRoutes(options))
}
