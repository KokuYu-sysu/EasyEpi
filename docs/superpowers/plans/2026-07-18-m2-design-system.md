# EasyEpi M2 Design System and Interactive Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the secure M1 Electron shell into the complete M2 design system, persistent interface preferences, nine business routes, and four clearly marked memory-only interactive questionnaire prototypes, then ship Windows x64 installer and portable executables.

**Architecture:** Keep preference validation in `src/shared`, persistence and trusted IPC in the Electron main process, a fixed validated bridge in preload, and all visual state in a renderer-side Zustand store. Build token-driven Tailwind components around native HTML and narrowly selected Radix primitives, then compose them through a React Router application shell; no questionnaire, answer, credential, or business data is persisted in M2.

**Tech Stack:** Electron 43.1.1, React 18.3.1, TypeScript 5.9.3, Vite 7.3.6/electron-vite 5.0.0, Tailwind CSS 4.3.2, React Router DOM 7.18.0, Zustand 5.0.14, Lucide React 1.24.0, selected Radix UI primitives, Vitest 4.1.10, Testing Library, Playwright 1.61.1, axe-core Playwright 4.12.1, electron-builder 26.15.3, pnpm 11.9.0.

---

## Scope and acceptance

This plan implements only the approved M2 specification at `docs/superpowers/specs/2026-07-18-m2-design-system-design.md`. Real projects, questionnaires, answers, authentication, encryption, EpiData parsing, CSV export, databases, Excel/Word/PDF output, and telemetry remain out of scope. Every synthetic record and editable prototype must say `演示` or `演示模式，未保存`; restarting the app may discard it. Only `theme`, `largeText`, and `sidebarCollapsed` cross restarts.

M2 is accepted when the nine production routes, fourteen core components, preferences state machine, responsive layouts, WCAG 2.1 AA checks, source E2E, and packaged checks pass, and these artifacts are produced:

```text
release/EasyEpi-0.2.0-setup-x64.exe
release/EasyEpi-0.2.0-portable-x64.exe
```

## Dependency lock

Install exact versions; do not use ranges and do not install the Radix aggregate package:

```powershell
pnpm add --save-exact tailwindcss@4.3.2 react-router-dom@7.18.0 zustand@5.0.14 lucide-react@1.24.0 @radix-ui/react-dialog@1.1.19 @radix-ui/react-alert-dialog@1.1.19 @radix-ui/react-select@2.3.3 @radix-ui/react-checkbox@1.3.7 @radix-ui/react-radio-group@1.4.3 @radix-ui/react-toast@1.2.19 @radix-ui/react-tooltip@1.2.12
pnpm add --save-dev --save-exact @tailwindcss/vite@4.3.2 @testing-library/user-event@14.6.1 @axe-core/playwright@4.12.1
```

These versions were checked against the npm registry on 2026-07-18. Keep React at 18.3.1 and Vite at 7.3.6; do not opportunistically upgrade unrelated M1 dependencies.

## File map

### Shared, main, and preload

- `src/shared/preferences-contract.ts`: schema v1, defaults, request/result types, strict runtime parsers, equality helper.
- `src/shared/desktop-api.ts`: adds the fixed preference API to the renderer-visible contract.
- `src/main/preferences-store.ts`: injected-directory file store, safe recovery, serialized atomic saves, constrained temp cleanup.
- `src/main/preferences-ipc.ts`: trusted handlers for `preferences:get` and `preferences:update`.
- `src/main/index.ts`: lifecycle wiring only; creates the preference store and disposes both IPC groups.
- `src/preload/desktop-api.ts`: validates requests before invoke and responses after invoke.
- `src/renderer/global.d.ts`: updated `window.easyEpi` type.

### Renderer foundation

- `src/renderer/styles/tokens.css`: light/dark semantic CSS custom properties, scale, layers, shadows, and motion tokens.
- `src/renderer/styles/global.css`: Tailwind import, reset, root/body behavior, focus and reduced-motion rules.
- `src/renderer/app/theme.ts`: resolves system theme/motion and applies root data attributes.
- `src/renderer/stores/preferences-store.ts`: `loading/ready`, `confirmed/desired/inFlight`, optimistic serialized save state machine.
- `src/renderer/app/AppBootstrap.tsx`: after Toast exists, blocks child content on preference load and shows recovery/failure feedback.
- `src/renderer/app/routes.tsx`: route metadata, production/dev conditional routes, NotFound and route error boundary.
- `src/renderer/app/AppShell.tsx`: skip link, top bar, responsive sidebar, settings trigger, outlet, toast viewport.
- `src/renderer/components/common/SettingsDialog.tsx`: theme, large-text, and sidebar controls.
- `src/renderer/components/common/PageHeader.tsx`, `DemoBanner.tsx`, `MilestonePage.tsx`: shared page compositions.

