import { t } from "../../../shared/i18n";
import { remoteRequest } from "../../connections/model/connections";
import type {
  SocialBrowserIntent,
  SocialBrowserState,
  SocialBrowserWorkflow,
  SocialRegistrationProfile,
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
        "programs.media-preview",
        "programs.preview-schedule",
      ].includes(action)
        ? {}
        : { requestId }),
    });
  return {
    request,
    browserProfileRead: (accountId: string) =>
      remoteRequest<import("./socialBrowser").XProfileState>(
        machineId,
        "social.browser.profile.read",
        { accountId },
      ),
    browserProfileUpdate: (
      accountId: string,
      platform: "x" | "linkedin" | "facebook" | "instagram",
      patch: import("./socialBrowser").XProfilePatch,
    ) =>
      remoteRequest<import("./socialBrowser").XProfileState>(
        machineId,
        "social.browser.profile.update",
        {
          accountId,
          patch,
          confirm:
            platform === "linkedin"
              ? "UPDATE_LINKEDIN_PROFILE"
              : platform === "facebook"
                ? "UPDATE_FACEBOOK_PROFILE"
                : platform === "instagram"
                  ? "UPDATE_INSTAGRAM_PROFILE"
                  : "UPDATE_X_PROFILE",
        },
      ),
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
    tokenConnect: (accountId: string, reviewId?: string) =>
      remoteRequest(machineId, "social.token.connect", {
        accountId,
        ...(reviewId ? { reviewId } : {}),
      }),
    tokenInspect: (accountId: string, target: string) =>
      remoteRequest<import("./social").SocialTelegramChannelReview>(
        machineId,
        "social.token.inspect",
        { accountId, target },
      ),
    tiktokCreator: (accountId: string) =>
      remoteRequest<import("./social").TikTokCreatorInfo>(machineId, "social.tiktok.creator", {
        accountId,
      }),
    snapshot: () => request<SocialSnapshot>("snapshot"),
    workspaceSnapshot: (input: SocialWorkspaceQuery = {}, fresh = false) =>
      // Reads need no idempotency receipt containing another copy of the page.
      remoteRequest<SocialWorkspaceResponse>(
        machineId,
        "social.request",
        { action: "workspace.snapshot", input },
        fresh,
      ),
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
    browserWorkflowBegin: (
      accountId: string,
      intent: SocialBrowserIntent,
      targetUrl?: string,
      registration?: SocialRegistrationProfile,
    ) =>
      remoteRequest<SocialBrowserWorkflow>(machineId, "social.browser.workflow.begin", {
        accountId,
        intent,
        targetUrl,
        acknowledgeRisk: true,
        ...(registration ? { registration } : {}),
      }),
    browserRegistrationAdvance: (
      accountId: string,
      workflowId: string,
      expectedUpdatedAt: number,
      registration: SocialRegistrationProfile,
    ) =>
      remoteRequest<SocialBrowserWorkflow>(machineId, "social.browser.registration.advance", {
        accountId,
        workflowId,
        expectedUpdatedAt,
        registration,
      }),
    browserRegistrationReview: (accountId: string, workflowId: string, expectedUpdatedAt: number) =>
      remoteRequest<import("./socialBrowser").SocialRegistrationReview>(
        machineId,
        "social.browser.registration.review",
        { accountId, workflowId, expectedUpdatedAt },
      ),
    browserRegistrationSubmit: (
      accountId: string,
      workflowId: string,
      expectedUpdatedAt: number,
      reviewId: string,
    ) =>
      remoteRequest<SocialBrowserWorkflow>(machineId, "social.browser.registration.submit", {
        accountId,
        workflowId,
        expectedUpdatedAt,
        reviewId,
        confirm: "CREATE_LINKEDIN_PAGE",
      }),
    browserRegistrationReconcile: (
      accountId: string,
      workflowId: string,
      expectedUpdatedAt: number,
      resourceId: string,
    ) =>
      remoteRequest<SocialBrowserWorkflow>(machineId, "social.browser.registration.reconcile", {
        accountId,
        workflowId,
        expectedUpdatedAt,
        resourceId,
      }),
    browserWorkflowStatus: (accountId: string) =>
      remoteRequest<SocialBrowserState>(machineId, "social.browser.workflow.status", { accountId }),
    browserWorkflowCancel: (accountId: string) =>
      remoteRequest<void>(machineId, "social.browser.workflow.cancel", { accountId }),
    browserBegin: (accountId: string, resourceId?: string) =>
      remoteRequest<{ status: string; expiresAt: number }>(machineId, "social.browser.begin", {
        accountId,
        acknowledgeRisk: true,
        ...(resourceId ? { resourceId } : {}),
      }),
    browserStatus: (accountId: string) =>
      remoteRequest<{ status: string; error?: string }>(machineId, "social.browser.status", {
        accountId,
      }),
    upload: async (file: File) => {
      if (file.size > 5 * 1024 * 1024) throw new Error(t("Images can be at most 5 MiB."));
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return remoteRequest<{ uploadId: string }>(machineId, "social.media.upload", {
        base64: btoa(binary),
      });
    },
    uploadDocument: async (file: File) => {
      if (file.type !== "application/pdf" || !file.size || file.size > 5 * 1024 * 1024)
        throw new Error(t("Select a PDF document up to 5 MiB."));
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return remoteRequest<{ uploadId: string }>(machineId, "social.media.upload", {
        kind: "document",
        base64: btoa(binary),
      });
    },
    uploadVideo: async (file: File, progress?: (percent: number) => void) => {
      if (file.size < 12 || file.size > 64 * 1024 * 1024)
        throw new Error(t("MP4/WebM videos can be at most 64 MiB."));
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
            throw new Error(t("Video upload order could not be verified."));
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
