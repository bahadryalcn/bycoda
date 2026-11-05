import type { IncomingMessage, ServerResponse } from "node:http";
import type { HostDomainContext } from "../domains/context";
import { HostVoiceToolDisclosure } from "../voice/voice-tool-disclosure";
import type { ServerBindings } from "./bindings";
import { body } from "./support";
export interface HttpToolRequest {
  request: IncomingMessage;
  peerIdentity: string | undefined;
  socialPrincipal: Awaited<ReturnType<ServerBindings["social"]["principalForToken"]>>;
  runtimePrincipal: import("../execution/runtime-log-tools").RuntimeLogSubjectPrincipal | undefined;
  conversationPrincipal: Awaited<
    ReturnType<ServerBindings["conversationAccess"]["principalForToken"]>
  >;
  token: string;
  params: Record<string, unknown>;
  endResult: (value: unknown, verify?: () => Promise<void>, awaitWrite?: boolean) => Promise<void>;
  input: Awaited<ReturnType<typeof body>>;
  response: ServerResponse;
  voiceToolLog:
    | { action: string; requestId: string | null; startedAt: number; outcome: string }
    | undefined;
  voiceDisclosure: HostVoiceToolDisclosure | undefined;
  tokenHash: string;
  result: unknown;
  releaseVoiceTool: (() => void) | undefined;
  voiceBrowserOwner: string | undefined;
  domainContext: HostDomainContext;
}
