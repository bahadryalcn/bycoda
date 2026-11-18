import { createHash } from "node:crypto";
import type { HostStore } from "../store";
import type { HostNotesAccess } from "../host-notes-async";
import type { HostAutomations } from "../automations/automations";
import type { ProviderInboxBridge } from "../providers/provider-inbox";
import type {
  RuntimeLogPrincipal,
  RuntimeLogSubjectPrincipal,
} from "../execution/runtime-log-tools";
import { sessionWorkCwd, type Session } from "../../src/features/sessions/model/session";
import { resolveHostWorktreeAsync } from "../git/git-worktrees";
import {
  inboxOperationWrites,
  parseRemoteInboxOperation,
} from "../../src/features/inbox/model/remoteInbox";
import { isRemoteJiraOperation } from "../../src/features/inbox/model/jiraBoardProtocol";
import type { ConversationTool } from "./conversation-tools";
import { captureJiraCommentImages } from "./conversation-jira-comment-images";

export const isWorkspaceConversationTool = (action: string) =>
  /^(notes|automations|inbox)\./.test(action);
const JIRA_ACTIONS: Partial<Record<string, string>> = {
  "inbox.jira.boards": "jira-boards",
  "inbox.jira.board": "jira-board-read",
  "inbox.jira.transitions": "jira-issue-transitions",
  "inbox.jira.transition": "jira-board-transition",
  "inbox.jira.move": "jira-board-move",
};
const page = <T>(items: T[], input: Record<string, unknown>, total = items.length) => {
  const offset = Number(input.offset ?? 0),
    limit = Number(input.limit ?? 30);
  return {
    items: items.slice(offset, offset + limit),
    total,
    nextOffset: offset + limit < total ? offset + limit : null,
  };
};

/** Reuses application APIs. No renderer commands, provider credentials or database copy. */
export class ConversationWorkspaceTools {
  private pendingWrites = new Map<string, { signature: string; promise: Promise<unknown> }>();
  constructor(
    private readonly store: HostStore,
    private readonly notes: HostNotesAccess,
    private readonly automations: HostAutomations,
    private readonly inbox: ProviderInboxBridge,
    private readonly attentionInbox: (
      projectId: string,
      principal: RuntimeLogSubjectPrincipal,
    ) => Promise<unknown[]>,
    private readonly approveInboxWrite: (
      operation: Record<string, unknown>,
      cwd: string,
      principal: RuntimeLogPrincipal,
      authorized: () => boolean | Promise<boolean>,
    ) => Promise<unknown>,
  ) {}

