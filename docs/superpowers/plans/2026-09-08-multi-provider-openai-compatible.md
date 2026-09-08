# EasyEpi 0.8.0 Multi-Provider OpenAI-Compatible Implementation Plan

> **For Codex:** Follow this plan task by task using test-driven development. Do not add a provider behavior without a failing fixture-based test. Keep provider response bodies and credentials out of errors, logs, IPC, and snapshots.

**Goal:** Support OpenAI, DeepSeek, Gemini, Qwen, Kimi/Moonshot, GLM, xAI, Xiaomi MiMo, and custom OpenAI-Compatible services, including safe use of provider-built-in web search where the selected provider exposes it through an OpenAI-compatible Chat Completions or Responses endpoint.

**Architecture:** Keep the existing Harness and orchestrator authoritative. Introduce a declarative provider registry above shared Chat Completions and Responses transports. Run provider search as a bounded research preflight, normalize its evidence and status, then run the existing structured questionnaire generation. Persist provider identity and the user’s search preference globally; persist negotiated capabilities and bounded research artifacts only inside the encrypted Session cache.

**Tech Stack:** Electron 43, TypeScript 5.9, React 18, Vitest, Testing Library, OpenAI-compatible Chat Completions/SSE and Responses JSON/SSE, electron-vite, electron-builder.

**Approved design:** `docs/superpowers/specs/2026-09-08-multi-provider-openai-compatible-design.md`

---

## Task 1: Add provider identities, presets, and strict shared contracts

**Files:**

- Create: `src/shared/ai-provider-profiles.ts`
- Modify: `src/shared/ai-assistant-contract.ts`
- Create: `tests/unit/shared/ai-provider-profiles.test.ts`
- Modify: `tests/unit/shared/ai-assistant-contract.test.ts` if present; otherwise extend the nearest contract coverage in `tests/unit/main/ai-security-boundaries.test.ts`

**Step 1: Write failing tests**

Cover the exact provider union, unique IDs, official default Base URLs, display names, immutable preset lookup, and strict request parsing for `providerId` and `webSearchEnabled`. Verify unknown providers, extra keys, non-boolean search values, control characters, and unsafe URLs are rejected.