### Core components

- `src/renderer/components/ui/Button.tsx`, `Input.tsx`, `Textarea.tsx`, `Badge.tsx`, `Progress.tsx`, `EmptyState.tsx`, `Skeleton.tsx`: native semantic components.
- `src/renderer/components/ui/Select.tsx`, `Checkbox.tsx`, `Radio.tsx`, `Modal.tsx`, `ConfirmDialog.tsx`, `Toast.tsx`, `Tooltip.tsx`: token-styled Radix wrappers.
- `src/renderer/components/ui/index.ts`: public exports only.
- `src/renderer/pages/ComponentGalleryPage.tsx`: development-only state/variant gallery.
- `src/renderer/pages/RoutePlaceholderPage.tsx`: temporary truthful route target created with the router and removed after the last rich page replaces it.

### Pages and demo state

- `src/renderer/pages/WelcomePage.tsx`: project chooser skeleton and route entry points.
- `src/renderer/pages/DesignerPage.tsx`, `src/renderer/stores/designer-demo-store.ts`: in-memory question CRUD prototype.
- `src/renderer/pages/EntryPage.tsx`, `src/renderer/stores/entry-demo-store.ts`: one-question-per-screen validation prototype.
- `src/renderer/pages/AdminDataPage.tsx`, `src/renderer/stores/admin-data-demo-store.ts`: synthetic filtering/paging/selection prototype.
- `src/renderer/pages/ImportPage.tsx`, `WorkSessionPage.tsx`, `AdminLoginPage.tsx`, `BaselinePage.tsx`, `DerivedPage.tsx`: standard milestone skeletons.
- `src/renderer/pages/NotFoundPage.tsx`, `RouteErrorPage.tsx`: recoverable navigation failures.
- `src/renderer/demo/demo-data.ts`: clearly synthetic, non-sensitive immutable seeds shared by demo stores.

### Tests and release evidence

- `tests/unit/shared/preferences-contract.test.ts`: parser/result contract matrix.
- `tests/unit/main/preferences-store.test.ts`: missing/corrupt/atomic/serialized/temp-cleanup behavior.
- `tests/unit/main/preferences-ipc.test.ts`: sender, request, stable error, registration/disposal.
- `tests/unit/preload/desktop-api.test.ts`: fixed channels plus request/response validation.
- `tests/unit/renderer/theme.test.ts`, `preferences-store.test.ts`: root attributes and deterministic save state machine.
- `tests/unit/renderer/components/*.test.tsx`: component semantics, focus, keyboard, error/loading states and timers.
- `tests/unit/renderer/routes.test.tsx`, `pages.test.tsx`: route inventory, development gate and memory-only interactions.
- `tests/e2e/app.spec.ts`: source-built navigation, preference restart, viewport and accessibility flows.
- `tests/e2e/packaged.spec.ts`: production route/security and packaged persistence checks.
- `docs/milestones/M2_VERIFICATION.md`: commands, test counts, artifact sizes/hashes, unsigned limitation.

### Task 1: Lock dependencies, version, and Tailwind token foundation

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `electron.vite.config.ts`
- Modify: `vitest.config.ts`
- Delete: `src/renderer/app.css`
- Create: `src/renderer/styles/tokens.css`
- Create: `src/renderer/styles/global.css`
- Create: `tests/unit/renderer/theme.test.ts`
- Create: `src/renderer/app/theme.ts`
- Modify: `src/renderer/main.tsx`

- [ ] **Step 1: Write failing theme tests**

Test the pure resolution and DOM application boundary:

```ts
expect(resolveTheme('system', true)).toBe('dark')
expect(resolveTheme('system', false)).toBe('light')
applyAppearance(root, { theme: 'dark', largeText: true }, true)
expect(root.dataset).toMatchObject({ theme: 'dark', fontScale: 'large', motion: 'reduced' })
```

Also verify a subscribed system-theme callback is removed by its cleanup function.

- [ ] **Step 2: Verify RED**

Run: `pnpm test:unit tests/unit/renderer/theme.test.ts`  
Expected: FAIL because `@renderer/app/theme` does not exist.

- [ ] **Step 3: Install exact dependencies and set version**

Run the two commands in **Dependency lock**. Change `package.json` version from `0.1.0` to `0.2.0`. Add Tailwind's Vite plugin after React in the renderer plugin array:

