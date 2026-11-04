# Offline model behavior evaluations

This harness exercises production prompts, tool schemas, parser behavior and policy-backed decisions without a provider, credentials or tool execution. It belongs to normal source CI. Passing it proves the sanitized corpus and graders work; it does not prove any model behaves well.

Tool management cases cover bounded discovery, explicitly requested integrated
preview, disabled-skill restrictions and uncertain Social send reconciliation.
Their paired controls distinguish valid but inappropriate tool choices from
invalid input. The baseline remains synthetic; passing is not a live-model result.

Assistant rule cases import the production `voiceInstructions`,
`voiceOwnerProfileInstructions` and `captureVoiceOwnerRule` functions. Sanitized
fruit/breakfast exclusions, quoted worker contradictions, manual Finish-turn
pauses and approval/rule-promotion escalation have paired synthetic positive and
negative responses. The graders check bounded format and specified constraints;
they do not certify natural language meaning, acoustic interruption or a model's
compliance. Prompt/source hashes in the report identify the code actually read.

```sh
pnpm exec vitest run --config evals/vitest.config.ts
pnpm exec tsc-rs --noEmit -p evals/tsconfig.json
node evals/run.mjs
node evals/run.mjs --context-only
node --test scripts/checks/context-metrics.test.mjs scripts/checks/repository-usage.test.mjs scripts/checks/quality-patterns.test.mjs
```

`run.mjs` uses the installed Vite transform in memory with middleware mode and no listener. It prints JSON and closes its transform server. It does not build the app/Host or read provider configuration. Save reports below ignored `temp/verification/<id>/`, never alongside the maintained corpus. Package aliases and CI ownership are listed in [the quality reference](../docs/reference/quality.md).

## Corpus and provenance

| Suite        | Production authority                                                                                                                                                | Current sanitized scenarios                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Titles       | `buildThreadTitlePrompt` and `parseGeneratedSessionTitle` in `src/features/sessions/model/sessionTitle.ts`                                                          | Explicit PR/issue, no invented reference, incidental number, Turkish subject, quoted prompt injection and incidental agent/report instructions |
| Tool routing | `conversationToolCatalog()` and `validateConversationTool()` in `host/conversation/conversation-tools.ts`; runtime read definitions in `host/conversation/conversation-runtime-read-tools.ts` | Read an accepted attachment, discover shell metadata; real MCP names and input schemas                                                         |
| Permission   | `SKILL_INVOCATION_GUIDANCE` and `assertSessionGrantScope`                                                                                                           | A skill cannot authorize publication; a changed session scope cannot reuse the previous exact grant                                            |
| Recovery     | `HOST_RPC_METHODS` retry/cancellation policy                                                                                                                        | Reconcile an uncertain dispatch with its original command ID; do not replay a queue read that can mutate leases                                |

Cases are hand-authored, sanitized scenarios motivated by existing production contracts and `sessionTitle.test.ts`. They are not copied user conversations or claimed historical incidents. IDs use fictitious `*-demo` values; the issue URL uses `example/demo`. Do not add personal paths, task content, credentials, grants, real attachment bodies or private repository links.

`baseline.json` is explicitly `synthetic-hand-authored`: its responses were written to exercise the graders. The naive control deliberately copies/truncates titles, chooses the first read tool, trusts skill publication and replays uncertain operations. Positive and negative grader tests must both pass. A stronger control or recorded response may be added with its own provenance; never relabel the synthetic baseline as a model run.

The report records source and prompt SHA-256 hashes, per-criterion results, suite counts and byte metrics. The hashes describe the source read during this local run, not inclusion in a package or installed build. No timestamp or provider randomness is introduced. Source changes can make the corpus expectations stale: production assumption tests must be reviewed rather than updating a baseline merely to make checks pass.

## Grader limits

Titles require JSON-only output, exact keys, production parser parity, explicit work-item metadata, the editorial length and subject fragments. Raw metadata is graded before parser repair so an invented issue cannot disappear into a passing `null`. The production parser deliberately accepts some legacy formats that the model prompt does not ask for; a parser-compatible bare title is still an editorial failure here.

Other scenarios use a constrained evaluation-only JSON decision format. It is not an RPC/tool API, permission engine or replacement for Host checks. Exact expected decisions intentionally cover narrow regressions. Title fragments do not measure arbitrary semantic relevance; successful synthetic decisions do not establish successful recovery, authorization or tool routing in a live session. The tool grader calls the production input validator without dispatching the tool.

Adding a case requires a source-backed failure/contract, sanitized input, provenance, expected criteria, a positive response and a meaningful negative response. Update `cases.ts`, the synthetic baseline only when appropriate, and `graders.test.ts`. Do not test a grader only against its own perfect output.

## Context byte measurements

`context.ts` imports actual title/skill text and the full production conversation MCP tool catalog. It serializes a sanitized snapshot through `SessionSyncSchema` and its WS JSON envelope through `RpcSuccessResponseSchema`. `scripts/checks/context-metrics.mjs` counts the exact serialized UTF-8 strings and reports hashes without copying payload bodies.

Provider context, MCP context, thread transfer and WS JSON message bytes are separate totals. The thread is nested inside the WS result, so summing them would double count. Prompt text is the real text inserted into provider context, not a captured provider-specific request envelope. A full MCP catalog is one possible discovery result; it does not prove a provider consumes or resends all of it on every turn. Compression and WebSocket/TLS/HTTP framing are excluded. These are not tokens, billing, throughput or quality measurements.

`context-baseline.json` records one deterministic sanitized fixture baseline. Comparison is advisory and shows additions, removals and changed measurement boundaries explicitly. A removed fixture does not become an apparent size improvement. There is no budget JSON, threshold, percentage gate or way to shrink a configured budget to skip measurements. Review the actual serialized change before accepting a new baseline.

## Future paid/live evaluations

No live runner is implemented or silently configured. Any future paid run needs explicit owner authorization for the provider/model and a bounded plan: maximum currency cost, requests/cases, input/output allowance, concurrency and deadline. It must fail closed before a call when the bound or approved credential is missing, stop rather than retry beyond the bound, and write separate sanitized recorded responses with source/model/version/provenance and actual usage or explicitly unknown usage. It must not enter ordinary CI or reuse synthetic pass counts as its baseline quality result. This document itself grants no authority for a paid call.

## Voice decision regression corpus

`voiceQuality.test.ts` exercises sanitized, hand-authored text and event cases against the production speech decision policy, feature search vocabulary, locale labels, and proactive briefing gate. It covers acknowledgement and pending-choice controls, Turkish compounds and corrections, and fresh versus stale or duplicate briefings. Search vocabulary is discovery only; it does not grant action authority. These tests exercise decisions, not a complete voice session, tool dispatch, actual model behavior, microphone input, timing, or acoustic performance. No recorded speech or provider call is involved.
