import type {
  AssistantMessage,
  AssistantRequest,
  AssistantResponse,
  AssistantThread,
} from "../../../shared/model/host-contracts/assistant";
import { pathKey } from "../../../shared/lib/paths";
import {
  captureRemoteVoiceHistory,
  type VoiceHistoryRequest,
  type VoiceHistoryTransport,
} from "./voiceHistoryTransport";
import type { VoiceHistoryScope } from "./voiceHistoryPrivacy";
type Request = (request: AssistantRequest) => Promise<AssistantResponse>;
export type VoiceHistory = {
  thread: AssistantThread;
  messages: AssistantMessage[];
  request: VoiceHistoryRequest;
  scope?: VoiceHistoryScope;
};
export type VoiceHistoryBinding = {
  request: VoiceHistoryRequest;
  remote: boolean;
  open: () => Promise<VoiceHistory>;
  environmentId?: () => Promise<string>;
  scope?: () => Promise<VoiceHistoryScope>;
  current?: () => boolean;
  global?: boolean;
};
/** Capture the authoritative environment before asynchronous lookup or later selection. */
export class VoiceHistoryBindings {
  private pending = new Map<string, VoiceHistoryBinding>();
  constructor(
    private readonly request: Request,
    private readonly remote: (path: string) => VoiceHistoryTransport = captureRemoteVoiceHistory,
    private readonly local?: () => VoiceHistoryTransport,
  ) {}
  clear() {
    this.pending.clear();
  }
  open(global: boolean, projectPath: string): Promise<VoiceHistory> {
    return this.capture(global, projectPath).open();
  }
  capture(global: boolean, projectPath: string): VoiceHistoryBinding {
    const normalize = pathKey;
    let route: VoiceHistoryTransport;
    try {
      route =
        !global && projectPath.startsWith("remote://")
          ? this.remote(projectPath)
          : {
              ...(this.local?.() ?? { remote: false, request: this.request }),
              key: global ? "global" : normalize(projectPath),
            };
    } catch (error) {
      route = {
        key: `unavailable:${projectPath}`,
        remote: true,
        request: async () => {
          throw error;
        },
      };
    }
    const key = route.key;
    let binding = this.pending.get(key);
    if (!binding) {
      let pending: Promise<VoiceHistory> | undefined;
      const open = () =>
        (pending ??= (async () => {
          let projectId: string | undefined;
          if (!global) {
            const response = await route.request({ op: "projects.list" });
            projectId = response.projects?.find(
              (project) => normalize(project.path) === normalize(projectPath),
            )?.id;
            if (!projectId)
              throw new Error("The project could not be verified for conversation history.");
          }
          const response = await route.request({
            op: "threads.open",
            ...(projectId ? { projectId } : {}),
          });
          if (!response.thread) throw new Error("Conversation history is unavailable.");
          const history = await route.request({
            op: "threads.messages",
            threadId: response.thread.id,
            limit: 6,
          });
          return {
            thread: response.thread,
            messages: history.messages ?? [],
            request: route.request,
          };
        })().catch((error) => {
          pending = undefined;
          throw error;
        }));
      binding = {
        request: route.request,
        remote: route.remote,
        environmentId: route.environmentId,
        open,
      };
      this.pending.set(key, binding);
    }
    return binding;
  }
}