```ts
plugins: [react(), tailwindcss()]
```

Expand Vitest coverage to all executable M2 modules under `src/shared`, `src/main`, `src/preload`, and `src/renderer`, excluding entry-point wiring, route metadata constants, and test-only gallery data. Preserve global 80% thresholds and 90% branch thresholds for IPC/security modules.

- [ ] **Step 4: Implement tokens and theme functions**

`tokens.css` is the only source for brand/semantic colors, surface/text/border states, 4/8-based spacing, 8/12/16/24 radii, typography, Z1-Z4, shadows and fast/normal/slow motion. Give both `[data-theme='light']` and `[data-theme='dark']` concrete values. `global.css` begins with:

```css
@import "tailwindcss";
@import "./tokens.css";
```

Add visible `:focus-visible` outline plus offset, wrapping-safe text, no global `transform: scale`, and a reduced-motion rule that removes non-essential transitions/animations. Implement `resolveTheme`, `resolveMotion`, `applyAppearance`, and `observeSystemTheme`; `observeSystemTheme` must call `removeEventListener` in cleanup.

- [ ] **Step 5: Verify GREEN and build**

Run:

```powershell
pnpm test:unit tests/unit/renderer/theme.test.ts
pnpm typecheck
pnpm build
```

Expected: PASS; production CSS contains token values and the build has no remote font/assets.

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml electron.vite.config.ts vitest.config.ts src/renderer tests/unit/renderer/theme.test.ts
git commit -m "feat: establish M2 design tokens and theme runtime"
```

### Task 2: Define the strict preference wire contract

**Files:**
- Create: `src/shared/preferences-contract.ts`
- Create: `tests/unit/shared/preferences-contract.test.ts`
- Modify: `src/shared/desktop-api.ts`

- [ ] **Step 1: Write the parser matrix**

Cover exact defaults, valid input, ignored unknown keys, arrays/null/non-objects, unknown schema, every invalid field, success with/without warning, every stable error, and rejection of extra/malformed result fields. The key assertion is:

```ts
expect(parsePreferences({
  schemaVersion: 1,
  theme: 'dark',
  largeText: true,
  sidebarCollapsed: false,
  injected: 'discard me'
})).toEqual({ schemaVersion: 1, theme: 'dark', largeText: true, sidebarCollapsed: false })
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test:unit tests/unit/shared/preferences-contract.test.ts`  
Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement exact contract**

Export channel constants, `PreferencesV1`, `PreferencesWarning`, `PreferencesErrorCode`, `PreferencesResult`, immutable `DEFAULT_PREFERENCES`, `parsePreferences`, `parsePreferencesUpdateRequest`, `parsePreferencesResult`, and `preferencesEqual`. Parsers accept only plain objects and return freshly normalized objects. `DesktopApi.preferences` must be exactly:

```ts
preferences: {
  get(): Promise<PreferencesResult>
  update(preferences: PreferencesV1): Promise<PreferencesResult>
}
```

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test:unit tests/unit/shared/preferences-contract.test.ts` then `pnpm typecheck`.  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/shared tests/unit/shared/preferences-contract.test.ts
git commit -m "feat: define validated preference contract"
```

### Task 3: Implement recoverable serialized atomic preference storage

**Files:**
- Create: `src/main/preferences-store.ts`
- Create: `tests/unit/main/preferences-store.test.ts`

- [ ] **Step 1: Write failing storage tests using injected temporary directories**

Test: missing file returns defaults/no warning; valid file normalizes unknown keys; corrupt JSON/unknown schema/invalid fields return defaults plus `PREFERENCES_RECOVERED`; permission/read errors return `PREFERENCES_READ_FAILED` without paths; successful save writes canonical JSON; re-read validation occurs before replace; failures before replace preserve old bytes; only fixed-prefix temp files are cleaned; cleanup failure after replace still returns success; concurrent updates finish in invocation order.

Inject a filesystem adapter so failure points can be deterministic:

```ts
interface PreferencesFileSystem {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  syncFile(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  list(directory: string): Promise<string[]>
  remove(path: string): Promise<void>
}
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test:unit tests/unit/main/preferences-store.test.ts`  
Expected: FAIL because the store is absent.

- [ ] **Step 3: Implement the storage protocol**

`createPreferencesStore(directory, fsAdapter?)` exposes `get()` and `update(unknown)`. Use `preferences.json` and a single unique `EasyEpi-preferences-<pid>-<counter>.tmp`. Serialize writes through a promise tail that recovers after rejection. Write canonical JSON with trailing newline, sync, re-read and parse the temp file, then rename within the same directory. Treat rename as commit: later cleanup is best effort. Never use a glob, never include directory paths in returned errors, and never write to real `userData` in tests.

- [ ] **Step 4: Verify GREEN and coverage**

Run:

```powershell
pnpm test:unit tests/unit/main/preferences-store.test.ts
pnpm test:coverage
```

Expected: PASS; every pre-commit failure branch and serialization behavior is covered.

- [ ] **Step 5: Commit**

```powershell
git add src/main/preferences-store.ts tests/unit/main/preferences-store.test.ts
git commit -m "feat: persist interface preferences atomically"
```

### Task 4: Wire trusted preference IPC and validated preload bridge

**Files:**
- Create: `src/main/preferences-ipc.ts`
- Create: `tests/unit/main/preferences-ipc.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/desktop-api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`
- Modify: `tests/unit/preload/desktop-api.test.ts`

- [ ] **Step 1: Write failing IPC and bridge tests**

Verify both fixed channels, trusted sender reuse, main-side request validation, stable result unions, handler disposal, preload request validation before invoke, response validation after invoke, and absence of raw `invoke`, paths, or Electron objects. A malformed main-process response must reject with `INVALID_PREFERENCES_RESPONSE`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm test:unit tests/unit/main/preferences-ipc.test.ts
pnpm test:unit tests/unit/preload/desktop-api.test.ts
```

Expected: FAIL because preference handlers and bridge methods are missing.

- [ ] **Step 3: Implement and wire fixed handlers**

`registerPreferencesIpc` registers only `preferences:get` and `preferences:update`, calls the existing exact sender validator before parsing input, maps unexpected exceptions to read/save stable errors, and returns a disposer. In `main/index.ts`, create storage with `app.getPath('userData')` only after `app.whenReady()`, then dispose both IPC groups on `will-quit`.

The preload implementation must normalize this complete snapshot before invoking:

```ts
update: async (preferences) =>
  parsePreferencesResult(
    await invoke(PREFERENCES_UPDATE_CHANNEL, parsePreferencesUpdateRequest(preferences))
  )
```

- [ ] **Step 4: Verify GREEN**

Run `pnpm test:unit`, `pnpm typecheck`, and `pnpm build`.  
Expected: all PASS; renderer bundle contains no `node:fs`, `ipcRenderer`, or `userData` references.

- [ ] **Step 5: Commit**

```powershell
git add src/main src/preload src/renderer/global.d.ts tests/unit/main tests/unit/preload
git commit -m "feat: expose trusted preference IPC"
```

### Task 5: Build the deterministic preference state machine

**Files:**
- Create: `src/renderer/stores/preferences-store.ts`
- Create: `tests/unit/renderer/preferences-store.test.ts`

- [ ] **Step 1: Write state-machine tests with deferred promises**

Cover loading/default fallback, recovery warning, successful load, A success then B save, A failure while newer B remains visible and is retried, latest failure rollback to `confirmed`, full-snapshot requests, system theme subscription cleanup, and no request overlap. Assert states explicitly:

```ts
expect(store.getState()).toMatchObject({ confirmed: A, desired: B, inFlight: A })
firstSave.resolve({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
await flushPromises()
expect(store.getState()).toMatchObject({ confirmed: A, desired: B, inFlight: B })
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test:unit tests/unit/renderer/preferences-store.test.ts`
Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement `confirmed / desired / inFlight` exactly**

Use a vanilla Zustand store factory for injection in tests and a React context/provider for production. `load()` moves `loading` to `ready`; a read error uses defaults and queues a non-blocking warning. `setPreferences(patch)` immediately replaces `desired`, applies appearance, and calls `pump()`. `pump()` sends one immutable complete snapshot; on success updates `confirmed`, on failure either sends a newer `desired` or rolls visible state back. Never incrementally merge from a failed snapshot.

- [ ] **Step 4: Verify GREEN**

Run the focused test, full unit suite and typecheck.
Expected: PASS without React act warnings or unresolved promises.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/stores tests/unit/renderer/preferences-store.test.ts
git commit -m "feat: manage persistent interface preferences"
```

### Task 6: Implement native core components

**Files:**
- Create: `src/renderer/components/ui/Button.tsx`
- Create: `src/renderer/components/ui/Input.tsx`
- Create: `src/renderer/components/ui/Textarea.tsx`
- Create: `src/renderer/components/ui/Badge.tsx`
- Create: `src/renderer/components/ui/Progress.tsx`
- Create: `src/renderer/components/ui/EmptyState.tsx`
- Create: `src/renderer/components/ui/Skeleton.tsx`
- Create: `src/renderer/components/ui/index.ts`
- Create: `tests/unit/renderer/components/native-components.test.tsx`

- [ ] **Step 1: Write accessible contract tests**

Verify native prop passthrough, ref forwarding, focus-visible class, disabled and loading submission prevention, loading accessible name, input/textarea error text connected by `aria-describedby`, badge semantic variants, progress visible text plus `aria-valuenow/min/max`, EmptyState heading/action, and Skeleton `aria-hidden` with adjacent loading status.

- [ ] **Step 2: Verify RED**

Run: `pnpm test:unit tests/unit/renderer/components/native-components.test.tsx`  
Expected: FAIL because exports do not exist.

- [ ] **Step 3: Implement minimal token-driven components**

Use `forwardRef` and native element prop types. Button variants are `primary | secondary | ghost | danger`, sizes `sm | md | lg`; loading forces `disabled` and keeps the supplied label in an `sr-only` span. Input/Textarea generate stable description IDs with `useId`. Progress clamps values and derives percent without dividing by zero. Do not hard-code brand hex colors or shadows in component files.

- [ ] **Step 4: Verify GREEN**

Run focused test, `pnpm typecheck`, and `pnpm test:coverage`.  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/components/ui tests/unit/renderer/components/native-components.test.tsx
git commit -m "feat: add native design system components"
```

### Task 7: Implement Radix form and overlay components

**Files:**
- Create: `src/renderer/components/ui/Select.tsx`
- Create: `src/renderer/components/ui/Checkbox.tsx`
- Create: `src/renderer/components/ui/Radio.tsx`
- Create: `src/renderer/components/ui/Modal.tsx`
- Create: `src/renderer/components/ui/ConfirmDialog.tsx`
- Create: `src/renderer/components/ui/Toast.tsx`
- Create: `src/renderer/components/ui/Tooltip.tsx`
- Modify: `src/renderer/components/ui/index.ts`
- Create: `tests/unit/renderer/components/form-components.test.tsx`
- Create: `tests/unit/renderer/components/overlay-components.test.tsx`
- Create: `src/renderer/app/AppBootstrap.tsx`
- Create: `tests/unit/renderer/AppBootstrap.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Use `userEvent`. Verify Select keyboard selection and disabled items; Checkbox/Radio labels and checked states; Modal focus entry, Escape close and focus return; ConfirmDialog initial focus on cancel; Tooltip on focus without carrying essential instructions; Toast FIFO queue, `aria-live`, 4-second default, pause on focus/hover, resume, and manual dismiss.

- [ ] **Step 2: Verify RED**

Run both focused files.  
Expected: FAIL because wrappers are missing.

- [ ] **Step 3: Implement narrow Radix wrappers**

Expose product-level props rather than Radix internals. Use `Dialog`, `AlertDialog`, `Select`, `Checkbox`, `RadioGroup`, `Toast`, and `Tooltip` primitives. Expose `useToast().push({ title, description?, tone?, duration? })`; queue duplicate message types rather than replacing them. All portals use token surfaces/Z-layers and all overlays have accessible titles/descriptions.

Create `AppBootstrap({ children })` in this task so it can be tested without depending on the Task 8 router. It owns the single `ToastProvider` and viewport, renders an application Skeleton plus visible `正在加载界面设置` status until preferences are ready, then renders `children`. Recovery and read-failure states still enter `ready` and enqueue exactly one non-blocking recovery/error Toast. Task 8 will pass the router provider as its child.

- [ ] **Step 4: Verify GREEN**

Run focused tests under fake timers, full unit suite, typecheck and coverage.  
Expected: PASS; no timer leaks and no focus left inside removed portals.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/components/ui src/renderer/app/AppBootstrap.tsx tests/unit/renderer/components tests/unit/renderer/AppBootstrap.test.tsx
git commit -m "feat: add accessible Radix design components"
```

### Task 8: Create the router, application shell, settings, and component gallery

**Files:**
- Create: `src/renderer/app/routes.tsx`
- Create: `src/renderer/app/AppShell.tsx`
- Create: `src/renderer/components/common/SettingsDialog.tsx`
- Create: `src/renderer/components/common/PageHeader.tsx`
- Create: `src/renderer/components/common/DemoBanner.tsx`
- Create: `src/renderer/components/common/MilestonePage.tsx`
- Create: `src/renderer/pages/ComponentGalleryPage.tsx`
- Create: `src/renderer/pages/NotFoundPage.tsx`
- Create: `src/renderer/pages/RouteErrorPage.tsx`
- Create: `src/renderer/pages/RoutePlaceholderPage.tsx`
- Create: `tests/unit/renderer/routes.test.tsx`
- Create: `tests/unit/renderer/AppShell.test.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Write route/shell tests**

Assert all nine exact production paths, NotFound recovery, route error recovery, current-page title, skip link target, logical tab order, sidebar collapse, top-bar theme/large-text shortcuts, settings dialog persistence calls, and global toast viewport. Build route lists with injected `isDevelopment`; assert `/__components` exists only when true.

- [ ] **Step 2: Verify RED**

Run route and AppShell tests.  
Expected: FAIL because router/shell modules are missing.

- [ ] **Step 3: Implement the shell and routes**

Use React Router `createHashRouter` because the packaged renderer loads from `file:` and must deep-link without an HTTP server. Route registration must be produced by `createAppRouter({ isDevelopment: import.meta.env.DEV })`; include `ComponentGalleryPage` only inside the true branch so the production route table has no navigable entry. At this task boundary, point the nine production paths to `RoutePlaceholderPage` instances whose visible title and `演示骨架，后续任务替换` text are supplied from route metadata; this keeps Task 8 buildable before Tasks 9–12 create final pages. Tasks 9–12 replace only their owned route elements, and Task 12 deletes the placeholder after the last three rich routes are replaced. Use Lucide icons with text labels. At widths near 1024, collapse the sidebar but keep every destination reachable from a labelled menu. Quick controls call the preference state machine, never localStorage. `App.tsx` renders the router provider as the child of the Task 7 `AppBootstrap`.

- [ ] **Step 4: Build the complete gallery**

Gallery sections cover all fourteen components, every visual variant, disabled/loading/error states, long Chinese text, light/dark and normal/large-text combinations. It uses only synthetic local state and includes a fixed `仅开发环境` banner.

- [ ] **Step 5: Verify GREEN**

Run focused tests, `pnpm typecheck`, `pnpm test:coverage`, and `pnpm build`. Inspect the production route test with `isDevelopment: false`.  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/app src/renderer/components/common src/renderer/pages/ComponentGalleryPage.tsx src/renderer/pages/NotFoundPage.tsx src/renderer/pages/RouteErrorPage.tsx src/renderer/pages/RoutePlaceholderPage.tsx src/renderer/App.tsx tests/unit/renderer
git commit -m "feat: add responsive application shell and routes"
```

### Task 9: Implement welcome and five standard milestone skeleton pages

**Files:**
- Create: `src/renderer/pages/WelcomePage.tsx`
- Create: `src/renderer/pages/ImportPage.tsx`
- Create: `src/renderer/pages/WorkSessionPage.tsx`
- Create: `src/renderer/pages/AdminLoginPage.tsx`
- Create: `src/renderer/pages/BaselinePage.tsx`
- Create: `src/renderer/pages/DerivedPage.tsx`
- Create: `tests/unit/renderer/pages.test.tsx`
- Modify: `src/renderer/app/routes.tsx`

- [ ] **Step 1: Write page tests**

Welcome must show product purpose, offline status, main actions, recent synthetic demo card, M3 explanation dialogs for new/open, and navigation to designer/entry/admin data. Each standard page must use PageHeader, DemoBanner, EmptyState, its later-milestone description, and a safe return route. Admin login must not render a fixed password or claim authentication.

- [ ] **Step 2: Verify RED**

Run: `pnpm test:unit tests/unit/renderer/pages.test.tsx`  
Expected: FAIL because pages are placeholders/missing.

- [ ] **Step 3: Implement and route pages**

Keep every CTA truthful: future functionality opens an explanatory Modal or Toast saying which milestone will implement it. Welcome's one synthetic recent project navigates to `/designer`; do not write browser storage or files.

- [ ] **Step 4: Verify GREEN and commit**

Run focused tests, full unit suite and typecheck; expected PASS.

```powershell
git add src/renderer/pages src/renderer/app/routes.tsx tests/unit/renderer/pages.test.tsx
git commit -m "feat: add welcome and milestone page skeletons"
```

### Task 10: Implement the memory-only questionnaire designer prototype

**Files:**
- Create: `src/renderer/demo/demo-data.ts`
- Create: `src/renderer/stores/designer-demo-store.ts`
- Create: `src/renderer/pages/DesignerPage.tsx`
- Create: `tests/unit/renderer/designer-demo.test.tsx`
- Modify: `src/renderer/app/routes.tsx`

- [ ] **Step 1: Write failing designer flows**

Assert immutable synthetic seed questions, selection, type/Key/condition badges, add/edit modal, required title validation, delete confirmation with cancel as initial focus, empty state after deleting all, and Save/Preview toasts that say the feature is not saved. Verify no preference API or other desktop write method is called.

- [ ] **Step 2: Verify RED**

Run focused test.  
Expected: FAIL because store/page are absent.

- [ ] **Step 3: Implement a resettable injected demo store**

Use `createStore` for `questions`, `selectedId`, `addQuestion`, `updateQuestion`, `removeQuestion`, and `reset`. IDs are process-local deterministic counters. The page always shows `演示模式，未保存`; modal commits only to this store. Do not reuse the preference store or serialize demo state.

- [ ] **Step 4: Verify GREEN and commit**

Run focused test, coverage and typecheck; expected PASS.

```powershell
git add src/renderer/demo src/renderer/stores/designer-demo-store.ts src/renderer/pages/DesignerPage.tsx src/renderer/app/routes.tsx tests/unit/renderer/designer-demo.test.tsx
git commit -m "feat: add questionnaire designer demo"
```

### Task 11: Implement the memory-only single-question entry prototype

**Files:**
- Create: `src/renderer/stores/entry-demo-store.ts`
- Create: `src/renderer/pages/EntryPage.tsx`
- Create: `tests/unit/renderer/entry-demo.test.tsx`
- Modify: `src/renderer/app/routes.tsx`

- [ ] **Step 1: Write failing entry flows**

Assert one question per screen, visible/numeric progress, previous/next, single-choice input, required-answer error connected to controls, keyboard hint, answer retained while navigating in the current renderer session, and a final demo-complete screen that performs no desktop write. Assert route unmount creates a fresh store/reset according to the page boundary.

- [ ] **Step 2: Verify RED**

Run focused test.  
Expected: FAIL.

- [ ] **Step 3: Implement the entry state and page**

Store `index`, `answers`, `validationError`, and `completed`; `next()` refuses to advance required unanswered questions; final next marks only in-memory completion. The DemoBanner explicitly says refresh/leaving may discard answers. Use Radio and native text input examples from synthetic questions.

- [ ] **Step 4: Verify GREEN and commit**

Run focused test, full unit suite and typecheck; expected PASS.

```powershell
git add src/renderer/stores/entry-demo-store.ts src/renderer/pages/EntryPage.tsx src/renderer/app/routes.tsx tests/unit/renderer/entry-demo.test.tsx
git commit -m "feat: add single-question entry demo"
```

### Task 12: Implement the memory-only data administration prototype

**Files:**
- Create: `src/renderer/stores/admin-data-demo-store.ts`
- Create: `src/renderer/pages/AdminDataPage.tsx`
- Create: `tests/unit/renderer/admin-data-demo.test.tsx`
- Modify: `src/renderer/app/routes.tsx`
- Delete: `src/renderer/pages/RoutePlaceholderPage.tsx` (after all nine final M2 pages are wired)

- [ ] **Step 1: Write failing administration flows**

Assert all records are labelled synthetic/non-sensitive, text filtering, page-size-safe pagination, row selection and select-page behavior, management tab layout, edit modal, delete confirm, export loading feedback, and truthful toasts that do not claim real changes/export. Verify deleting/editing only affects current memory state and no desktop write is called.

- [ ] **Step 2: Verify RED**

Run focused test.  
Expected: FAIL.

- [ ] **Step 3: Implement deterministic derived selectors**

Keep seed records in `demo-data.ts`; store filter/page/selected IDs and memory overrides. Derive filtered/paged rows rather than duplicating them. Clamp page after filters/deletes. Export simulates a short cancellable loading state, then says `演示：未生成文件`; it must not create a Blob/download or invoke preload. After wiring `/admin/data`, confirm all nine paths now use their final M2 page components and delete `RoutePlaceholderPage.tsx`.

- [ ] **Step 4: Verify GREEN and commit**

Run focused test, coverage and typecheck; expected PASS.

```powershell
git add src/renderer/stores/admin-data-demo-store.ts src/renderer/pages/AdminDataPage.tsx src/renderer/pages/RoutePlaceholderPage.tsx src/renderer/app/routes.tsx tests/unit/renderer/admin-data-demo.test.tsx
git commit -m "feat: add data administration demo"
```

### Task 13: Add source E2E, responsive, accessibility, and production-route checks

**Files:**
- Modify: `tests/e2e/app.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `src/renderer/styles/global.css`
- Modify: renderer files only when tests expose a concrete defect

- [ ] **Step 1: Write failing E2E scenarios**

Launch the built Electron entry with an isolated repository-local `--user-data-dir` per test. Cover welcome navigation into designer, entry and admin data; theme light/dark/system; large text; app restart restoring preferences; 1024×700 and 1366×768; keyboard-only skip link/dialog/route flow; reduced-motion root attribute; NotFound; production `/__components` resolving to NotFound; no Node `require`; and no Electron security warnings.

Use axe on welcome, designer, entry, admin data and settings:

```ts
const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
expect(results.violations).toEqual([])
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test:e2e`  
Expected: at least one new scenario fails before final responsive/a11y adjustments.

- [ ] **Step 3: Make the minimum fixes**

At 1024×700, assert no document-level horizontal overflow and every navigation/action remains reachable. At 1366×768, assert header, sidebar, content and toast viewport are visible. Add only token/global/component fixes justified by the failing scenario; no page-specific hard-coded colors.

- [ ] **Step 4: Verify full source quality gate**

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm test:e2e
pnpm build
```

Expected: all PASS; coverage meets configured thresholds and axe has zero A/AA violations in tested states.

- [ ] **Step 5: Commit**

```powershell
git add tests/e2e playwright.config.ts src/renderer
git commit -m "test: verify M2 accessibility and responsive flows"
```

### Task 14: Package, test, document, and tag M2

**Files:**
- Modify: `tests/e2e/packaged.spec.ts`
- Modify: `README.md`
- Modify: `docs/IMPLEMENTATION_PLAN.md`
- Create: `docs/milestones/M2_VERIFICATION.md`
- Generated, not committed: `release/EasyEpi-0.2.0-setup-x64.exe`
- Generated, not committed: `release/EasyEpi-0.2.0-portable-x64.exe`

- [ ] **Step 1: Extend packaged tests before building**

Require absolute `EASYEPI_EXECUTABLE` and isolated absolute `EASYEPI_USER_DATA_DIR`. Test launch, production NotFound for `/__components`, preference update/restart restoration, hostile `ELECTRON_RENDERER_URL` ignored, and clean close. Keep the existing connected/security assertions.

- [ ] **Step 2: Run the clean verification sequence**

Resolve each generated target to an absolute path under this worktree before removing only `node_modules`, `out`, `coverage`, `test-results`, `release`, and `.tmp/m2-*`. Preserve the repository root, `.git`, `.worktrees`, and the user's untracked root `.pnpm-store`. Then run:

```powershell
pnpm install --frozen-lockfile
pnpm install:electron
pnpm generate:icon
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm test:e2e
pnpm build:win
```

Expected: every command exits 0 and both exact 0.2.0 artifacts are non-empty.

- [ ] **Step 3: Smoke-test portable and installed EXEs**

For portable, set `EASYEPI_EXECUTABLE` to the resolved portable path and `EASYEPI_USER_DATA_DIR` to a repository-local `.tmp/m2-portable-user-data`, then run `pnpm test:e2e:packaged`.

For the installer, resolve `.tmp/m2-install`, verify it starts with the worktree absolute root plus a path separator, silently install with `Start-Process -WindowStyle Hidden`, run packaged tests against `.tmp/m2-installed-user-data`, silently uninstall, and assert the installed `EasyEpi.exe` is removed. Never target an existing user installation directory.

- [ ] **Step 4: Record reproducible evidence**

Update README commands/version and M2 status in `docs/IMPLEMENTATION_PLAN.md`. In `docs/milestones/M2_VERIFICATION.md`, record date, commit, exact commands/exit codes, unit test count, coverage summary, source and two packaged E2E results, both artifact byte sizes and SHA-256 hashes, publisher `KokuYu-EasyEpi Team`, and `NotSigned`/SmartScreen limitation.

- [ ] **Step 5: Commit evidence and independently review implementation**

Run the `requesting-code-review` skill against the M2 base and head. Resolve blocking findings with focused tests and separate commits. Then:

```powershell
git add README.md docs/IMPLEMENTATION_PLAN.md docs/milestones/M2_VERIFICATION.md tests/e2e/packaged.spec.ts
git commit -m "docs: record M2 verification evidence"
git status --short
```

Expected: clean feature worktree.

- [ ] **Step 6: Merge and tag only after clean verification**

Use the `finishing-a-development-branch` skill. Merge the reviewed feature branch to `master`, rerun the final artifact hash check from master, commit only any necessary hash-path reconciliation, and create annotated tag:

```powershell
git tag -a v0.2.0-m2 -m "EasyEpi M2 design system and interactive skeletons"
git show --no-patch --decorate v0.2.0-m2
```

Expected: `v0.2.0-m2` points to the verified M2 master commit; no remote push is attempted because the repository has no configured remote.
