import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import { Bot, File, Globe, Laptop, Server, KeyRound } from "../../../shared/ui/icons";
import type { DecisionSourceKind, DiscoveryCandidate } from "../model/decisionTypes";
/** Kind glyph aligned with the source name. */
function SourceIconWell({ children }: { children: ReactNode }) {
  return (
    <Text
      size="inherit"
      tone="secondary"
      aria-hidden="true"
      className="inline-flex size-6 shrink-0 items-center justify-center"
    >
      {children}
    </Text>
  );
}
/** Local: this computer. API: a hosted service. Gateway: an endpoint. LLM: a model behind a prompt. */
export function SourceKindIcon({
  kind,
  modelPath,
  compact = false,
}: {
  kind: DecisionSourceKind;
  modelPath?: string;
  compact?: boolean;
}) {
  const Icon =
    kind === "local"
      ? modelPath
        ? File
        : Server
      : kind === "api"
        ? KeyRound
        : kind === "gateway"
          ? Globe
          : Bot;
  if (compact) return <Icon className="icon-sm shrink-0" aria-hidden="true" />;
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
          ? KeyRound
          : Laptop;
  return (
    <SourceIconWell>
      <Icon className="icon-md" />
    </SourceIconWell>
  );
}
