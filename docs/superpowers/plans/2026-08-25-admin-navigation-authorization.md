# 管理员导航与访问控制收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只有当前项目的管理员会话有效时，才显示并允许访问「数据管理」「基线表」「衍生变量」及其管理子页面。

**Architecture:** 主进程 `AdminSessionService` 继续作为唯一授权事实源；渲染进程新增只读镜像 Store，用于导航和路由即时响应。`AdminRouteGuard` 负责页面入口，现有 IPC handler 继续负责敏感操作，项目创建、打开、导入和关闭时由主进程主动使旧管理员会话失效。

**Tech Stack:** Electron 43、React 18、React Router 7、Zustand 5、TypeScript 5.9、Vitest 4、Playwright 1.61。

## Global Constraints

- 未验证时仅显示「管理员验证」，不得渲染「数据管理」「基线表」「衍生变量」。
- 管理员会话空闲超时保持 30 分钟，由主进程决定有效性和 `expiresAt`。
- 主动退出、切换项目、导入新项目、项目锁定或关闭应用后立即失效。
- `/admin/data`、`/admin/baseline`、`/admin/double-entry`、`/derived` 必须使用路由守卫；IPC 授权不得依赖界面状态。
- 密码错误计数和 5 分钟锁定仍只由主进程管理。
- 不新增管理密码或 Token 的渲染进程持久化。

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/renderer/stores/admin-session-store.tsx` | 管理员会话镜像、过期检查、Provider 与 hooks |
| `src/renderer/app/AdminRouteGuard.tsx` | 保护管理路由并处理加载/重定向 |
| `src/renderer/app/AppShell.tsx` | 按会话状态筛选桌面和紧凑导航 |
| `src/renderer/App.tsx` | 注入 `AdminSessionProvider` |
| `src/renderer/app/routes.tsx` | 将管理页面包裹在路由守卫中 |
| `src/renderer/pages/AdminLoginPage.tsx` | 登录成功后同步渲染进程会话 |
| `src/renderer/pages/AdminDashboard.tsx` | 退出和授权错误时同步清空会话 |
| `src/main/ipc/project.ipc.ts` | 项目创建、打开、关闭时触发会话失效回调 |
| `src/main/ipc/epidata.ipc.ts` | 导入项目成功时触发会话失效回调 |
| `src/main/index.ts` | 以同一个 `AdminSessionService` 连接项目生命周期和管理 IPC |

---

### Task 1: Renderer Admin Session Store

**Files:**
- Create: `src/renderer/stores/admin-session-store.tsx`
- Create: `tests/unit/renderer/stores/admin-session-store.test.tsx`

**Interfaces:**
- Consumes: `DesktopApi['admin']`, `AdminLoginResult`, `AdminSessionResult`。
- Produces: `AdminSessionProvider`, `useAdminSessionStore(selector)`, `AdminSessionState.refresh()`, `acceptLogin()`, `logout()`, `invalidate()`。

- [ ] **Step 1: Write the failing store tests**

```tsx
it('mirrors the main-process session and never extends it locally', async () => {
  const checkSession = vi.fn().mockResolvedValue({
    isAuthenticated: true,
    expiresAt: 1_900_000
  })
  const store = createAdminSessionStore({ checkSession, logout: vi.fn() }, () => 100_000)
  await store.getState().refresh()
  expect(store.getState()).toMatchObject({ status: 'ready', isAuthenticated: true, expiresAt: 1_900_000 })
  expect(checkSession).toHaveBeenCalledTimes(1)
})