  async call(
    action: ConversationTool,
    input: Record<string, unknown>,
    principal: RuntimeLogSubjectPrincipal,
    session: Session | undefined,
    authorized: () => boolean | Promise<boolean>,
  ): Promise<unknown> {
    if (!(await authorized())) throw new Error("Session authority revoked.");
    const project = await this.store.project(principal.projectId);
    if (action.startsWith("notes.")) {
      if (action === "notes.list") {
        const list = await this.notes.list(project.cwd);
        if (!(await authorized())) throw new Error("Session authority revoked.");
        return {
          ...page(list.notes, input, list.total),
          truncated: list.total > list.notes.length,
        };
      }
      const id = String(input.id);
      const existing = await this.notes.get(id, project.cwd);
      if (!(await authorized())) throw new Error("Session authority revoked.");
      if (action === "notes.read") {
        if (!existing) throw new Error("Note not found.");
        return existing;
      }
      if (action === "notes.create") {
        if (existing) throw new Error("Note ID already exists. Read it before retrying creation.");
        return await this.notes.save(
          {
            id,
            title: input.title ?? "Untitled",
            body: input.body,
            tags: input.tags ?? [],
            sourceCwd: project.cwd,
            sourceSessionId: principal.sessionId,
          },
          0,
          project.cwd,
          authorized,
        );
      }
      if (!existing) throw new Error("Note not found.");
      if (action === "notes.delete")
        return await this.notes.delete(id, input.expectedUpdatedAt, project.cwd, authorized);
      if (input.title === undefined && input.body === undefined && input.tags === undefined)
        throw new Error("Supply note content to update.");
      return await this.notes.save(
        {
          ...existing,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
          sourceCwd: project.cwd,
        },
        input.expectedUpdatedAt,
        project.cwd,
        authorized,
      );
    }
    if (action.startsWith("automations.")) {
      if (principal.kind !== "session" || !session)
        throw new Error("This tool requires a real focused session grant.");
      const list = await this.automations.list();
      if (action === "automations.list")
        return page(
          list.filter((entry) => entry.projectId === project.id),
          input,
        );
      const id = String(input.automationId);
      const existing = list.find((entry) => entry.id === id);
      if (existing && existing.projectId !== project.id)
        throw new Error("Automation belongs to another project.");
      if (action === "automations.create") {
        if (existing)
          throw new Error("Automation ID already exists. Read it before retrying creation.");
        if (
          input.harness !== undefined &&
          input.harness !== session.harness &&
          input.model === undefined
        )
          throw new Error("Choose a model when selecting a different automation provider.");
        return await this.store.transaction(async () => {
          if ((await this.automations.list()).some((entry) => entry.id === id))
            throw new Error("Automation ID already exists.");
          return await this.automations.save({
            ...input,
            id,
            projectId: project.id,
            harness: input.harness ?? session.harness,
            model: input.model ?? session.model,
            modelSettings:
              input.harness === undefined && input.model === undefined ? session.modelSettings : {},
            runtimeMode: session.runtimeMode,
            minute: input.minute ?? 0,
            time: input.time ?? "09:00",
            dayOfWeek: input.dayOfWeek ?? 1,
          });
        });
      }
      if (!existing) throw new Error("Automation not found.");
      if (action === "automations.get") return existing;
      if (action === "automations.runs") return page(await this.automations.runs(id), input);
      if ((await this.automations.runs(id)).some((run) => run.sessionId === principal.sessionId))
        throw new Error("An automation agent cannot manage its own automation.");
      if (action === "automations.runNow") return await this.automations.runNow(id);
      if (action === "automations.stopRun")
        return await this.automations.stopRun(id, String(input.runId));
      return await this.store.transaction(async () => {
        const current = (await this.automations.list()).find((entry) => entry.id === id);
        if (
          !current ||
          current.projectId !== project.id ||
          current.updatedAt !== input.expectedUpdatedAt
        )
          throw new Error("Automation changed. Read it before updating.");
        if (action === "automations.delete") {
          await this.automations.delete(id);
          return { deleted: true };
        }
        if (action === "automations.pause" || action === "automations.resume")
          return await this.automations.save({
            ...current,
            enabled: action === "automations.resume",
          });
        const { automationId: _id, expectedUpdatedAt: _expected, ...patch } = input;
        if (!Object.keys(patch).length) throw new Error("Supply automation fields to update.");
        return await this.automations.save({
          ...current,
          ...patch,
          modelSettings:
            patch.harness !== undefined || patch.model !== undefined ? {} : current.modelSettings,
          id,
          projectId: project.id,
          runtimeMode: current.runtimeMode,
        });
      });
    }
    if (action === "inbox.list")
      return page(await this.attentionInbox(project.id, principal), input);
    if (action === "inbox.providers.status") return await this.inbox.availability();
    const owner = createHash("sha256")
      .update(
        JSON.stringify([
          this.store.environmentId,
          principal.projectId,
          principal.sessionId,
          principal.kind === "assistant-thread" ? principal.threadId : "session",
          principal.provider,
        ]),
      )
      .digest("hex");
    if (action === "inbox.result") return await this.inbox.result(owner, input.requestId);
    const jiraAction = JIRA_ACTIONS[action];
    const { imagePaths, ...inboxInput } = input;
    const parsed = parseRemoteInboxOperation(
      jiraAction
        ? { ...input, projectId: project.id, action: jiraAction }
        : action === "inbox.providers.connections"
          ? { action: "providers" }
          : action === "inbox.providers.list"
            ? {
                projectId: project.id,
                action: "list",
                query: {
                  assignedToMe: input.assignedToMe,
                  state: input.state,
                  search: input.search,
                  githubKinds: input.githubKinds,
                  providers: input.provider === undefined ? undefined : [input.provider],
                },
              }
            : {
                ...inboxInput,
                projectId: project.id,
                action:
                  action === "inbox.prAction"
                    ? "pr-action"
                    : action === "inbox.reviewContext"
                      ? "review-context"
                      : action.slice("inbox.".length),
                item: { ...(input.item as Record<string, unknown>), projectPath: project.cwd },
              },
      [project],
    );
    let operation = parsed;
    if (imagePaths !== undefined) {
      if (parsed.action !== "comment" || parsed.item.provider !== "jira")
        throw new Error("Comment images are supported only for Jira issues.");
      if (principal.kind !== "session" || !session)
        throw new Error("Jira comment images require a real focused session.");
      const imageRoot = await resolveHostWorktreeAsync(project.cwd, sessionWorkCwd(session));
      const images = await captureJiraCommentImages(imageRoot, imagePaths);
      operation = { ...parsed, action: "jira-comment-images", imageRoot, images };
    }
    const receipt = await this.inbox.existingRequest(owner, input.requestId, operation);
    if (receipt) return receipt;
    if ("item" in operation)
      await this.inbox.assertListedTarget(owner, operation.item, project.cwd);
    if (!inboxOperationWrites(operation))
      return await this.inbox.request(owner, input.requestId, operation);
    if (principal.kind !== "session")
      throw new Error("Inbox writes require a real focused session for owner approval.");
    // The desktop's native Jira prepare step shows the owner the exact issue and change.
    if (isRemoteJiraOperation(operation))
      return await this.inbox.request(owner, input.requestId, operation);
    const key = `${owner}:${input.requestId}`;
    const signature = JSON.stringify(operation);
    const pending = this.pendingWrites.get(key);
    if (pending) {
      if (pending.signature !== signature)
        throw new Error("Inbox request ID belongs to another pending operation.");
      return pending.promise;
    }
    if (this.pendingWrites.size >= 16)
      throw new Error("Too many inbox owner approvals are pending.");
    const promise = (async () => {
      const available = await this.inbox.availability();
      if (!available.available) throw new Error(available.reason);
      if (!(await authorized())) throw new Error("Session authority revoked.");
      const result = (await this.approveInboxWrite(
        operation as unknown as Record<string, unknown>,
        project.cwd,
        principal,
        authorized,
      )) as { approved?: boolean; permit?: string };
      if (!(await authorized())) throw new Error("Session authority revoked.");
      if (result?.approved !== true) throw new Error("Owner declined this inbox operation.");
      if (operation.action === "jira-comment-images") {
        if (typeof result.permit !== "string" || !/^[a-f0-9-]{36}$/.test(result.permit))
          throw new Error("The updated desktop must authorize Jira comment images.");
        return await this.inbox.request(owner, input.requestId, {
          ...operation,
          permit: result.permit,
        });
      }
      return await this.inbox.request(owner, input.requestId, operation);
    })();
    this.pendingWrites.set(key, { signature, promise });
    try {
      return await promise;
    } finally {
      this.pendingWrites.delete(key);
    }
  }
}
