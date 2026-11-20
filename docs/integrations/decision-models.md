# Decision models

For folder setup and settings, see [Manage decision models](../guides/decision-models.md).

Decision models answer narrow questions with a typed answer and a confidence value. Examples
are whether a screen is a login page, which visible element to choose, or whether a comment is
an opt-out. The Host gateway is the only way Social and AI tools call them. Callers never talk to
a provider directly.

## Request and answer

A caller sends one decision request with a task type and one question. Question kinds are
`choice` (one option from a list), `noul` (yes or no) and `score` (ordered levels). The Host
returns either an answer or an error:

- `below_threshold`: the answer's confidence is under the route's threshold. The value is not
  returned. Callers treat this as "no decision" and move on.
- `unavailable`: no configured source can answer for this task, or every source failed.
- `config_damaged`: the saved settings file cannot be read, so no source was tried. Callers
  treat it as "no decision" like the others. Settings reads and saves fail with the same
  distinct error (code `config_damaged`) instead of showing an empty default config; the
  message names only a coarse reason and the first invalid field, never file content. The
  damaged original stays on disk with an evidence copy until the owner repairs it.

Task types are closed. They are `screen_state`, `element_choice`, `audience_classify`,
`interest_score`, `sentiment`, `optout`, `inbox_priority` and `generic`.

Confidence is the gateway's own scale in [0, 1]. Provider values stay in the raw field. For a
yes/no question with probability p, confidence is max(p, 1 - p). With the default threshold of
0.85, an answer is accepted only when p is at least 0.85 or at most 0.15.

## Sources and routing

A source is one configured provider: a local runtime, an HTTP API, a gateway or an LLM with a
structured prompt. Each source uses an adapter for its wire format. Adapters are `systemone`
(local Clef contract), `ollama-systemone`, `http`, `llm-structured`, `decisions` and `custom`.
Adapter limits are defaults. A question that does not fit one source's limits is skipped for that
source only.

Routing is per task type. A route lists source IDs in order and a threshold. With local-only
personal data enabled, only local sources on a loopback endpoint may answer. Nothing falls back
to a remote source for that data.

Credentials are read from the vault by reference, sent only as a bearer header, and never written
to config, logs, audit entries or error messages. Endpoints must be HTTPS or loopback HTTP.
Redirects and credentials in URLs are refused. Only retryable failures (408, 429, 5xx, network)
are retried, within the request deadline.

The audit keeps counts, confidences and error codes. It never keeps question text, state or
answers.

## Catalog and verification

The provider catalog is a versioned static file (`host/decision-models/catalog.json`). Each
entry and each unconfirmed field carries `verified: false`. Only the local Clef contract is marked
verified, and that mark comes from a recorded local run. Prices, endpoints and limits for other
providers come from public sources and are not verified.

Do not promote a catalog value to verified without a source you can cite. The fixtures under
`host/decision-models/fixtures/` record the contract assumptions for Decisions, Ollama and custom
layouts. Their tests state that they are assumptions.

## Owner surfaces

- Settings > Decision models: `ProviderDecisionModels.tsx` in
  `src/features/settings/ui/` hosts `src/features/decision-models/ui/`. It runs against the
  local-sync machine, or the first listed machine when none is local. With no
  machine available, it shows guidance to connect this computer's Host.
- Owner RPC (`host/server/rpc-decision-models.ts`): `decisionModels.catalog.get`,
  `routing.get`, `routing.set`, `local.status`, `decide`, `sources.add`, `sources.update`,
  `sources.remove`, `sources.test`, `sources.evaluate`, `discovery.scan`, `discovery.cancel`, `discovery.results`,
  `discovery.settings.get`, `discovery.settings.set`, `manual.verify`, `firstRun.get` and
  `firstRun.set`. Only the owner changes configuration. Callers use `decide`.
- Discovery cache: the service keeps the last finished scan in memory. `discovery.results` stamps
  it with `scannedAt` while it is trusted; an empty answer (an incomplete one still carries
  `incomplete`) stops being trusted after 24 hours or when `extraPorts`/`extraFolders` change,
  and then answers without `scannedAt`. The settings page auto-scans only on an empty answer
  without `scannedAt` (an older Host never sets it). `discovery.scan` always scans and a scan that
  throws caches nothing.
- Local install RPC: `local.install` waits for the whole download and is the only call an older
  Host has. A Host that advertises `decisionModels.install.v1` also answers `local.installStart`
  (returns at once; one run per model, a second call joins it), `local.installProgress` (bytes of
  the running install, or how the last one ended: installed, failed with a path-free message, or
  cancelled) and `local.cancelInstall`. A finished detached install is registered as a stopped
  local source before it reports `installed`. The settings wizard asks the Host's capabilities
  first and falls back to `local.install` on an older Host, without progress or cancel.
- Local runtime install and discovery (`discovery.ts`, `hardware.ts`, `local-install.ts`,
  `local-runtime.ts`) are owned by the settings feature. They are not part of the gateway contract.

## Limits

No live provider acceptance is established by fixtures or unit tests. Each source needs its own
live check on the intended host before a route depends on it. Decision answers are advice for
the caller. The caller still applies its own policy, approval and send gates.

## Related

- [Social integration](social.md): the browser decision layer uses this gateway for unexpected
  screens. It can only choose among recognized, non-human states.
- Skill for maintainers: `.agents/skills/feature-decision-models/SKILL.md`.
