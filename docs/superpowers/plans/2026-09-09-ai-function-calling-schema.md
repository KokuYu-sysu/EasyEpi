# AI Function Calling Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every supported OpenAI-Compatible questionnaire request use `json_object` plus a forced `submit_questionnaire` function whose parameters contain the versioned questionnaire JSON Schema.

**Architecture:** Extend the existing compatible client rather than adding a vendor abstraction. The client owns tool declaration, bounded tool-call extraction, and explicit unsupported-tools negotiation; the orchestrator persists that capability per endpoint and model, while the existing harness remains the authoritative validator.

**Tech Stack:** TypeScript, Electron, OpenAI-Compatible Chat Completions, Vitest, Playwright, electron-builder.

## Global Constraints

- Every generation request uses `response_format: { "type": "json_object" }`; there is no text response-format fallback.
- The primary path forces exactly one `submit_questionnaire` function call with the registered schema as `parameters`.
- Only explicit HTTP 400/422 unsupported-parameter responses may disable Function Calling for an endpoint and model.
- Function arguments remain untrusted and must pass the existing local harness unchanged.
- No native vendor APIs, new runtime dependencies, relaxed validation, or questionnaire-storage changes.

---

### Task 1: Non-streaming Function Calling Contract

**Files:**
- Modify: `src/main/services/openai-compatible.client.ts`
- Test: `tests/unit/main/services/openai-compatible.client.test.ts`
- Test: `tests/unit/main/services/ai-questionnaire.harness.test.ts`

**Interfaces:**
- Consumes: `providerSchema(schemaVersion)` and `AIChatCompletionRequest.schemaVersion`.
- Produces: `toolCallingSupported?: boolean` on requests, `toolCallingSupported: boolean` on results, and capability callback value `function_call`.
- Produces: a Chat Completions request containing `response_format`, `tools`, and forced `tool_choice`.

- [ ] **Step 1: Write failing request-body and extraction tests**

Add literal assertions that a request contains:

```ts
expect(body).toMatchObject({
  response_format: { type: 'json_object' },
  tools: [{
    type: 'function',
    function: {
      name: 'submit_questionnaire',
      parameters: expect.objectContaining({
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'assistantMessage', 'rollingSummary', 'options', 'questionnaire']
      })
    }
  }],
  tool_choice: { type: 'function', function: { name: 'submit_questionnaire' } }
})
```

Return a real Chat Completions fixture with `finish_reason: "tool_calls"`, `content: null`, and exactly one tool call whose `function.arguments` is a valid envelope. Assert `result.content` equals those arguments and `result.toolCallingSupported` is `true`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm vitest run tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-questionnaire.harness.test.ts
```

Expected: FAIL because requests still use `json_schema` and tool-call completions are rejected.

- [ ] **Step 3: Implement the smallest non-streaming tool contract**

Extend the request and result types:

```ts
toolCallingSupported?: boolean
onCapabilityFallback?: (capability: 'streaming' | 'response_format' | 'function_call') => void

export interface AIChatCompletionResult {
  content: string
  streamingSupported: boolean
  responseFormatSupported: boolean
  toolCallingSupported: boolean
}
```

Build the primary request fields from the existing registered schema:

```ts
response_format: { type: 'json_object' },
tools: [{
  type: 'function',
  function: {
    name: 'submit_questionnaire',
    parameters: providerSchema(request.schemaVersion)
  }
}],
tool_choice: { type: 'function', function: { name: 'submit_questionnaire' } }
```

Add one bounded extractor that accepts exactly one choice, one tool call, the expected function name, and a non-empty string `arguments`; return the arguments string as `content`. Reject ordinary content on the tool path with `AI_INVALID_RESPONSE`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: both test files pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/services/openai-compatible.client.ts tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-questionnaire.harness.test.ts
git commit -m "feat(ai): force questionnaire function calls"
```

### Task 2: Streaming Tool-Call Assembly

**Files:**
- Modify: `src/main/services/openai-stream.parser.ts`
- Modify: `src/main/services/openai-compatible.client.ts`
- Test: `tests/unit/main/services/openai-compatible.client.test.ts`

**Interfaces:**
- Consumes: OpenAI-compatible `delta.tool_calls[0].function.arguments` fragments.
- Produces: `StreamCompletionEvidence.toolArguments?: string` while preserving existing bounded SSE parsing.

- [ ] **Step 1: Write failing streaming tests**

Create literal SSE fixtures that split a valid envelope across multiple `function.arguments` fragments, finish with `finish_reason: "tool_calls"`, and then send `[DONE]`. Assert the client returns the reconstructed envelope. Add separate rejection tests for changing tool-call index, wrong function name, multiple calls, content mixed with tool arguments, and arguments exceeding `maxStreamContentCharacters`.

- [ ] **Step 2: Run the streaming tests and verify RED**

Run:

```powershell
pnpm vitest run tests/unit/main/services/openai-compatible.client.test.ts
```

Expected: FAIL because the current parser treats any streamed tool call as invalid.

- [ ] **Step 3: Assemble one expected tool call in the existing parser**

Track only call index `0`, function name `submit_questionnaire`, and string argument fragments. Count argument characters against the existing content limit. Return either ordinary content evidence or tool arguments evidence, never both. On the function path, do not emit partial `assistant_delta` events because arguments are an incomplete JSON document; continue emitting `model_streaming` once.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: all compatible-client tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/services/openai-stream.parser.ts src/main/services/openai-compatible.client.ts tests/unit/main/services/openai-compatible.client.test.ts
git commit -m "feat(ai): parse streamed questionnaire tool calls"
```

### Task 3: Explicit Unsupported-Tools Downgrade

**Files:**
- Modify: `src/main/services/openai-compatible.client.ts`
- Modify: `tests/unit/main/services/openai-compatible.client.test.ts`

**Interfaces:**
- Consumes: bounded HTTP 400/422 provider error text.
- Produces: a retry without `tools` or `tool_choice`, still with `response_format: { type: 'json_object' }`, and `toolCallingSupported: false`.

- [ ] **Step 1: Write failing negotiation tests**

Test explicit messages such as `unknown parameter: tools` and `tool_choice is not supported`. Assert the second request omits only Function Calling fields, keeps `json_object`, parses `message.content`, and reports one `function_call` fallback. Assert 401, 429, 500, timeout, and generic 400 errors do not downgrade.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm vitest run tests/unit/main/services/openai-compatible.client.test.ts
```

