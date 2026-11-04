import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cases } from "./cases";
import baseline from "./baseline.json";
import { gradeResponse, naiveResponse } from "./graders";
import { buildCasePrompt } from "./production";
import { contextMetrics } from "./context";
import contextBaseline from "./context-baseline.json";
import { comparePayloadReports } from "../scripts/checks/context-metrics.mjs";

const sources = [
  "src/features/voice/model/realtimeVoice.ts",
  "src/features/voice/model/voiceOwner.ts",
  "src/features/voice/model/voiceOwnerRules.ts",
  "evals/assistantRules.ts",
  "src/features/sessions/model/sessionTitle.ts",
  "src/integrations/harness/core/skillGuidance.ts",
  "host/conversation/conversation-runtime-read-tools.ts",
  "host/conversation/conversation-tools.ts",
  "host/tool-management.ts",
  "host/social/social-tools.ts",
  "src/integrations/harness/core/toolWorkflowGuidance.ts",
  "src/integrations/harness/core/skillPolicy.ts",
  "host/session-authority.ts",
  "src/shared/model/host-contracts/methods.ts",
  "src/shared/model/host-contracts/schemas.ts",
  "src/shared/model/host-contracts/session-reads.ts",
  "evals/cases.ts",
  "evals/baseline.json",
  "evals/graders.ts",
  "evals/production.ts",
  "evals/context-baseline.json",
  "evals/context.ts",
  "scripts/checks/context-metrics.mjs",
];

export function createOfflineReport() {
  const responses: Record<string, string> = baseline.responses;
  const results = cases.map((item) => ({
    id: item.id,
    suite: item.suite,
    promptSha256: createHash("sha256").update(buildCasePrompt(item)).digest("hex"),
    syntheticBaseline: gradeResponse(item, responses[item.id] ?? ""),
    naiveControl: gradeResponse(item, naiveResponse(item)),
  }));
  const context = contextMetrics();
  return {
    schemaVersion: 1,
    execution: "offline-only; no provider client, credentials, paid calls or live tool execution",
    baseline: { kind: baseline.kind, provenance: baseline.provenance },
    interpretation:
      "Synthetic baseline passes validate the offline corpus and graders, not any model. Deterministic title fragments and constrained decisions do not establish general behavior, safety or live quality.",
    sourceSha256: Object.fromEntries(
      sources.map((name) => [
        name,
        createHash("sha256")
          .update(readFileSync(new URL(`../${name}`, import.meta.url)))
          .digest("hex"),
      ]),
    ),
    suites: [...new Set(cases.map((item) => item.suite))].map((suite) => {
      const items = results.filter((item) => item.suite === suite);
      return {
        suite,
        cases: items.length,
        syntheticBaselinePasses: items.filter((item) => item.syntheticBaseline.pass).length,
        naiveControlPasses: items.filter((item) => item.naiveControl.pass).length,
      };
    }),
    results,
    context: {
      ...context,
      baselineKind: contextBaseline.baselineKind,
      baselineComparison: comparePayloadReports(contextBaseline, context),
    },
  };
}
