import { createHashRouter, type RouteObject } from 'react-router-dom'

import { AppShell } from './AppShell'
import type { AppRouteHandle } from './route-metadata'
import { ComponentGalleryPage } from '@renderer/pages/ComponentGalleryPage'
import { NotFoundPage } from '@renderer/pages/NotFoundPage'
import { RouteErrorPage } from '@renderer/pages/RouteErrorPage'
import { RoutePlaceholderPage } from '@renderer/pages/RoutePlaceholderPage'

export interface ProductionRouteDefinition {
  path: string
  handle: AppRouteHandle & { placeholder: NonNullable<AppRouteHandle['placeholder']> }
}

const placeholder = (description: string): NonNullable<AppRouteHandle['placeholder']> => ({
  title: '演示骨架，后续任务替换',
  description
})

export const PRODUCTION_ROUTES: ProductionRouteDefinition[] = [
  { path: '/', handle: { title: '欢迎页', description: '选择项目并开始现场调查。', placeholder: placeholder('此路由已接入统一应用框架；欢迎页交互将在后续任务中实现。') } },
  { path: '/designer', handle: { title: '问卷设计', description: '组织题目、规则与问卷结构。', placeholder: placeholder('此路由已接入统一应用框架；问卷设计交互将在后续任务中实现。') } },
  { path: '/import', handle: { title: 'EpiData 导入', description: '导入并核对 EpiData 问卷结构。', placeholder: placeholder('此路由已接入统一应用框架；导入骨架将在后续任务中实现。') } },
  { path: '/entry', handle: { title: '单题录入', description: '以一题一屏方式完成现场录入。', placeholder: placeholder('此路由已接入统一应用框架；单题录入交互将在后续任务中实现。') } },
  { path: '/work-session', handle: { title: '工作循环', description: '查看调查工作的标准循环。', placeholder: placeholder('此路由已接入统一应用框架；工作循环骨架将在后续任务中实现。') } },
  { path: '/admin/login', handle: { title: '管理员验证', description: '了解后续安全管理入口。', placeholder: placeholder('此路由已接入统一应用框架；管理员验证骨架将在后续任务中实现。') } },
  { path: '/admin/data', handle: { title: '数据管理', description: '查看合成记录与管理操作。', placeholder: placeholder('此路由已接入统一应用框架；数据管理交互将在后续任务中实现。') } },
  { path: '/admin/baseline', handle: { title: '基线表', description: '管理基线字段结构。', placeholder: placeholder('此路由已接入统一应用框架；基线表骨架将在后续任务中实现。') } },
  { path: '/derived', handle: { title: '衍生变量', description: '配置由已有字段计算的变量。', placeholder: placeholder('此路由已接入统一应用框架；衍生变量骨架将在后续任务中实现。') } }
]

export interface CreateAppRouterOptions { isDevelopment: boolean }

export function createAppRoutes({ isDevelopment }: CreateAppRouterOptions): RouteObject[] {
  const productionRoutes: RouteObject[] = PRODUCTION_ROUTES.map((route) => ({
    path: route.path,
    handle: route.handle,
    element: <RoutePlaceholderPage />
  }))
  const developmentRoutes: RouteObject[] = isDevelopment ? [{ path: '/__components', handle: { title: '组件展厅' } satisfies AppRouteHandle, element: <ComponentGalleryPage /> }] : []
  return [{ element: <AppShell />, errorElement: <RouteErrorPage />, children: [...productionRoutes, ...developmentRoutes, { path: '*', handle: { title: '页面未找到' } satisfies AppRouteHandle, element: <NotFoundPage /> }] }]
}

export function createAppRouter(options: CreateAppRouterOptions) {
  return createHashRouter(createAppRoutes(options))
}