Expected: FAIL because Function Calling has no independent capability negotiation.

- [ ] **Step 3: Implement allowlisted downgrade detection**

Extend `unsupportedCapability` with `function_call` patterns limited to the parameter names `tools`, `tool_choice`, and `function_call`. Start with tools unless `request.toolCallingSupported === false`. On an explicit rejection, call `onCapabilityFallback('function_call')`, retry without tools, and keep `json_object`. Remove the `json_schema -> json_object -> text` negotiation path; a provider that rejects `json_object` returns the stable provider error.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: all compatible-client tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/services/openai-compatible.client.ts tests/unit/main/services/openai-compatible.client.test.ts
git commit -m "fix(ai): downgrade unsupported function calling safely"
```

### Task 4: Persist Capability and Improve Repair Instructions

**Files:**
- Modify: `src/main/services/ai-questionnaire.orchestrator.ts`
- Modify: `src/shared/ai-assistant-contract.ts`
- Modify: `src/renderer/pages/AIQuestionnairePage.tsx`
- Test: `tests/unit/main/services/ai-questionnaire.orchestrator.test.ts`
- Test: `tests/unit/main/ai-security-boundaries.test.ts`

**Interfaces:**
- Consumes: `AIChatCompletionResult.toolCallingSupported` and the `function_call` fallback event.
- Produces: endpoint/model-scoped `cap-function-call-*` cache state and a user-visible fallback notice.

- [ ] **Step 1: Write failing orchestrator and public-boundary tests**

Assert that an explicit client fallback is persisted and passed into the next request as `toolCallingSupported: false`; a different model starts with an unknown capability. Assert public progress validation accepts only `streaming`, `response_format`, and `function_call`. Add a repair test whose first failure includes `INVALID_QUESTION_TYPE`, `INVALID_TYPE`, and `FORBIDDEN_FIELD`, then assert the second request still forces Function Calling and its repair instruction contains the exact paths plus the valid question-type enum.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm vitest run tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/ai-security-boundaries.test.ts
```

Expected: FAIL because the capability and enum-aware repair guidance do not exist.

- [ ] **Step 3: Persist Function Calling capability**

Build `cap-function-call-${capabilityKey}` beside the streaming key, read it before calling the client, update it from the result, and persist it through the existing session content-cache functions. Extend the public event union and renderer notice for `function_call`; do not expose provider error bodies.

- [ ] **Step 4: Add compact enum-aware repair guidance**

Keep the existing bounded error list and append this fixed contract only when the selected errors include the relevant codes:

```text
Allowed question.type values: single_choice, multiple_choice, fixed_length, free_text, numeric_range, date.
Use JSON strings for id/content/variableName/defaultValue/skipValue and option value/label; JSON booleans for isKey/allowSkip; JSON numbers for order and numeric constraint fields. Remove every field not declared by submit_questionnaire.
```

Do not normalize, rename, coerce, or delete fields locally before validation.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: both test files pass.

- [ ] **Step 6: Commit**

```powershell
git add src/main/services/ai-questionnaire.orchestrator.ts src/shared/ai-assistant-contract.ts src/renderer/pages/AIQuestionnairePage.tsx tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/ai-security-boundaries.test.ts
git commit -m "fix(ai): persist function calling capability"
```

### Task 5: Release Regression and Replacement 0.8.0 Packages

**Files:**
- Modify only if tests reveal a defect in the files above.
- Output: `release/EasyEpi-0.8.0-setup-x64.exe`
- Output: `release/EasyEpi-0.8.0-portable-x64.exe`

**Interfaces:**
- Consumes: the completed Function Calling transport.
- Produces: verified replacement Windows x64 packages and SHA-256 hashes.

- [ ] **Step 1: Run the complete quality gate**

```powershell
pnpm check
```

Expected: lint and typecheck pass, all unit tests pass with configured coverage thresholds, and the production build succeeds.

- [ ] **Step 2: Run Electron end-to-end tests**

```powershell
pnpm test:e2e
```

Expected: all Electron workflow tests pass.

- [ ] **Step 3: Build replacement packages**

```powershell
pnpm build:win
```

Expected: both 0.8.0 x64 executables and the installer blockmap are regenerated.

- [ ] **Step 4: Run packaged acceptance tests**

Set `EASYEPI_EXECUTABLE` to the new portable executable and `EASYEPI_USER_DATA_DIR` to a new absolute directory under `.tmp`, then run:

```powershell
pnpm test:e2e:packaged
```

Expected: all six portable-package scenarios pass. Repeat against `release/win-unpacked/EasyEpi.exe`; its production-launch scenario passes and portable-only scenarios skip.

- [ ] **Step 5: Verify version and hashes**

Use `Get-Item`, `Get-FileHash -Algorithm SHA256`, and `Get-AuthenticodeSignature` on both executables. Confirm file and product versions are `0.8.0`, report exact hashes, and state whether a signing certificate is present.

- [ ] **Step 6: Commit any release-test-only correction**

If no source or test correction was required, do not create an empty commit. If a correction was required, commit only its tested files with a specific `fix(ai):` or `test(release):` message.
