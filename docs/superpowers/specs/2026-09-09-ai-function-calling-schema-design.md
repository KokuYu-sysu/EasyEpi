# AI Function Calling Schema Design

## Problem

EasyEpi can connect to supported OpenAI-Compatible providers, but providers that do not enforce `json_schema` may return localized question types, incorrect primitive types, or extra fields. The local harness correctly rejects those candidates, so users see errors such as `INVALID_TYPE`, `INVALID_QUESTION_TYPE`, and `FORBIDDEN_FIELD` after repair attempts.

The validation boundary must remain strict. The transport should give every compatible model the same explicit output contract before local validation runs.

## Decision

All questionnaire-generation requests use `response_format: { "type": "json_object" }` and declare one OpenAI-Compatible function tool named `submit_questionnaire`. The tool's `parameters` contain the existing versioned questionnaire envelope JSON Schema. `tool_choice` forces that function when the provider accepts tools.

The client reads the JSON string from `tool_calls[0].function.arguments` and passes it unchanged to the existing versioned harness. Ordinary assistant content is not accepted as the questionnaire result while the function path is active.

## Compatibility Fallback

Some OpenAI-Compatible implementations reject `tools`, `tool_choice`, or their combination with `response_format`. When an HTTP error explicitly identifies those parameters as unsupported, EasyEpi records a capability fallback scoped to the provider endpoint and model, retries with `json_object`, and parses the assistant content through the same local harness.

The fallback prompt includes the compact, exact schema contract: allowed keys, question and constraint enums, primitive types, and the prohibition on derived or project fields. There is no text-mode fallback and no weakening of local validation.

Transient HTTP, authentication, quota, and server errors do not mark Function Calling unsupported.

## Response Rules

- Exactly one `submit_questionnaire` call is accepted.
- Its `arguments` must be a non-empty JSON string within existing response-size limits.
- Missing calls, multiple calls, a different function name, malformed arguments, or simultaneous ambiguous payloads produce stable client errors.
- Clarification and questionnaire responses share the current envelope schema and are distinguished by `kind`.
- Repair attempts retain the same forced function call. The repair instruction lists failing paths, expected primitive types, and valid enum values where applicable.

## Data Flow

1. The orchestrator resolves the session's versioned schema.
2. The compatible client sends `json_object`, the `submit_questionnaire` tool, and forced `tool_choice`.
3. The client extracts bounded function arguments.
4. The versioned harness parses and strictly validates the envelope.
5. On validation failure, the orchestrator sends a targeted repair request, up to the existing retry limit.
6. Only a locally valid draft becomes an artifact.

## Security

Function parameters improve model conformance but are not trusted validation. The local harness remains authoritative, rejects unknown fields, preserves regex restrictions, enforces complexity limits, and prevents derived variables or project data from entering an AI draft.

Capability downgrade detection uses bounded provider error text and an explicit allowlist of unsupported-parameter patterns. Model output cannot trigger a capability downgrade.

## Testing

Tests will cover:

- request bodies for forced `submit_questionnaire` calls;
- successful argument extraction for streaming and non-streaming responses;
- malformed, missing, duplicate, and wrong-name tool calls;
- explicit unsupported-tools downgrade to content-based `json_object` parsing;
- no downgrade for transient or authentication failures;
- invalid types, question enums, and forbidden fields followed by a valid repair call;
- unchanged enforcement of local security and complexity limits;
- complete unit, coverage, build, Electron, and packaged-application gates before a replacement 0.8.0 package is delivered.

## Scope

This change only affects questionnaire output negotiation and parsing. It does not add native vendor APIs, relax local validation, change questionnaire storage, or introduce new dependencies.
