# Phase 4 Repair Implementation Plan

> **Scope:** Repair and complete Phase 4 (administrator authentication, encrypted data management, export, baseline statistics, and settings) in the existing `m5-epidata-compatibility` worktree. Phase 5 compatibility work must remain intact.

## Agreed architecture

- The administrator password is the password of the currently opened EasyEpi project. There is no built-in or separately persisted administrator password.
- Password verification, failed-attempt lockout, session expiry, record mutation, export, statistics, and password changes execute in the Electron main process.
- A successful login creates a 30-minute sliding administrator session. Five consecutive failures cause a five-minute lockout.
- Changing the password re-encrypts both the `.easyepi` and `.easyepi_data` files as one recoverable transaction and updates the active in-memory key only after both replacements succeed.
- Renderer requests are strictly parsed and every administrator IPC operation checks trusted sender plus active administrator authorization.

## Task 1: Administrator session and IPC contract

**Files:**
- Create: `src/main/services/admin-session.service.ts`
- Modify: `src/shared/admin-contract.ts`
- Modify: `src/main/ipc/admin.ipc.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/admin-session.service.test.ts`
- Test: `tests/unit/admin-contract.test.ts`
- Test: `tests/unit/admin.ipc.test.ts`

1. Add failing tests for project-password login, five-attempt lockout, lockout expiry, logout, sliding 30-minute expiry, closed-project rejection, and session-gated IPC.
2. Implement a clock-injectable main-process session service.
3. Harden all request parsers against empty IDs, invalid integers, non-string arrays, unsupported sort fields/orders, and weak passwords.
4. Inject `IpcMainLike`, `ProjectIpcState`, and services into admin IPC; remove module globals and register the disposer in main startup cleanup.

## Task 2: Encrypted record CRUD

**Files:**
- Modify: `src/main/services/data.service.ts`
- Modify: `src/main/services/record.service.ts`
- Test: `tests/unit/data.service.test.ts`
- Test: `tests/unit/record.service.test.ts`

1. Add failing tests using a temporary encrypted `.easyepi_data` file.
2. Implement pagination, full-record search, allow-listed sorting, answer-only edits, not-found errors, multi-delete, and key-field duplicate protection.
3. Preserve entry progress and continue using authenticated encryption plus atomic file replacement.

## Task 3: Recoverable project password re-encryption

**Files:**
- Modify: `src/main/services/project.service.ts`
- Modify: `src/main/services/record.service.ts`
- Create: `src/main/services/project-rekey.service.ts`
- Modify: `src/main/ipc/admin.ipc.ts`
- Test: `tests/unit/project-rekey.service.test.ts`

1. Add failing tests for successful project/data re-encryption, wrong old password, rollback after either replacement fails, and cleanup of transaction files.
2. Generate a new salt/hash/key, create encrypted temporary project and data files, and replace originals using backups with rollback.
3. Update `ProjectIpcState` and the administrator session only after the transaction succeeds.

## Task 4: Main-process export

**Files:**
- Create: `src/shared/export-contract.ts`
- Create: `src/main/ipc/export.ipc.ts`
- Modify: `src/main/services/export.service.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/export-contract.test.ts`
- Test: `tests/unit/export.service.test.ts`
- Test: `tests/unit/export.ipc.test.ts`

1. Add failing tests for CSV escaping, UTF-8 BOM/GBK modes, checkbox expansion, select display values, missing values, record scope, dictionary dummy-reference correctness, extension handling, authorization, and trusted sender checks.
2. Implement strict export requests and main-process reads from the active encrypted project.
3. Return generated paths and deterministic counts; never accept renderer-supplied plaintext datasets.

## Task 5: Real baseline statistics

**Files:**
- Create: `src/shared/baseline-contract.ts`
- Create: `src/main/ipc/baseline.ipc.ts`
- Modify: `src/main/services/baseline.service.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/baseline-contract.test.ts`
- Test: `tests/unit/baseline.service.test.ts`
- Test: `tests/unit/baseline.ipc.test.ts`

1. Add failing fixture tests for continuous mean/sample-SD, categorical count/percentage, missing values, grouped columns, Welch t-test, chi-square, and unsupported variable types.
2. Generate statistics from decrypted active records and questionnaire metadata in the main process.
3. Export the resulting table through the export service with UTF-8 BOM.

## Task 6: Replace Phase 4 demo renderer

**Files:**
- Modify: `src/renderer/app/routes.tsx`
- Modify: `src/renderer/pages/AdminLoginPage.tsx`
- Modify: `src/renderer/pages/AdminDataPage.tsx`
- Modify: `src/renderer/pages/BaselinePage.tsx`
- Modify: `src/renderer/components/admin/*`
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/preload/index.ts`
- Test: relevant renderer unit tests

1. Add failing UI tests for login errors/lockout, session redirects, pagination/search/sort, edit/delete confirmation, export dialog, baseline generation, password change, and logout.
2. Replace all synthetic records, mock delays, browser-only Blob exports, no-op callbacks, and default-password messages with real preload APIs.
3. Use `/admin/data` as the authenticated administrator landing route; preserve `/admin/baseline` and provide consistent navigation.
4. Display correct Chinese strings and accessible status/error feedback.

## Task 7: Acceptance and packaging

**Files:**
- Modify/Create: `tests/e2e/admin.spec.ts`
- Modify: package scripts only if required

1. Run focused tests after each red/green cycle.
2. Run lint, Node/Web typechecks, full unit suite, coverage gate, and production build.
3. Run Electron E2E for create/open project, administrator login, real encrypted CRUD, CSV/dictionary export, baseline statistics, password re-encryption/reopen, lockout, logout, and Phase 5 import regression.
4. Rebuild portable and setup x64 executables, then run packaged smoke and M5 import tests.
5. Perform a final spec-compliance and code-quality review. Do not merge or pull into `main`; report the worktree state and wait for explicit instruction.