**Step 2: Run the focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/shared/ai-provider-profiles.test.ts tests/unit/main/ai-security-boundaries.test.ts`

**Step 3: Implement the minimum shared registry and contracts**

Define `AIProviderId`, `AI_PROVIDER_PRESETS`, a safe lookup helper, and the public config fields. Keep the registry free of secrets and mutable state. Do not add private request fields here yet.

**Step 4: Run focused tests and typecheck**

Run: `pnpm vitest run tests/unit/shared/ai-provider-profiles.test.ts tests/unit/main/ai-security-boundaries.test.ts`

Run: `pnpm typecheck`

**Step 5: Commit**

```bash
git add src/shared/ai-provider-profiles.ts src/shared/ai-assistant-contract.ts tests/unit/shared/ai-provider-profiles.test.ts tests/unit/main/ai-security-boundaries.test.ts
git commit -m "feat(ai): define provider profiles"
```

## Task 2: Migrate encrypted provider configuration to schema version 2

**Files:**

- Modify: `src/main/services/ai-config.service.ts`
- Modify: `tests/unit/main/services/ai-config.service.test.ts` if present; otherwise create it by extracting existing config coverage from `tests/unit/main/ai-security-boundaries.test.ts`

**Step 1: Write failing migration and preservation tests**

Test version 1 host detection for all known official hosts, unknown-host migration to `custom`, version 2 round trips, `webSearchEnabled`, API Key preservation only when provider and Base URL are unchanged, privacy acceptance preservation, malformed file rejection, and atomic clear behavior.

**Step 2: Run the focused test and confirm RED**

Run: `pnpm vitest run tests/unit/main/services/ai-config.service.test.ts tests/unit/main/ai-security-boundaries.test.ts`

**Step 3: Implement migration and version 2 writes**

Keep version 1 read support. Return version 2 public views from memory, and write version 2 only after an update/accept/clear operation. Never decrypt in renderer-facing methods.

**Step 4: Run tests and typecheck**

Run: `pnpm vitest run tests/unit/main/services/ai-config.service.test.ts tests/unit/main/ai-security-boundaries.test.ts`

Run: `pnpm typecheck`

**Step 5: Commit**

```bash
git add src/main/services/ai-config.service.ts tests/unit/main/services/ai-config.service.test.ts tests/unit/main/ai-security-boundaries.test.ts
git commit -m "feat(ai): migrate provider configuration"
```

## Task 3: Extract provider request policies and endpoint resolution

**Files:**

- Create: `src/main/services/ai-provider-policy.ts`
- Create: `tests/unit/main/services/ai-provider-policy.test.ts`
- Modify: `src/main/services/openai-compatible.client.ts`
- Modify: `tests/unit/main/services/openai-compatible.client.test.ts`

**Step 1: Write failing table-driven tests**

For each provider, assert the resolved Chat and Responses endpoints, required official-host match, structured-output preference, reasoning controls, and absence of all other providers’ private fields. Cover Base URLs ending at `/v1`, `/chat/completions`, and `/responses` without duplicate paths.

Include these initial policies:

- OpenAI: no reasoning extension; JSON schema first.
- DeepSeek official host: disable thinking; `json_object` or text fallback rather than assuming strict schema.
- Gemini official compatibility host: JSON schema where supported; no unrelated native API calls.
- Qwen official compatible-mode hosts: Qwen-only request extensions.
- Moonshot official hosts: disable thinking when required for built-in search.
- GLM official host: GLM-only tool declaration.
- xAI official host: Responses search route.
- MiMo official host: disable thinking for deterministic questionnaire output and MiMo-only search tool.
- Custom: standard fields only.

**Step 2: Run focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/main/services/ai-provider-policy.test.ts tests/unit/main/services/openai-compatible.client.test.ts`

**Step 3: Implement policy selection**

Move the DeepSeek hostname special case out of `openai-compatible.client.ts`. Require both selected provider and an official host match before adding private fields. Preserve localhost support for deterministic tests.

**Step 4: Run focused tests**

Run: `pnpm vitest run tests/unit/main/services/ai-provider-policy.test.ts tests/unit/main/services/openai-compatible.client.test.ts`

**Step 5: Commit**

```bash
git add src/main/services/ai-provider-policy.ts src/main/services/openai-compatible.client.ts tests/unit/main/services/ai-provider-policy.test.ts tests/unit/main/services/openai-compatible.client.test.ts
git commit -m "refactor(ai): centralize provider request policies"
```

## Task 4: Generalize structured-output and streaming capability negotiation

**Files:**

- Modify: `src/main/services/openai-compatible.client.ts`
- Modify: `src/main/services/openai-stream.parser.ts`
- Modify: `tests/unit/main/services/openai-compatible.client.test.ts`

**Step 1: Write failing compatibility fixtures**

Add JSON and SSE fixtures for null content, reasoning-only deltas, usage-only terminal chunks, JSON schema rejection, JSON object rejection, stream rejection, and strict final-choice failures. Assert capability fallback order `json_schema -> json_object -> text` where permitted, with no retry after readable output.

