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
import type { AiAction, AutonomyPolicy } from "./autonomy";
import type { CaptureRule, SocialList, SocialPerson } from "./audience";
import type { EmailAccount, Sequence, SequenceEnrollment, Suppression } from "./outreach";
import {
  SOCIAL_READ_ACTIONS,
  type AiPlan,
  type AiPlanRunResult,
  type AiReport,
  type AiSummary,
  type AutonomySetInput,
  type BrowserSettings,
  type BrowserViewFrame,
  type BrowserViewInput,
  type CaptureRuleSaveInput,
  type CaptureRuleSetEnabledInput,
  type CollectInput,
  type CollectResult,
  type EmailAccountSaveInput,
  type EmailSendResult,
  type ImportInput,
  type ImportResult,
  type InboxReplyOptions,
  type InboxSetStatusInput,
  type InboxSetStatusResult,
  type InboxSettings,
  type InboxSettingsInput,
  type InboxTimelineResult,
  type InboxUnifiedInput,
  type InboxUnifiedResult,
  type ListMembersInput,
  type ListPage,
  type ListSaveInput,
  type NeedsHumanItem,
  type PeopleListInput,
  type PeopleListResult,
  type PeopleUpdateInput,
  type PersonDetail,
  type PersonMatchSuggestion,
  type PersonScoreResult,
  type RecipeSuggestion,
  type SequenceSaveInput,
  type SequenceStats,
  type SuppressionAddInput,
} from "./socialActions";

export type ManagedSocialUpload = {
  uploadId: string;
  managed?: { mediaId: string; uploadClaimId: string; revision: number };
};

/** Actions sent without a requestId: legacy reads plus all read-only section 3 actions. */
const NO_REQUEST_ID_ACTIONS = new Set<string>([
  "thread.page",
  "contacts.history",
  "programs.list",
  "programs.status",
  "programs.features",
  "programs.media-preview",
  "programs.preview-schedule",
  ...SOCIAL_READ_ACTIONS,
]);

