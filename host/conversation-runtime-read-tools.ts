import { basename, resolve } from "node:path";
import type { HostStore } from "./store";
import type { HostLimits } from "./limits";
import type { RuntimeLogPrincipal } from "./runtime-log-tools";
import { listShellProfiles } from "./shellProfiles";
import { attachmentPath, readAttachmentChunk, MAX_REMOTE_ATTACHMENT_BYTES } from "./attachments";
import { scrubRuntimeLogText } from "./runtime-logs";

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const RUNTIME_READ_CONVERSATION_TOOLS = {
  "host.limits.status": object({}),
  "shell.profiles": object({}),
  "attachments.list": object({
    offset: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }),
  "attachments.read": object(
    {
      id: { type: "string", minLength: 1, maxLength: 300 },
      offset: { type: "integer", minimum: 0 },
      maxBytes: { type: "integer", minimum: 3, maximum: 49152 },
    },
    ["id"],
  ),
} as const;
export type RuntimeReadConversationTool = keyof typeof RUNTIME_READ_CONVERSATION_TOOLS;
export const RUNTIME_READ_ACTIONS = Object.keys(
  RUNTIME_READ_CONVERSATION_TOOLS,
) as RuntimeReadConversationTool[];
export const isRuntimeReadConversationTool = (
  action: string,
): action is RuntimeReadConversationTool => Object.hasOwn(RUNTIME_READ_CONVERSATION_TOOLS, action);
export function describeRuntimeReadConversationTool(action: string): string | undefined {
  if (action === "host.limits.status")
    return "Read allowlisted host scheduler concurrency and today's aggregate agent-minute limits/usage. Machine-wide aggregate, not provider billing, quota or another project's task/session details. Does not change limits.";
  if (action === "shell.profiles")
    return "Discover the host's installed command-shell profiles and default/chosen IDs. Returns shell metadata, not environment variables or profile contents; does not select a shell or execute a command.";
  if (action.startsWith("attachments."))
    return "List or read only attachments already accepted into the calling session's host transcript, including managed generated images. No sessionId/path/owner override. Metadata excludes paths and inline payloads; readable=false means unsupported by host chunk reads. Read returns exact base64 bytes in bounded chunks (default 12 KiB, max 48 KiB); continue from nextOffset. This never claims, uploads or grants access to drafts/other sessions.";
  return undefined;
}

export class ConversationRuntimeReadTools {
  constructor(
    private readonly store: HostStore,
    private readonly limits: Pick<HostLimits, "state">,
    private readonly shells: typeof listShellProfiles = listShellProfiles,
    private readonly read: typeof readAttachmentChunk = readAttachmentChunk,
  ) {}

  async call(
    action: RuntimeReadConversationTool,
    input: Record<string, unknown>,
    principal: RuntimeLogPrincipal,
    authorized: () => boolean,
  ): Promise<unknown> {
    const check = () => {
      if (!authorized()) throw new Error("Session authority revoked.");
    };
    check();
    if (!isRuntimeReadConversationTool(action)) throw new Error("Unsupported runtime read tool.");
    if (
      Object.keys(input).some(
        (key) => !Object.hasOwn(RUNTIME_READ_CONVERSATION_TOOLS[action].properties, key),
      )
    )
      throw new Error("Unknown or protected runtime read field.");
    this.store.project(principal.projectId);
    if (action === "host.limits.status") {
      const state = this.limits.state();
      return {
        scope: "host-scheduler",
        maxRunningTasks: state.maxRunningTasks,
        dailyAgentMinutes: state.dailyAgentMinutes,
        usedMinutes: state.usedMinutes,
        limitReached: state.limitReached,
      };
    }
    if (action === "shell.profiles") {
      const profiles = this.shells();
      const installed = new Set(profiles.profiles.map((profile) => profile.id));
      return {
        profiles: profiles.profiles.map((profile) => ({
          id: profile.id,
          name: scrubRuntimeLogText(profile.name, 200),
          kind: profile.kind,
        })),
        defaultId: installed.has(profiles.defaultId ?? "") ? profiles.defaultId : null,
        chosenId: installed.has(profiles.chosenId ?? "") ? profiles.chosenId : null,
      };
    }
    const session = this.store.session(principal.sessionId);
    if (session.projectId !== principal.projectId)
      throw new Error("Session belongs to another project.");
    if (action === "attachments.read") {
      // The existing chunk reader proves transcript membership and resolves only
      // managed IDs; no caller-supplied filesystem path ever reaches it.
      const offset = Number(input.offset ?? 0);
      const chunk = await this.read(this.store, {
        sessionId: principal.sessionId,
        id: input.id,
        offset,
      });
      check();
      const cap = 3 * Math.floor(Number(input.maxBytes ?? 12288) / 3);
      const bytes = Buffer.from(chunk.data, "base64").subarray(0, cap);
      const next = offset + bytes.length;
      return {
        id: input.id,
        encoding: "base64",
        data: bytes.toString("base64"),
        offset,
        size: chunk.size,
        nextOffset: next < chunk.size ? next : null,
      };
    }
    const entries = new Map<
      string,
      {
        id: string;
        name: string;
        mimeType: string;
        kind: string;
        size: number;
        generated: boolean;
        readable: boolean;
      }
    >();
    let unsupportedCount = 0;
    for (const block of session.session.blocks) {
      const candidates = [
        ...(block.attachments ?? []).map((file) => ({
          ...file,
          generated: false,
          sourceId: file.id,
        })),
        ...(block.image
          ? [
              {
                ...block.image,
                id: basename(block.image.path),
                kind: "image",
                generated: true,
                sourceId: block.id,
              },
            ]
          : []),
      ];
      for (const file of candidates) {
        if (!/^[A-Za-z0-9_-]{1,300}$/.test(file.sourceId)) {
          unsupportedCount++;
          continue;
        }
        let readable = false;
        try {
          const path = attachmentPath(this.store, file.id);
          readable =
            Number.isSafeInteger(file.size) &&
            file.size >= 0 &&
            file.size <= MAX_REMOTE_ATTACHMENT_BYTES &&
            (!file.generated || (!!file.path && resolve(file.path) === resolve(path)));
        } catch {
          /* inline/local-only attachments have no managed UUID */
        }
        entries.set(file.sourceId, {
          id: file.sourceId,
          name: scrubRuntimeLogText(file.name.split(/[\\/]/).at(-1) ?? "Attachment", 255),
          mimeType: scrubRuntimeLogText(file.mimeType, 128),
          kind: file.kind,
          size: file.size,
          generated: file.generated,
          readable,
        });
      }
    }
    const items = [...entries.values()],
      offset = Number(input.offset ?? 0),
      limit = Number(input.limit ?? 30);
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      unsupportedCount,
      nextOffset: offset + limit < items.length ? offset + limit : null,
    };
  }
}
