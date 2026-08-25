import {
  Calculator,
  CaseUpper,
  Database,
  FilePenLine,
  Home,
  ListChecks,
  LockKeyhole,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Sparkles,
  SunMoon,
  TableProperties,
  Upload
} from 'lucide-react'
import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'

import { Button, Tooltip } from '@renderer/components/ui'
import { SettingsDialog } from '@renderer/components/common/SettingsDialog'
import { BackupDialog } from '@renderer/components/common/BackupDialog'
import { usePreferencesStore } from '@renderer/stores/preferences-store'
import {
  clearAdminSession,
  syncAdminSession,
  useAdminSession
} from '@renderer/stores/admin-session.store'
import { useCurrentRouteHandle } from './route-metadata'

export interface NavigationItem {
  path: string
  title: string
  description: string
  icon: ReactNode
  requiresAdmin?: boolean
}

export const NAVIGATION_ITEMS: NavigationItem[] = [
  { path: '/', title: '欢迎页', description: '项目选择与开始', icon: <Home /> },
  { path: '/designer', title: '问卷设计', description: '设计调查问卷', icon: <FilePenLine /> },
  { path: '/import', title: 'EpiData 导入', description: '导入问卷结构', icon: <Upload /> },
  { path: '/entry', title: '单题录入', description: '现场逐题录入', icon: <ListChecks /> },
  { path: '/work-session', title: '工作循环', description: '调查工作流程', icon: <RefreshCw /> },
  { path: '/ai-assistant', title: 'AI 问卷助手', description: '对话生成问卷', icon: <Sparkles /> },
  { path: '/admin/login', title: '管理员验证', description: '管理入口演示', icon: <LockKeyhole /> },
  { path: '/admin/data', title: '数据管理', description: '查看合成记录', icon: <Database />, requiresAdmin: true },
  { path: '/admin/baseline', title: '基线表', description: '基线结构管理', icon: <TableProperties />, requiresAdmin: true },
  { path: '/derived', title: '衍生变量', description: '配置计算变量', icon: <Calculator />, requiresAdmin: true }
]

