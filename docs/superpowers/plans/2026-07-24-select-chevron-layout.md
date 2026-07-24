# Select Chevron Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small baseline-aligned select character with a clear 20px Lucide chevron fixed at the right edge of every shared EasyEpi Select.

**Architecture:** Keep the change inside the shared Radix Select wrapper so every consumer receives the same behavior. Use Flex sizing on Trigger and Value, then verify structural semantics in Vitest and actual pixel geometry plus selection behavior in Electron Playwright.

**Tech Stack:** React 18, TypeScript, Radix Select 2.3.3, lucide-react 1.24.0, Tailwind CSS 4, Vitest/Testing Library, Playwright Electron.

---

## File map

- Modify `src/renderer/components/ui/Select.tsx`: shared trigger layout and Lucide chevron.
- Modify `tests/unit/renderer/components/form-components.test.tsx`: structural, disabled, long-label and accessibility regression coverage.
- Modify `tests/e2e/app.spec.ts`: real Electron geometry and question-type interaction coverage.

### Task 1: Add failing component regression coverage

- [ ] Add a `Select` test fixture with a long selected label and a disabled `Select`.
- [ ] Assert the Trigger has `flex`, `w-full`, `items-center`, and a tokenized 12px gap.
- [ ] Assert Value has `min-w-0`, `flex-1`, and left alignment.
- [ ] Assert the Trigger contains an `svg` with Lucide chevron classes, 20px dimensions, non-shrinking layout, and decorative `aria-hidden` semantics in both enabled and disabled states.
- [ ] Run `node_modules/.bin/vitest.CMD run tests/unit/renderer/components/form-components.test.tsx` and confirm failure because the old implementation has no SVG/Flex layout.

### Task 2: Add failing real-layout Electron coverage

- [ ] In the existing encrypted M3 questionnaire E2E, locate the question-type Trigger and its SVG before opening the menu.
- [ ] Add `assertSelectGeometry(trigger)` to measure Trigger and SVG bounding boxes and assert SVG visibility, 20×20px size, 12px ±1px right inset, and vertical-center difference of at most 1px.
- [ ] Open the menu, assert all six options, use keyboard ArrowDown/Enter to select “多选题”, assert the option/listbox closes and Trigger text changes, then keep the persistence assertions.
- [ ] Run the geometry helper for light-normal, light-large, dark-normal and dark-large document attributes. After keyboard selection is complete, use an E2E-only DOM fixture pass that saves the original Value text, replaces it with a long Chinese label, sets both `disabled` and `data-disabled` on the Trigger, and calls the helper again. Restore the original text, remove both disabled attributes, restore the original theme/font attributes, and assert the Trigger is enabled before continuing the form workflow.
- [ ] Build with `pnpm build`, run `node_modules/.bin/playwright.CMD test tests/e2e/app.spec.ts --grep "creates, edits"`, and confirm failure because the old Trigger has no SVG.

### Task 3: Implement the shared Select layout

- [ ] Import `ChevronDown` from `lucide-react`.
- [ ] Add `flex w-full items-center gap-[var(--space-3)]` to `R.Trigger` while preserving existing sizing, border, background, padding and consumer classes.
- [ ] Add `className="min-w-0 flex-1 text-left"` to `R.Value`.
- [ ] Replace the character icon with `<R.Icon asChild><ChevronDown size={20} strokeWidth={2} className="shrink-0" /></R.Icon>`.
- [ ] Re-run the targeted Vitest file and targeted Electron E2E; confirm both pass.
- [ ] Run `node C:\Users\KokuYu\.agents\skills\impeccable\scripts\detect.mjs --json --scope layout D:\EasyEpi\src\renderer\components\ui\Select.tsx` and verify the JSON result is `[]`; separately confirm arbitrary spacing classes still use existing CSS tokens.

### Task 4: Verify, package and commit

- [ ] Run `pnpm check`; expect lint, typecheck, all unit/coverage tests and production build to exit 0.
- [ ] Run `pnpm test:e2e`; expect the full Electron E2E suite to pass.
- [ ] Run `pnpm build:win`; confirm `release/EasyEpi-0.3.0-setup-x64.exe` and `release/EasyEpi-0.3.0-portable-x64.exe` are freshly generated.
- [ ] In PowerShell, set `$env:EASYEPI_EXECUTABLE=(Resolve-Path 'release/win-unpacked/EasyEpi.exe').Path` and `$env:EASYEPI_USER_DATA_DIR=(Join-Path (Resolve-Path '.').Path 'test-results/packaged-chevron-user-data')`, then run `pnpm test:e2e:packaged`.
- [ ] Set `$env:EASYEPI_EXECUTABLE=(Resolve-Path 'release/EasyEpi-0.3.0-portable-x64.exe').Path` and `$env:EASYEPI_USER_DATA_DIR=(Join-Path (Resolve-Path '.').Path 'test-results/portable-chevron-user-data')`, run `pnpm test:e2e:packaged`, then remove both task-specific environment variables.
- [ ] Review `git diff --check`, commit implementation/tests to `main`, and report EXE paths and SHA-256 hashes.
