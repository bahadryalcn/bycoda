import { remoteRequest } from "../../connections/model/connections";
import type {
  SocialBrowserIntent,
  SocialBrowserState,
  SocialBrowserWorkflow,
} from "./socialBrowser";
import type {
  SocialOperation,
  SocialSnapshot,
  SocialWorkspaceQuery,
  SocialWorkspaceResponse,
} from "./social";

export function socialClient(machineId: string) {
  const request = <T>(
    action: string,
    input: Record<string, unknown> = {},
    requestId: string = crypto.randomUUID(),
  ) =>
    remoteRequest<T>(machineId, "social.request", {
      action,
      input,
      ...([
        "thread.page",
        "contacts.history",
        "programs.list",
        "programs.status",
        "programs.features",
        "programs.preview-schedule",
      ].includes(action)
        ? {}
        : { requestId }),
    });
  return {
    request,
    xProfileRead: (accountId: string) =>
      remoteRequest<import("./socialBrowser").XProfileState>(
        machineId,
        "social.browser.profile.read",
        { accountId },
      ),
    xProfileUpdate: (accountId: string, patch: import("./socialBrowser").XProfilePatch) =>
      remoteRequest<import("./socialBrowser").XProfileState>(
        machineId,
        "social.browser.profile.update",
        { accountId, patch, confirm: "UPDATE_X_PROFILE" },
      ),
    xProfileFollow: (accountId: string, handle: string) =>
      remoteRequest<{ handle: string; platformId: string; following: boolean; changed: boolean }>(
        machineId,
        "social.browser.profile.follow",
        { accountId, handle, confirm: "FOLLOW_X_ACCOUNT" },
      ),
    monitoringStatus: (accountId: string) =>
      remoteRequest<import("./social").SocialMonitorStatus>(machineId, "social.monitoring.status", {
        accountId,
      }),
    tokenConnect: (accountId: string) =>
      remoteRequest(machineId, "social.token.connect", { accountId }),
    tiktokCreator: (accountId: string) =>
      remoteRequest<import("./social").TikTokCreatorInfo>(machineId, "social.tiktok.creator", {
        accountId,
      }),
    snapshot: () => request<SocialSnapshot>("snapshot"),
    workspaceSnapshot: (input: SocialWorkspaceQuery = {}) =>
      // Reads need no idempotency receipt containing another copy of the page.
      remoteRequest<SocialWorkspaceResponse>(machineId, "social.request", {
        action: "workspace.snapshot",
        input,
      }),
    oauthAvailability: () =>
      remoteRequest<Record<string, { configured: boolean; reason: string }>>(
        machineId,
        "social.oauth.availability",
        {},
      ),
    oauthBegin: (accountId: string, resourceId?: string, operations?: SocialOperation[]) =>
      remoteRequest<{ url: string; expiresAt: number }>(machineId, "social.oauth.begin", {
        accountId,
        resourceId,
        operations,
      }),
    oauthStatus: (accountId: string) =>
      remoteRequest<{
        status: string;
        candidates: { id: string; name: string }[];
        error?: string;
      }>(machineId, "social.oauth.status", { accountId }),
    oauthSelect: (accountId: string, candidateId: string) =>
      remoteRequest(machineId, "social.oauth.select", {
        accountId,
        candidateId,
      }),
    browserAvailability: () =>
      remoteRequest<{ available: boolean; reason: string }>(
        machineId,
        "social.browser.availability",
        {},
      ),
    browserWorkflowBegin: (accountId: string, intent: SocialBrowserIntent, targetUrl?: string) =>
      remoteRequest<SocialBrowserWorkflow>(machineId, "social.browser.workflow.begin", {
        accountId,
        intent,
        targetUrl,
        acknowledgeRisk: true,
      }),
    browserWorkflowStatus: (accountId: string) =>
      remoteRequest<SocialBrowserState>(machineId, "social.browser.workflow.status", { accountId }),
    browserWorkflowCancel: (accountId: string) =>
      remoteRequest<void>(machineId, "social.browser.workflow.cancel", { accountId }),
    browserBegin: (accountId: string) =>
      remoteRequest<{ status: string; expiresAt: number }>(machineId, "social.browser.begin", {
        accountId,
        acknowledgeRisk: true,
      }),
    browserStatus: (accountId: string) =>
      remoteRequest<{ status: string; error?: string }>(machineId, "social.browser.status", {
        accountId,
      }),
    upload: async (file: File) => {
      if (file.size > 5 * 1024 * 1024) throw new Error("Görsel en fazla 5 MiB olabilir.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return remoteRequest<{ uploadId: string }>(machineId, "social.media.upload", {
        base64: btoa(binary),
      });
    },
    uploadVideo: async (file: File, progress?: (percent: number) => void) => {
      if (file.size < 12 || file.size > 64 * 1024 * 1024)
        throw new Error("MP4/WebM video en fazla 64 MiB olabilir.");
      const upload = (params: Record<string, unknown>) =>
        remoteRequest<{ uploadId: string; offset?: number }>(
          machineId,
          "social.media.upload",
          params,
        );
      const { uploadId } = await upload({ mode: "begin", size: file.size });
      try {
        for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
          const bytes = new Uint8Array(
            await file.slice(offset, offset + 1024 * 1024).arrayBuffer(),
          );
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          const result = await upload({
            mode: "chunk",
            uploadId,
            offset,
            base64: btoa(binary),
          });
          if (result.offset !== offset + bytes.length)
            throw new Error("Video yükleme sırası doğrulanamadı.");
          progress?.(Math.round(((offset + bytes.length) / file.size) * 100));
        }
        return await upload({ mode: "finish", uploadId });
      } catch (error) {
        await upload({ mode: "cancel", uploadId }).catch(() => {});
        throw error;
      }
    },
  };
}
export type SocialClient = ReturnType<typeof socialClient>;