**Step 2: Run the focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/main/services/openai-compatible.client.test.ts`

**Step 3: Implement minimum negotiation changes**

Replace the boolean response-format state with an explicit level while preserving migration from cached booleans. Keep streaming independent. Expand only narrowly identified unsupported-parameter patterns; do not downgrade on generic 400, auth, quota, timeout, DNS/TLS, or server errors.

**Step 4: Run tests and typecheck**

Run: `pnpm vitest run tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-questionnaire.orchestrator.test.ts`

Run: `pnpm typecheck`

**Step 5: Commit**

```bash
git add src/main/services/openai-compatible.client.ts src/main/services/openai-stream.parser.ts tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-questionnaire.orchestrator.test.ts
git commit -m "feat(ai): negotiate provider output capabilities"
```

## Task 5: Add a bounded OpenAI-compatible Responses transport

**Files:**

- Create: `src/main/services/openai-responses.client.ts`
- Create: `src/main/services/openai-responses.parser.ts`
- Create: `tests/unit/main/services/openai-responses.client.test.ts`
- Create: `tests/unit/main/services/openai-responses.parser.test.ts`

**Step 1: Write failing JSON/SSE parser tests**

Cover final output text, URL citations, Responses output items, streaming text deltas, completed events, refusal/error events, unknown events, malformed JSON, duplicate terminal events, byte/event/text limits, timeout, cancellation, and secret-bearing provider errors.

**Step 2: Run focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/main/services/openai-responses.client.test.ts tests/unit/main/services/openai-responses.parser.test.ts`

**Step 3: Implement the narrow transport**

Support only the fields needed for provider-built-in search: model, bounded text input, `tools: [{ type: 'web_search' }]`, optional approved domain filters, stream, signal, and callbacks. Return normalized text, citations, usage presence, and whether search actually ran. Do not implement file, MCP, code execution, storage, or arbitrary tools.

**Step 4: Run tests and typecheck**

Run: `pnpm vitest run tests/unit/main/services/openai-responses.client.test.ts tests/unit/main/services/openai-responses.parser.test.ts`

Run: `pnpm typecheck`

**Step 5: Commit**

```bash
git add src/main/services/openai-responses.client.ts src/main/services/openai-responses.parser.ts tests/unit/main/services/openai-responses.client.test.ts tests/unit/main/services/openai-responses.parser.test.ts
git commit -m "feat(ai): add bounded responses transport"
```

## Task 6: Implement provider-built-in research adapters

**Files:**

- Create: `src/main/services/ai-research.service.ts`
- Create: `tests/unit/main/services/ai-research.service.test.ts`
- Modify: `src/main/services/ai-provider-policy.ts`
- Modify: `tests/unit/main/services/ai-provider-policy.test.ts`

**Step 1: Write failing provider fixtures**

Assert exact allowed search behavior:

- OpenAI and xAI Responses `web_search`.
- OpenAI Chat `web_search_options` only for the documented search-model family.
- Gemini compatibility extensions only for supported official models, otherwise unsupported.
- Qwen `enable_search` and approved `search_options`.
- Kimi `builtin_function.$web_search`, unchanged bounded arguments round trip, thinking disabled, unknown tool rejection, and maximum tool rounds.
- GLM Chat `web_search` tool shape.
- MiMo Chat `web_search` tool shape and source annotations.
- DeepSeek direct and custom return unsupported without a network request.

Verify PubMed, Web of Science, Cochrane, WHO, CDC, and National Health Commission priorities appear in the research prompt. Verify domain filters are sent only where the vendor officially supports them.

**Step 2: Run focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/main/services/ai-research.service.test.ts tests/unit/main/services/ai-provider-policy.test.ts`

**Step 3: Implement normalized research results**

Return one of `searched`, `not_needed`, `disabled`, `unsupported`, or `failed`, plus bounded evidence text and validated HTTPS citations. The service must never execute arbitrary function calls or fetch citation URLs.

**Step 4: Run focused tests and security tests**

Run: `pnpm vitest run tests/unit/main/services/ai-research.service.test.ts tests/unit/main/ai-security-boundaries.test.ts`

**Step 5: Commit**

```bash
git add src/main/services/ai-research.service.ts src/main/services/ai-provider-policy.ts tests/unit/main/services/ai-research.service.test.ts tests/unit/main/services/ai-provider-policy.test.ts tests/unit/main/ai-security-boundaries.test.ts
git commit -m "feat(ai): add provider built-in research"
```

## Task 7: Integrate research preflight with the questionnaire orchestrator

**Files:**

- Modify: `src/main/services/ai-questionnaire.orchestrator.ts`
- Modify: `src/main/services/ai-questionnaire.harness.ts`
- Modify: `src/main/services/ai-session.repository.ts`
- Modify: `src/shared/ai-assistant-contract.ts`
- Modify: `tests/unit/main/services/ai-questionnaire.orchestrator.test.ts`
- Modify: `tests/unit/main/services/ai-questionnaire.harness.test.ts`
- Modify: `tests/unit/main/services/ai-session.repository.test.ts`

**Step 1: Write failing orchestration tests**

Cover search-before-generation, evidence delimiting, no-search normal flow, search failure continuing to generation, cancellation in both stages, research capability caching, encrypted Session cache scoping, cache clear, and ensuring search fallback does not consume a Harness generation attempt.

**Step 2: Run focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/services/ai-questionnaire.harness.test.ts tests/unit/main/services/ai-session.repository.test.ts`