it('clears authentication when the authoritative check fails', async () => {
  const api = { checkSession: vi.fn().mockResolvedValue({ isAuthenticated: false }), logout: vi.fn() }
  const store = createAdminSessionStore(api, () => 100_000)
  store.getState().acceptLogin({ success: true, expiresAt: 1_900_000 })
  await store.getState().refresh()
  expect(store.getState()).toMatchObject({ isAuthenticated: false, expiresAt: null })
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm vitest run tests/unit/renderer/stores/admin-session-store.test.tsx`

Expected: FAIL because `createAdminSessionStore` does not exist.

- [ ] **Step 3: Implement the store and Provider**

```tsx
export interface AdminSessionState {
  status: 'loading' | 'ready'
  isAuthenticated: boolean
  expiresAt: number | null
  refresh(): Promise<void>
  acceptLogin(result: AdminLoginResult): void
  logout(): Promise<void>
  invalidate(): void
}

export function createAdminSessionStore(
  api: Pick<DesktopApi['admin'], 'checkSession' | 'logout'>,
  now: () => number = Date.now
): StoreApi<AdminSessionState> {
  return createStore<AdminSessionState>()((set) => ({
    status: 'loading',
    isAuthenticated: false,
    expiresAt: null,
    refresh: async () => {
      const result = await api.checkSession().catch(() => ({ isAuthenticated: false as const }))
      set({
        status: 'ready',
        isAuthenticated: result.isAuthenticated,
        expiresAt: result.isAuthenticated ? result.expiresAt ?? now() : null
      })
    },
    acceptLogin: (result) => set(result.success
      ? { status: 'ready', isAuthenticated: true, expiresAt: result.expiresAt ?? now() }
      : { status: 'ready', isAuthenticated: false, expiresAt: null }),
    logout: async () => {
      await api.logout().catch(() => undefined)
      set({ status: 'ready', isAuthenticated: false, expiresAt: null })
    },
    invalidate: () => set({ status: 'ready', isAuthenticated: false, expiresAt: null })
  }))
}
```

Provider 在 mount 时调用 `refresh()`；认证状态为 true 时，在 `expiresAt` 到达时再次调用主进程 `checkSession()`，以便发现敏感操作带来的滑动延期，不自行延期会话。

```tsx
useEffect(() => {
  void store.getState().refresh()
  return () => store.getState().invalidate()
}, [store])

useEffect(() => {
  if (!isAuthenticated || expiresAt === null) return
  const delay = Math.max(0, expiresAt - Date.now())
  const timer = window.setTimeout(() => void refresh(), delay)
  return () => window.clearTimeout(timer)
}, [expiresAt, isAuthenticated, refresh])
```

- [ ] **Step 4: Run the store tests**

Run: `pnpm vitest run tests/unit/renderer/stores/admin-session-store.test.tsx`

Expected: PASS, including fake-timer coverage for expiry recheck and logout failure cleanup.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/admin-session-store.tsx tests/unit/renderer/stores/admin-session-store.test.tsx
git commit -m "feat(admin): add renderer session mirror"
```

---

### Task 2: Conditional Navigation and Route Guard

**Files:**
- Create: `src/renderer/app/AdminRouteGuard.tsx`
- Create: `tests/unit/renderer/AdminRouteGuard.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/app/AppShell.tsx`
- Modify: `src/renderer/app/routes.tsx`
- Modify: `tests/unit/renderer/AppShell.test.tsx`
- Modify: `tests/unit/renderer/routes.test.tsx`

**Interfaces:**
- Consumes: `AdminSessionProvider`, `useAdminSessionStore()` from Task 1。
- Produces: `AdminRouteGuard`, `NavigationItem.access: 'public' | 'admin'`。

- [ ] **Step 1: Write failing navigation and guard tests**

```tsx
it('hides all three protected navigation items before login', () => {
  renderShellWithAdmin({ status: 'ready', isAuthenticated: false })
  expect(screen.queryByRole('link', { name: '数据管理' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '基线表' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '衍生变量' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '管理员验证' })).toBeVisible()
})

it('redirects a direct derived-variable visit to admin login', async () => {
  const router = createMemoryRouter([
    { path: '/admin/login', element: <p>管理员验证目标</p> },
    { path: '/derived', element: <AdminRouteGuard><p>衍生变量正文</p></AdminRouteGuard> }
  ], { initialEntries: ['/derived'] })
  renderWithAdmin(router, { status: 'ready', isAuthenticated: false })
  expect(await screen.findByText('管理员验证目标')).toBeVisible()
})
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm vitest run tests/unit/renderer/AppShell.test.tsx tests/unit/renderer/AdminRouteGuard.test.tsx tests/unit/renderer/routes.test.tsx`

Expected: FAIL because protected links are unconditional and the guard is absent.

- [ ] **Step 3: Implement access metadata and route guard**

```tsx
export function AdminRouteGuard({ children }: PropsWithChildren) {
  const status = useAdminSessionStore((state) => state.status)
  const isAuthenticated = useAdminSessionStore((state) => state.isAuthenticated)
  const refresh = useAdminSessionStore((state) => state.refresh)
  useEffect(() => { void refresh() }, [refresh])
  if (status === 'loading') return <Skeleton statusText="正在验证管理员会话" />
  return isAuthenticated ? children : <Navigate to="/admin/login" replace />
}
```

将 `NAVIGATION_ITEMS` 的三个条目标记为 `access: 'admin'`，其余为 `public`；`NavigationLinks` 使用同一个过滤结果，因此桌面和紧凑导航不会分叉。将 `/admin/data`、`/admin/baseline`、`/admin/double-entry`、`/derived` 的元素统一包裹在 `AdminRouteGuard` 内。

```tsx
const visibleItems = NAVIGATION_ITEMS.filter(
  (item) => item.access === 'public' || isAuthenticated
)

const guardAdmin = (element: React.ReactElement) => (
  <AdminRouteGuard>{element}</AdminRouteGuard>
)
```

- [ ] **Step 4: Wrap the app with the Provider and run tests**

`App` 使用传入的 `api.admin` 创建 Provider，测试可注入假 API。运行：

`pnpm vitest run tests/unit/renderer/AppShell.test.tsx tests/unit/renderer/AdminRouteGuard.test.tsx tests/unit/renderer/routes.test.tsx tests/unit/renderer/App.test.tsx`

Expected: PASS;未登录时紧凑导航条目数量减少 3，登录后恢复。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/app/AppShell.tsx src/renderer/app/AdminRouteGuard.tsx src/renderer/app/routes.tsx tests/unit/renderer/AppShell.test.tsx tests/unit/renderer/AdminRouteGuard.test.tsx tests/unit/renderer/routes.test.tsx tests/unit/renderer/App.test.tsx
git commit -m "feat(admin): guard management navigation and routes"
```

---

### Task 3: Login, Logout, and Expiry Synchronization

**Files:**
- Modify: `src/renderer/pages/AdminLoginPage.tsx`
- Modify: `src/renderer/pages/AdminDashboard.tsx`
- Modify: `src/renderer/pages/BaselinePage.tsx`
- Modify: `src/renderer/pages/DerivedPage.tsx`
- Modify: `tests/unit/renderer/admin-login.test.tsx`
- Modify: `tests/unit/renderer/admin-dashboard.test.tsx`
- Modify: `tests/unit/renderer/baseline-page.test.tsx`
- Modify: `tests/unit/renderer/derived-page.test.tsx`

**Interfaces:**
- Consumes: `acceptLogin`, `logout`, `invalidate`, `refresh` from Task 1。
- Produces: all admin pages update the shared renderer session on authoritative results.

- [ ] **Step 1: Add failing page synchronization tests**

```tsx
it('publishes the main-process expiry after successful login', async () => {
  login.mockResolvedValue({ success: true, expiresAt: 1_800_000 })
  renderLoginWithAdminStore(store)
  await user.type(screen.getByLabelText('当前项目密码'), 'project-password')
  await user.click(screen.getByRole('button', { name: '登录管理后台' }))
  expect(store.getState()).toMatchObject({ isAuthenticated: true, expiresAt: 1_800_000 })
})

it('clears navigation state when an authorized operation reports expiry', async () => {
  getRecords.mockRejectedValue(new Error('ADMIN_SESSION_REQUIRED'))
  renderDashboardWithAdminStore(store)
  await waitFor(() => expect(store.getState().isAuthenticated).toBe(false))
})
```

- [ ] **Step 2: Run page tests and confirm failure**

Run: `pnpm vitest run tests/unit/renderer/admin-login.test.tsx tests/unit/renderer/admin-dashboard.test.tsx tests/unit/renderer/baseline-page.test.tsx tests/unit/renderer/derived-page.test.tsx`

Expected: FAIL because pages currently call `window.easyEpi.admin` without updating the shared store.

- [ ] **Step 3: Connect page actions to the shared store**

On login success call `acceptLogin(result)` before navigation. Replace dashboard logout with `await adminSession.logout()`. When any page catches `ADMIN_SESSION_REQUIRED`, call `invalidate()` before redirecting. Keep page-local checks as defense in depth, but route authorization comes from `AdminRouteGuard`.

```tsx
if (result.success) {
  acceptLogin(result)
  setPassword('')
  navigate('/admin/data', { replace: true })
}

if (String(error).includes('ADMIN_SESSION_REQUIRED')) {
  invalidate()
  navigate('/admin/login', { replace: true })
}
```

- [ ] **Step 4: Run page tests**

Run: `pnpm vitest run tests/unit/renderer/admin-login.test.tsx tests/unit/renderer/admin-dashboard.test.tsx tests/unit/renderer/baseline-page.test.tsx tests/unit/renderer/derived-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/AdminLoginPage.tsx src/renderer/pages/AdminDashboard.tsx src/renderer/pages/BaselinePage.tsx src/renderer/pages/DerivedPage.tsx tests/unit/renderer/admin-login.test.tsx tests/unit/renderer/admin-dashboard.test.tsx tests/unit/renderer/baseline-page.test.tsx tests/unit/renderer/derived-page.test.tsx
git commit -m "feat(admin): synchronize page authorization state"
```

---

### Task 4: Invalidate Sessions on Project Lifecycle Changes

**Files:**
- Modify: `src/main/ipc/project.ipc.ts`
- Modify: `src/main/ipc/epidata.ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/unit/main/project-ipc.test.ts`
- Modify: `tests/unit/main/epidata-ipc.test.ts`
- Modify: `tests/e2e/admin.spec.ts`
- Modify: `docs/PROJECT_DECISIONS.md`

**Interfaces:**
- Consumes: `AdminSessionService.logout()`.
- Produces: `registerProjectIpc(..., options?: { onProjectChanged(): void })` and `registerEpiDataIpcHandlers(..., options?: { onProjectChanged(): void })`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it.each([PROJECT_CREATE_CHANNEL, PROJECT_OPEN_CHANNEL, PROJECT_CLOSE_CHANNEL])(
  'invalidates the old admin session after %s', async (channel) => {
    const onProjectChanged = vi.fn()
    const { handlers } = setupProjectIpc({ onProjectChanged })
    await runSuccessfulProjectOperation(handlers, channel)
    expect(onProjectChanged).toHaveBeenCalledTimes(1)
  }
)

it('invalidates the old admin session after a successful EpiData import', async () => {
  await handlers.get(EPIDATA_IMPORT_CHANNEL)!(trustedEvent, validRequest)
  expect(onProjectChanged).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run IPC tests and confirm failure**

Run: `pnpm vitest run tests/unit/main/project-ipc.test.ts tests/unit/main/epidata-ipc.test.ts`

Expected: FAIL because lifecycle callbacks are not exposed.

- [ ] **Step 3: Wire one session service through main startup**

Create `projectState`, then create `adminSessionService`, then register project/EpiData IPC with:

```ts
const projectLifecycle = { onProjectChanged: () => adminSessionService.logout() }
disposeProjectIpc = registerProjectIpc(
  ipcMain, projectState, packagedRendererUrl, developmentUrl, projectLifecycle
)
disposeEpiDataIpc = registerEpiDataIpcHandlers(
  ipcMain, projectState, packagedRendererUrl, developmentUrl, projectLifecycle
)
```

Invoke the callback only after successful create/open/import and during close. Failed operations must preserve the existing session.

- [ ] **Step 4: Extend the administrator E2E test**

Add assertions that the three links are absent before login, present after login, absent after logout, and that direct navigation to `/derived` redirects to `/admin/login`. Reopen another project and assert the prior menu disappears before any management IPC is called.

```ts
await expect(page.getByRole('link', { name: '数据管理' })).toHaveCount(0)
await loginAsAdmin(page, 'old-password')
await expect(page.getByRole('link', { name: '数据管理' })).toBeVisible()
await page.getByRole('button', { name: '退出管理后台' }).click()
await expect(page.getByRole('link', { name: '数据管理' })).toHaveCount(0)
await navigateHash(page, '/derived')
await expect(page.getByRole('heading', { name: '管理员验证' })).toBeVisible()
```

Run: `pnpm build && pnpm playwright test tests/e2e/admin.spec.ts`

Expected: PASS.

- [ ] **Step 5: Update the decision record and run full verification**

Add the confirmed navigation rule and 30-minute invalidation conditions to `docs/PROJECT_DECISIONS.md`.

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build`

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/project.ipc.ts src/main/ipc/epidata.ipc.ts src/main/index.ts tests/unit/main/project-ipc.test.ts tests/unit/main/epidata-ipc.test.ts tests/e2e/admin.spec.ts docs/PROJECT_DECISIONS.md
git commit -m "feat(admin): invalidate access on project changes"
```