function NavigationLinks({
  collapsed = false,
  onNavigate
}: {
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const authenticated = useAdminSession((state) => state.authenticated)
  const navigationItems = authenticated
    ? NAVIGATION_ITEMS
    : NAVIGATION_ITEMS.filter((item) => !item.requiresAdmin)

  return (
    <ul className="m-0 grid list-none gap-[var(--space-1)] p-0">
      {navigationItems.map((item) => (
        <li key={item.path}>
          <NavLink
            aria-label={item.title}
            onClick={onNavigate}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              [
                'flex min-h-11 items-center gap-[var(--space-3)] rounded-[var(--radius-1)] px-[var(--space-3)] text-[var(--color-text-primary)] no-underline',
                isActive
                  ? 'bg-[var(--color-brand-soft)] font-[var(--font-weight-semibold)]'
                  : 'hover:bg-[var(--color-surface-sunken)]'
              ].join(' ')
            }
          >
            <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center">
              {item.icon}
            </span>
            <span className={collapsed ? 'sr-only' : undefined}>{item.title}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

export function AppShell({ children }: PropsWithChildren) {
  const routeHandle = useCurrentRouteHandle()
  const navigate = useNavigate()
  const preferences = usePreferencesStore((state) => state.desired)
  const setPreferences = usePreferencesStore((state) => state.setPreferences)
  const [compactOpen, setCompactOpen] = useState(false)
  const authenticated = useAdminSession((state) => state.authenticated)
  const expiresAt = useAdminSession((state) => state.expiresAt)
  const wasAuthenticated = useRef(authenticated)
  const mainContentRef = useRef<HTMLElement>(null)
  const currentTitle = routeHandle?.title ?? 'EasyEpi'
  const nextTheme =
    preferences.theme === 'system'
      ? 'light'
      : preferences.theme === 'light'
        ? 'dark'
        : 'system'

  useEffect(() => {
    void syncAdminSession()
  }, [])

  useEffect(
    () =>
      window.easyEpi.project.onClosed?.(() => {
        clearAdminSession()
        void syncAdminSession()
      }),
    []
  )

  useEffect(() => {
    if (
      wasAuthenticated.current &&
      !authenticated &&
      routeHandle?.requiresAdmin
    ) {
      navigate('/admin/login', { replace: true })
    }
    wasAuthenticated.current = authenticated
  }, [authenticated, navigate, routeHandle?.requiresAdmin])

  useEffect(() => {
    if (!authenticated || expiresAt === null) return
    const synchronizeAtExpiry = () => {
      void syncAdminSession().then((valid) => {
        if (!valid && routeHandle?.requiresAdmin) {
          navigate('/admin/login', { replace: true })
        }
      })
    }
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) {
      synchronizeAtExpiry()
      return
    }
    const timer = window.setTimeout(synchronizeAtExpiry, remaining)
    return () => window.clearTimeout(timer)
  }, [authenticated, expiresAt, navigate, routeHandle?.requiresAdmin])

  return (
    <div className="min-h-screen bg-[var(--color-surface-canvas)] text-[var(--color-text-primary)]">
      <a
        href="#main-content"
        className="fixed left-[var(--space-3)] top-[var(--space-3)] z-[var(--z-4)] -translate-y-24 rounded-[var(--radius-1)] bg-[var(--color-surface-raised)] p-[var(--space-3)] focus:translate-y-0"
        onClick={(event) => {
          event.preventDefault()
          mainContentRef.current?.focus()
        }}
      >
        跳到主内容
      </a>
      <div className="grid min-h-screen grid-cols-1 min-[1050px]:grid-cols-[auto_minmax(0,1fr)]">
        <aside
          data-collapsed={preferences.sidebarCollapsed}
          className="hidden w-64 border-r border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-3)] data-[collapsed=true]:w-20 min-[1050px]:block"
        >
          <Link className="mb-[var(--space-5)] flex items-center gap-[var(--space-2)] p-[var(--space-2)] text-[var(--color-text-primary)] no-underline" to="/">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-[var(--radius-2)] bg-[var(--color-brand)] font-bold text-[var(--color-on-brand)]">E</span>
            <strong className={preferences.sidebarCollapsed ? 'sr-only' : undefined}>EasyEpi</strong>
          </Link>
          <nav aria-label="主要导航" data-collapsed={preferences.sidebarCollapsed}>
            <NavigationLinks collapsed={preferences.sidebarCollapsed} />
          </nav>
          <Tooltip content={preferences.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}>
            <Button
              className="mt-[var(--space-4)] w-full"
              variant="ghost"
              aria-label={preferences.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
              onClick={() =>
                setPreferences({ sidebarCollapsed: !preferences.sidebarCollapsed })
              }
            >
              {preferences.sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              <span className={preferences.sidebarCollapsed ? 'sr-only' : undefined}>{preferences.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}</span>
            </Button>
          </Tooltip>
        </aside>

        <div className="min-w-0">
          <header className="flex min-h-16 flex-wrap items-center gap-[var(--space-2)] border-b border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-[var(--space-4)] py-[var(--space-2)]">
            <div className="relative min-[1050px]:hidden">
              <Tooltip
                content={`打开导航菜单，显示全部${authenticated ? '十' : '七'}个页面入口`}
              >
                <Button
                  variant="ghost"
                  aria-label={compactOpen ? '关闭导航菜单' : '打开导航菜单'}
                  aria-expanded={compactOpen}
                  onClick={() => setCompactOpen((open) => !open)}
                >
                  <Menu aria-hidden="true" />
                </Button>
              </Tooltip>
              {compactOpen ? (
                <nav
                  aria-label="紧凑导航"
                  className="absolute left-0 top-full z-[var(--z-3)] mt-[var(--space-2)] max-h-[70vh] w-72 overflow-auto rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] p-[var(--space-2)] shadow-[var(--shadow-z3)]"
                >
                  <NavigationLinks onNavigate={() => setCompactOpen(false)} />
                </nav>
              ) : null}
            </div>
            <Link className="mr-auto text-[var(--color-text-primary)] no-underline min-[1050px]:hidden" to="/"><strong>EasyEpi</strong></Link>
            <p className="m-0 mr-auto font-[var(--font-weight-semibold)]">{currentTitle}</p>
            <Button
              variant="ghost"
              aria-label={`切换主题，当前${preferences.theme}`}
              onClick={() => setPreferences({ theme: nextTheme })}
            >
              <SunMoon aria-hidden="true" size={20} />
              <span className="hidden xl:inline">主题</span>
            </Button>
            <Button
              variant="ghost"
              aria-label={`${preferences.largeText ? '关闭' : '启用'}大字模式`}
              aria-pressed={preferences.largeText}
              onClick={() => setPreferences({ largeText: !preferences.largeText })}
            >
              <CaseUpper aria-hidden="true" size={20} />
              <span className="hidden xl:inline">大字</span>
            </Button>
            <BackupDialog />
            <SettingsDialog />
          </header>
          <main ref={mainContentRef} id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1500px] p-[var(--space-5)] max-sm:p-[var(--space-3)]">
            {children ?? <Outlet />}
          </main>
        </div>
      </div>
    </div>
  )
}