**Step 3: Implement the two-stage flow**

Add a versioned research-context prompt section that treats all evidence as untrusted quoted material. Replace unconditional “use Web Search” claims with exact status-aware wording. Do not change the Harness rule that only validated questionnaire envelopes may create or update an artifact.

**Step 4: Run focused and security tests**

Run: `pnpm vitest run tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/services/ai-questionnaire.harness.test.ts tests/unit/main/services/ai-session.repository.test.ts tests/unit/main/ai-security-boundaries.test.ts`

**Step 5: Commit**

```bash
git add src/main/services/ai-questionnaire.orchestrator.ts src/main/services/ai-questionnaire.harness.ts src/main/services/ai-session.repository.ts src/shared/ai-assistant-contract.ts tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/services/ai-questionnaire.harness.test.ts tests/unit/main/services/ai-session.repository.test.ts tests/unit/main/ai-security-boundaries.test.ts
git commit -m "feat(ai): integrate evidence research preflight"
```

## Task 8: Expose provider and research status through IPC

**Files:**

- Modify: `src/main/ipc/ai.ipc.ts`
- Modify: `src/preload/desktop-api.ts`
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/shared/ai-assistant-contract.ts`
- Modify: `tests/unit/main/ai-ipc.test.ts` if present; otherwise `tests/unit/main/ai-security-boundaries.test.ts`
- Modify: `tests/unit/preload/desktop-api.test.ts`

**Step 1: Write failing contract and boundary tests**

Test the new config fields and the five research statuses. Assert provider bodies, research正文, API Keys, unsafe URLs, arbitrary annotations, and extra response keys cannot cross IPC. Test stable error mapping for 401/403, 404, 429, 5xx, network, TLS, timeout, and cancellation.

**Step 2: Run focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/main/ai-security-boundaries.test.ts tests/unit/preload/desktop-api.test.ts`

**Step 3: Implement minimal IPC changes**

Thread `providerId` and `webSearchEnabled` from configuration to main-process requests. Emit bounded research progress/status events and sanitized citations. Connection testing must remain search-free.

**Step 4: Run tests and typecheck**

Run: `pnpm vitest run tests/unit/main/ai-security-boundaries.test.ts tests/unit/preload/desktop-api.test.ts`

Run: `pnpm typecheck`

**Step 5: Commit**

```bash
git add src/main/ipc/ai.ipc.ts src/preload/desktop-api.ts src/shared/desktop-api.ts src/shared/ai-assistant-contract.ts tests/unit/main/ai-security-boundaries.test.ts tests/unit/preload/desktop-api.test.ts
git commit -m "feat(ai): expose provider research status"
```

## Task 9: Build provider settings and search disclosure UI

**Files:**

- Modify: `src/renderer/components/ai/AIProviderSettings.tsx`
- Modify: `src/renderer/pages/AIQuestionnairePage.tsx`
- Modify: `src/renderer/components/ai/AIRunProgress.tsx`
- Modify: `src/renderer/components/ai/ai-errors.ts`
- Modify: `tests/unit/renderer/ai-provider-settings.test.tsx`
- Modify: `tests/unit/renderer/AIQuestionnairePage.test.tsx`

**Step 1: Write failing interaction and accessibility tests**

