import type { ReactNode } from "react";
import { Bot, File, Globe, Laptop, Server } from "../../../shared/ui/icons";
import type { DecisionSourceKind, DiscoveryCandidate } from "../model/decisionTypes";

/** A 32px well holding a kind glyph; decorative, the name always sits beside it. */
function SourceIconWell({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--ui-fill-subtle) text-(--ui-text-secondary)"
    >
      {children}
    </span>
  );
}

/** Local: this computer. API: a hosted service. Gateway: an endpoint. LLM: a model behind a prompt. */
export function SourceKindIcon({ kind }: { kind: DecisionSourceKind }) {
  const Icon =
    kind === "local" ? Laptop : kind === "api" ? Globe : kind === "gateway" ? Server : Bot;
  return (
    <SourceIconWell>
      <Icon className="icon-md" />
    </SourceIconWell>
  );
}

export function CandidateKindIcon({ kind }: { kind: DiscoveryCandidate["kind"] }) {
  const Icon =
    kind === "local_service"
      ? Server
      : kind === "model_file"
        ? File
        : kind === "api_key"
          ? Globe
          : Laptop;
  return (
    <SourceIconWell>
      <Icon className="icon-md" />
    </SourceIconWell>
  );
}
