---
name: feature-decision-models
description: Use when changing Host decision routing, adapters, confidence and catalog. Not for provider sign-in; see feature-providers.
---

# Decision models

Owns the Host side of decision models in `host/decision-models/`: the `decide` gateway, contract adapters, the static provider catalog, per-task routing, the confidence scale and the evaluation set. It does not own the settings UI (`src/features/decision-models/`), local runtime install and discovery (`discovery.ts`, `hardware.ts`, `local-install.ts`, `local-runtime.ts`, `gguf.ts`), the saved config file (`decision-config.ts`, `decision-service.ts`) or the owner RPC (`host/server/rpc-decision-models.ts`). Callers such as Social and AI tools use only the `decide` operation and must handle `error` answers.

## Source starts

- `host/decision-models/decision-gateway.ts`: `createDecisionGateway`, the decide pipeline, answer cache and audit.
- `host/decision-models/contract-adapters/`: one adapter per contract. `common.ts` holds shared types, request checks, chunking and distribution answers. `http.ts` holds the HTTP transport.
- `host/decision-models/router.ts`: source order per task and the personal-data filter.
- `host/decision-models/confidence.ts`: the confidence formulas.
- `host/decision-models/catalog.ts` and `catalog.json`: the versioned catalog and its loader.
- `host/decision-models/evaluation.ts`: the fixed evaluation set and accuracy.
- `host/decision-models/fixtures/`: recorded Clef responses and contract-assumption fixtures.

## Workflow

1. Read the wire contract in `src/shared/model/host-contracts/decision-models.ts` and the Host types in `decision-types.ts`.
2. Change a provider contract in its adapter file and its fixture. Keep the adapter's request shape, answer parsing and error mapping together.
3. Change the confidence rule only in `confidence.ts`, then update its tests. The threshold itself lives in `DEFAULT_THRESHOLD` and per-task routes.
4. Change catalog values only when a source confirms them. An unconfirmed field stays out and the entry carries `verified: false`.
5. Run the focused checks below. If the owner RPC or the config shape changed, that change belongs to its owner.

## Preserve

- Confidence is the gateway's own scale. Provider values stay in `raw`; thresholds compare only the gateway value. For noul it is max(p, 1 - p), so the default 0.85 accepts p >= 0.85 or p <= 0.15.
- With local-only personal data on, only sources of kind `local` whose endpoint is loopback can answer. Nothing falls back to a remote source for such data.
- API keys are read from the vault by `secretRef`, sent only as a bearer header, and never written to config, logs, audit entries or error messages.
- Endpoints must be HTTPS, or loopback HTTP. Credentials in the URL are refused. Redirects are errors. Response bodies are size-bounded and never logged.
- Only retryable failures are retried (408, 429, 5xx, network), with fixed backoff inside the request deadline.
- The answer cache and audit belong to one gateway instance. The audit keeps counts, confidences and error codes, never state, question text or answers.
- A below-threshold answer is never returned as a value. The caller sees `below_threshold` and moves on.
- Decisions, Ollama and custom layouts and the llm-structured prompt are contract assumptions. Their fixtures say so, and their catalog entries stay unverified.
- Adapter limits are defaults, not per-provider values. A question that does not fit a source's limits is skipped for that source only.

## Focused checks

`pnpm exec vitest run --config host/vitest.config.ts host/decision-models host/server/rpc-decision-models.test.ts`.

## References

- [Decision models](../../../docs/integrations/decision-models.md) for the request and answer contract, routing, the verification rule for catalog entries and the owner RPC list.
- [Social integration](../../../docs/integrations/social.md) for the Social browser decision layer, the main caller.