export function socialClient(machineId: string) {
  const request = <T>(
    action: string,
    input: Record<string, unknown> = {},
    requestId: string = crypto.randomUUID(),
  ) =>
    remoteRequest<T>(machineId, "social.request", {
      action,
      input,
      ...(NO_REQUEST_ID_ACTIONS.has(action) ? {} : { requestId }),
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
    // Typed section 3 wrappers. Writes take an optional requestId for safe retries.
    people: {
      list: (input: PeopleListInput = {}) => request<PeopleListResult>("people.list", input),
      get: (personId: string) => request<PersonDetail>("people.get", { personId }),
      update: (input: PeopleUpdateInput, requestId?: string) =>
        request<SocialPerson>("people.update", input, requestId),
      merge: (input: { targetId: string; sourceIds: string[] }, requestId?: string) =>
        request<SocialPerson>("people.merge", input, requestId),
      matchSuggestions: (personId?: string) =>
        request<{ suggestions: PersonMatchSuggestion[] }>(
          "people.matchSuggestions",
          personId ? { personId } : {},
        ),
      score: (personId: string, requestId?: string) =>
        request<PersonScoreResult>("people.score", { personId }, requestId),
      delete: (personId: string, requestId?: string) =>
        request<{ deleted: boolean }>(
          "people.delete",
          { personId, confirm: "DELETE_PERSON" },
          requestId,
        ),
      export: (input: { personId?: string; listId?: string } = {}) =>
        request<{ json: string }>("people.export", input),
    },
    lists: {
      list: () => request<{ items: SocialList[] }>("lists.list"),
      save: (input: ListSaveInput, requestId?: string) =>
        request<SocialList>("lists.save", input, requestId),
      delete: (listId: string, requestId?: string) =>
        request<{ deleted: boolean }>("lists.delete", { id: listId }, requestId),
      addMembers: (input: ListMembersInput, requestId?: string) =>
        request<{ changed: number }>("lists.addMembers", input, requestId),
      removeMembers: (input: ListMembersInput, requestId?: string) =>
        request<{ changed: number }>("lists.removeMembers", input, requestId),
    },
    audience: {
      collect: (input: CollectInput, requestId?: string) =>
        request<CollectResult>("audience.collect", input, requestId),
      import: (input: ImportInput, requestId?: string) =>
        request<ImportResult>("audience.import", input, requestId),
    },
    captureRules: {
      list: () => request<{ items: CaptureRule[] }>("captureRules.list"),
      save: (input: CaptureRuleSaveInput, requestId?: string) =>
        request<CaptureRule>("captureRules.save", input, requestId),
      setEnabled: (input: CaptureRuleSetEnabledInput, requestId?: string) =>
        request<CaptureRule>("captureRules.setEnabled", input, requestId),
      delete: (ruleId: string, requestId?: string) =>
        request<{ deleted: boolean }>("captureRules.delete", { id: ruleId }, requestId),
    },
    sequences: {
      list: () => request<{ items: Sequence[] }>("sequences.list"),
      save: (input: SequenceSaveInput, requestId?: string) =>
        request<Sequence>("sequences.save", input, requestId),
      start: (sequenceId: string, requestId?: string) =>
        request<Sequence>("sequences.start", { sequenceId }, requestId),
      pause: (sequenceId: string, requestId?: string) =>
        request<Sequence>("sequences.pause", { sequenceId }, requestId),
      stats: (sequenceId?: string) =>
        request<SequenceStats>("sequences.stats", sequenceId ? { sequenceId } : {}),
    },
    enrollments: {
      list: (input: { sequenceId: string; cursor?: string }) =>
        request<ListPage<SequenceEnrollment>>("enrollments.list", input),
    },
    email: {
      accounts: {
        list: () => request<{ items: EmailAccount[] }>("email.accounts.list"),
        save: (input: EmailAccountSaveInput, requestId?: string) =>
          request<EmailAccount>("email.accounts.save", input, requestId),
        remove: (accountId: string, requestId?: string) =>
          request<{ removed: boolean }>("email.accounts.remove", { accountId }, requestId),
        test: (accountId: string, requestId?: string) =>
          request<{ ok: boolean; reason?: string }>(
            "email.accounts.test",
            { accountId },
            requestId,
          ),
      },
      send: (
        input: { emailAccountId: string; personId: string; subject: string; body: string },
        requestId?: string,
      ) => request<EmailSendResult>("email.send", input, requestId),
    },
    suppressions: {
      list: (input: { cursor?: string } = {}) =>
        request<ListPage<Suppression>>("suppressions.list", input),
      add: (input: SuppressionAddInput, requestId?: string) =>
        request<Suppression>("suppressions.add", input, requestId),
      remove: (suppressionId: string, requestId?: string) =>
        request<{ removed: boolean }>("suppressions.remove", { suppressionId }, requestId),
    },
    inbox: {
      unified: (input: InboxUnifiedInput = {}) =>
        request<InboxUnifiedResult>("inbox.unified", input),
      setStatus: (input: InboxSetStatusInput, requestId?: string) =>
        request<InboxSetStatusResult>("inbox.setStatus", input, requestId),
      /** The person's events across channels; `truncated` marks a capped result. */
      timeline: (personId: string) => request<InboxTimelineResult>("inbox.timeline", { personId }),
      replyOptions: (threadId: string) =>
        request<InboxReplyOptions>("inbox.replyOptions", { threadId }),
      settings: (input: InboxSettingsInput, requestId?: string) =>
        request<InboxSettings>("inbox.settings", input, requestId),
    },
    autonomy: {
      get: (accountId: string) => request<AutonomyPolicy>("autonomy.get", { accountId }),
      set: (input: AutonomySetInput, requestId?: string) =>
        request<AutonomyPolicy>("autonomy.set", input, requestId),
    },
    ai: {
      command: (input: { text: string; projectId?: string }, requestId?: string) =>
        request<AiPlan>("ai.command", input, requestId),
      runPlan: (input: { planId: string; approvedStepIds?: string[] }, requestId?: string) =>
        request<AiPlanRunResult>("ai.plan.run", input, requestId),
      actions: (input: { cursor?: string; accountId?: string } = {}) =>
        request<ListPage<AiAction>>("ai.actions.list", input),
      undo: (actionId: string, requestId?: string) =>
        request<AiAction>("ai.actions.undo", { actionId }, requestId),
      stop: (requestId?: string) => request<{ aiStopped: boolean }>("ai.stop", {}, requestId),
      resume: (requestId?: string) => request<{ aiStopped: boolean }>("ai.resume", {}, requestId),
      summary: () => request<AiSummary>("ai.summary"),
      report: (period: "day" | "week") => request<AiReport>("ai.report", { period }),
    },
    browser: {
      needsHuman: {
        list: () => request<{ items: NeedsHumanItem[] }>("browser.needsHuman.list"),
        resolve: (id: string, requestId?: string) =>
          request<void>("browser.needsHuman.resolve", { id }, requestId),
      },
      settings: {
        get: (accountId: string) => request<BrowserSettings>("browser.settings.get", { accountId }),
        set: (input: BrowserSettings, requestId?: string) =>
          request<BrowserSettings>("browser.settings.set", input, requestId),
      },
      recipeSuggestions: {
        list: () => request<{ items: RecipeSuggestion[] }>("browser.recipeSuggestions.list"),
        approve: (id: string, requestId?: string) =>
          request<RecipeSuggestion>("browser.recipeSuggestions.approve", { id }, requestId),
        reject: (id: string, requestId?: string) =>
          request<RecipeSuggestion>("browser.recipeSuggestions.reject", { id }, requestId),
      },
    },
    /** Live view (not social.request): one JPEG frame of the account's browser session. */
    /** Null until the first frame arrives. */
    browserViewFrame: (accountId: string) =>
      remoteRequest<BrowserViewFrame | null>(machineId, "social.browser.view.frame", { accountId }),
    browserViewInput: (accountId: string, event: BrowserViewInput) =>
      remoteRequest<void>(machineId, "social.browser.view.input", { accountId, event }),
    workspaceSnapshot: (input: SocialWorkspaceQuery = {}, fresh = false) =>
      // Reads need no idempotency receipt containing another copy of the page.
      remoteRequest<SocialWorkspaceResponse>(
        machineId,
        "social.request",
        { action: "workspace.snapshot", input },
        fresh,
      ),
    /** Independent section read (Today). It never carries or moves the workspace cursor. */
    sectionSnapshot: (input: SocialWorkspaceQuery) =>
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
    mediaInspect: (mediaId: string) =>
      remoteRequest<{ mediaId: string; managed: boolean; revision: number }>(
        machineId,
        "social.media.claim",
        { mediaId, inspect: true },
      ),
    mediaClaim: (
      action: "claim" | "transfer" | "releaseLogical",
      input: { mediaId: string; editorId: string; expectedRevision: number; requestId: string },
    ) =>
      remoteRequest<{ mediaId: string; editorId: string; revision: number }>(
        machineId,
        `social.media.${action}`,
        input,
      ),
    upload: async (file: File) => {
      if (file.size > 5 * 1024 * 1024) throw new Error(t("Images can be at most 5 MiB."));
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return remoteRequest<ManagedSocialUpload>(machineId, "social.media.upload", {
        base64: btoa(binary),
      });
    },
    uploadDocument: async (file: File) => {
      if (file.type !== "application/pdf" || !file.size || file.size > 5 * 1024 * 1024)
        throw new Error(t("Select a PDF document up to 5 MiB."));
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return remoteRequest<ManagedSocialUpload>(machineId, "social.media.upload", {
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