Cover selecting all eight presets and custom, default URL adoption, unsaved-change protection, API Key clearing rules, search-fee disclosure, search toggle persistence, search-free connection testing, five research statuses, safe clickable citations, and actionable provider error messages. Verify labels, keyboard access, live regions, and no raw error detail.

**Step 2: Run focused tests and confirm RED**

Run: `pnpm vitest run tests/unit/renderer/ai-provider-settings.test.tsx tests/unit/renderer/AIQuestionnairePage.test.tsx`

**Step 3: Implement the UI**

Use existing UI primitives and design tokens. Keep the model input editable instead of shipping a fast-staling exhaustive model list. Display “可能产生额外费用，且可能需在厂商控制台开通” beside the enabled search control.

**Step 4: Run focused tests and typecheck**

Run: `pnpm vitest run tests/unit/renderer/ai-provider-settings.test.tsx tests/unit/renderer/AIQuestionnairePage.test.tsx`

Run: `pnpm typecheck`

**Step 5: Commit**

```bash
git add src/renderer/components/ai/AIProviderSettings.tsx src/renderer/pages/AIQuestionnairePage.tsx src/renderer/components/ai/AIRunProgress.tsx src/renderer/components/ai/ai-errors.ts tests/unit/renderer/ai-provider-settings.test.tsx tests/unit/renderer/AIQuestionnairePage.test.tsx
git commit -m "feat(ai): add provider and search controls"
```

## Task 10: Update documentation and deterministic manual fixtures

**Files:**

- Modify: `docs/AI_ASSISTANT_MANUAL_TEST.md`
- Modify: `docs/PRD.md`
- Modify: `docs/REVISE.md` only if it contains a completion checklist for this release
- Modify: `README.md`
- Create or modify: local AI stub scripts under the existing `scripts/` convention

**Step 1: Add the local fixture scenarios**

Document and automate one deterministic request/response fixture for every provider without using real credentials. Include endpoint, body, SSE shape, search/tool loop, citation, downgrade, auth, rate limit, network, timeout, and cancellation cases.

**Step 2: Update user-facing documentation**

Document provider presets, official Base URLs, custom behavior, search billing warning, the meaning of every search status, and the rule that unsupported search continues offline with disclosure.

**Step 3: Run documentation-linked tests**

Run the focused stub command added by this task, then:

Run: `pnpm vitest run tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/openai-responses.client.test.ts tests/unit/main/services/ai-research.service.test.ts`

**Step 4: Commit**

```bash
git add docs/AI_ASSISTANT_MANUAL_TEST.md docs/PRD.md docs/REVISE.md README.md scripts
git commit -m "docs(ai): document multi-provider setup"
```

## Task 11: Full verification, live authorized smoke test, and 0.8.0 packaging

**Files:**

- Modify only files required by defects discovered during verification
- Output: `release/EasyEpi-0.8.0-setup-x64.exe`
- Output: `release/EasyEpi-0.8.0-portable-x64.exe`

**Step 1: Run the complete quality gate**

Run: `pnpm check`

Expected: lint, typecheck, all unit tests, configured coverage thresholds, and production build pass.

**Step 2: Run Electron end-to-end coverage**

Run: `pnpm test:e2e`

Fix only reproducible product failures; rerun the failing test first, then the full E2E set.

**Step 3: Run authorized live smoke tests**

Use only already configured user credentials. Test ordinary generation and, if enabled by the user, built-in search for the configured provider. Never print keys or raw provider responses. If credentials for other vendors are absent, report those vendors as fixture-verified rather than live-verified.

**Step 4: Build Windows artifacts**

Run: `pnpm build:win`

**Step 5: Verify artifacts**

Check that both expected files exist, inspect version metadata, run `pnpm test:e2e:packaged` where supported, and calculate SHA-256 for both artifacts.

**Step 6: Commit any final verification-only changes**

```bash
git add <only files changed to fix verified defects>
git commit -m "test(release): verify multi-provider 0.8.0"
```

Do not commit generated installers unless the repository’s existing release policy tracks them.
