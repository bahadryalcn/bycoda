import { createHash } from "node:crypto";

/** Metadata describes existing operations; it never grants permission or dispatches them. */
export type ManagedToolGroup = "conversation" | "social" | "runtime-logs";
export type ToolCapabilityState = "unknown" | "available" | "unavailable" | "unsupported";
export type ToolEffect = "read" | "local-state" | "presentation" | "execution" | "external-write";
export type ToolCatalogEntry = {
  name: string;
  action: string;
  inputSchema: Record<string, unknown>;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** Only the host constructing the catalog may supply observed capability evidence. */
  capability?: { state: Exclude<ToolCapabilityState, "unsupported">; evidence: string };
};
export type ManagedTool = {
  id: string;
  group: ManagedToolGroup;
  family: string;
  action: string;
  name: string;
  summary: string;
  inputSchema: Record<string, unknown>;
  description: string;
  annotations: ToolCatalogEntry["annotations"];
  authorizationScope: "read" | "write";
  fingerprint: string;
  supported: boolean;
  /** Kept separate from effects: legacy scope remains the transport's authority boundary. */
  authorization: {
    legacyScope: "read" | "write";
    requirement:
      | "existing-host-gates"
      | "native-owner-approval"
      | "owner-approved-plan"
      | "owner-or-active-rule";
  };
  effects: ToolEffect[];
  retry: {
    mode: "safe-read" | "same-request" | "read-before-retry" | "unsupported";
    persistence: "none" | "in-process" | "operation-contract";
    identityFields: string[];
    instruction: string;
  };
  preconditions: string[];
  invalidates: string[];
  readback: string[];
  cancellation: string[];
  presentation: "none" | "inline" | "native-panel" | "system-browser" | "image";
  capability: { state: ToolCapabilityState; evidence: string | null };
};

const CONVERSATION_ACTIONS = new Set(
  `visuals.preview visuals.render crews.definitions.list crews.definition.get crews.agents.list crews.agent.get crews.runs.list files.inspect files.rename files.move files.copy files.delete files.create files.write files.list files.index files.search files.searchContent files.read git.index git.fileDiff git.branches git.worktrees automations.preview stewards.list stewards.get usage.sessions.read goals.list goals.get checkpoints.status checkpoints.diff providers.list models.list terminals.interrupt terminals.create terminals.close servers.list servers.get servers.ssh.save servers.ssh.remove servers.ssh.identity.set servers.metadata.update servers.activity.bookmark devServers.logs devServers.kill devServers.openExternal tasks.artifacts.list tasks.dependencies.list goals.create goals.replan goals.cancel goals.update goals.delete tasks.queue.pause tasks.reorder browser.annotation.start browser.annotation.hover browser.annotation.select browser.annotation.read browser.annotation.clear browser.annotation.cancel stewards.delete stewards.decline stewards.create stewards.update stewards.pause stewards.resume stewards.runNow stewards.stopRun host.limits.status shell.profiles attachments.list attachments.read crews.list crews.schema crews.inspect crews.save crews.agent.save crews.start crews.get crews.assign crews.request crews.resolve crews.respond crews.answer crews.pause crews.stop crews.resume crews.accept crews.finish sessions.list sessions.read tools.list tools.search tools.describe tools.status tasks.create skills.search skills.read ui.workspace.list ui.workspace.status ui.workspace.open ui.workspace.close ui.tools.status ui.tools.open ui.tools.place ui.tools.close notes.list notes.read notes.create notes.update notes.delete automations.list automations.get automations.create automations.update automations.pause automations.resume automations.delete automations.runs automations.runNow automations.stopRun inbox.list inbox.providers.status inbox.providers.list inbox.details inbox.thread inbox.comment inbox.reviewContext inbox.review inbox.prAction inbox.result machines.list devices.status devices.preflight devices.preview devices.preview.status devices.list devices.start devices.boot devices.capture devices.action terminals.list terminals.read terminals.write logs.sources logs.read logs.monitors.list logs.monitors.start logs.monitors.stop browser.status browser.claim browser.release browser.open browser.frame browser.input browser.close tasks.list tasks.delete tasks.transfer tasks.notes.resolve tasks.get tasks.session.read tasks.start tasks.retry tasks.stop tasks.update tasks.review.recheck tasks.notes.read devServers.list devServers.details devServers.start devServers.stop devServers.restart resources.read`.split(
    " ",
  ),
);
CONVERSATION_ACTIONS.add("browser.preview");
CONVERSATION_ACTIONS.add("browser.resize");
for (const action of [
  "desktop.status",
  "desktop.snapshot",
  "desktop.windows.list",
  "desktop.find",
  "desktop.screenshot",
  "desktop.wait",
  "desktop.click",
  "desktop.setValue",
  "desktop.press",
  "desktop.act",
  "desktop.launch",
  "desktop.clipboard",
])
  CONVERSATION_ACTIONS.add(action);
const SOCIAL_READS = new Set(
  "policy.get accounts.list capabilities.get campaigns.preview campaigns.status inbox.list thread.read contacts.search jobs.status programs.list programs.status programs.preview-schedule".split(
    " ",
  ),
);
const SOCIAL_ACTIONS = new Set([
  ...SOCIAL_READS,
  ..."campaigns.create campaigns.schedule replies.draft replies.send contacts.upsert segments.create messages.draft messages.send comments.draft comments.send automations.create automations.pause jobs.cancel programs.configure programs.generate".split(
    " ",
  ),
]);
const READBACKS: Record<string, string[]> = {
  visuals: [],
  crews: ["crews.get"],
  files: ["files.inspect", "files.read"],
  git: ["git.index"],
  automations: ["automations.get", "automations.runs"],
  stewards: ["stewards.get"],
  usage: ["usage.sessions.read"],
  goals: ["goals.get"],
  checkpoints: ["checkpoints.status"],
  providers: ["providers.list"],
  models: ["models.list"],
  terminals: ["terminals.list", "terminals.read"],
  servers: ["servers.get"],
  devServers: ["devServers.details", "devServers.logs"],
  tasks: ["tasks.get"],
  browser: ["browser.status", "browser.frame"],
  host: ["host.limits.status"],
  shell: ["shell.profiles"],
  attachments: ["attachments.list"],
  sessions: ["sessions.read"],
  tools: [],
  skills: ["skills.search"],
  ui: ["ui.tools.status"],
  notes: ["notes.read"],
  inbox: ["inbox.result"],
  machines: ["machines.list"],
  devices: ["devices.status"],
  logs: ["logs.read"],
  resources: ["resources.read"],
};
const CANCELLATIONS: Record<string, string[]> = {
  "crews.start": ["crews.stop"],
  "crews.assign": ["crews.stop"],
  "automations.runNow": ["automations.stopRun"],
  "stewards.runNow": ["stewards.stopRun"],
  "goals.create": ["goals.cancel"],
  "goals.replan": ["goals.cancel"],
  "terminals.create": ["terminals.close"],
  "terminals.write": ["terminals.interrupt"],
  "devServers.start": ["devServers.stop"],
  "devServers.restart": ["devServers.stop"],
  "tasks.create": ["tasks.stop"],
  "tasks.start": ["tasks.stop"],
  "tasks.retry": ["tasks.stop"],
  "tasks.review.recheck": ["tasks.stop"],
  "browser.claim": ["browser.release"],
  "browser.open": ["browser.release"],
  "browser.input": ["browser.release"],
  "browser.preview": ["browser.release"],
  "browser.annotation.start": ["browser.annotation.cancel"],
  "logs.monitors.start": ["logs.monitors.stop"],
};
const SOCIAL_READBACKS: Record<string, string[]> = {
  policy: ["policy.get"],
  accounts: ["accounts.list"],
  capabilities: ["capabilities.get"],
  campaigns: ["campaigns.status"],
  inbox: ["inbox.list"],
  thread: ["thread.read"],
  replies: ["jobs.status", "thread.read"],
  contacts: ["contacts.search"],
  segments: [],
  messages: ["jobs.status"],
  comments: ["jobs.status", "thread.read"],
  automations: [],
  jobs: ["jobs.status"],
  programs: ["programs.status"],
};

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
function boundedText(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}
function isSupported(group: ManagedToolGroup, action: string) {
  return group === "conversation"
    ? CONVERSATION_ACTIONS.has(action)
    : group === "social"
      ? SOCIAL_ACTIONS.has(action)
      : action === "read" || action === "sources";
}
function knownRead(group: ManagedToolGroup, entry: ToolCatalogEntry) {
  return (
    group === "runtime-logs" ||
    (group === "social" ? SOCIAL_READS.has(entry.action) : entry.annotations?.readOnlyHint === true)
  );
}
function effectFor(group: ManagedToolGroup, action: string, read: boolean): ToolEffect[] {
  if (group === "runtime-logs") return ["read"];
  if (group === "social") {
    if (read) return ["read"];
    return /^(replies|messages|comments)\.send$|^campaigns\.schedule$/.test(action)
      ? ["external-write"]
      : action === "programs.generate"
        ? ["local-state", "execution"]
        : ["local-state"];
  }
  if (action === "visuals.render") return ["presentation"];
  if (
    [
      "desktop.act",
      "desktop.click",
      "desktop.setValue",
      "desktop.press",
      "desktop.launch",
      "desktop.clipboard",
    ].includes(action)
  )
    return ["presentation", "execution", "external-write"];
  if (
    action === "visuals.preview" ||
    action === "devices.capture" ||
    action === "browser.frame" ||
    action === "desktop.screenshot"
  )
    return ["read", "presentation"];
  if (
    (action.startsWith("ui.") && !read) ||
    action === "devServers.openExternal" ||
    (action.startsWith("browser.annotation.") && action !== "browser.annotation.read")
  )
    return ["presentation"];
  if (["browser.open", "browser.input", "browser.preview", "browser.resize"].includes(action))
    return ["presentation", "execution"];
  if (read) return ["read"];
  if (/^inbox\.(comment|review|prAction)$/.test(action)) return ["external-write"];
  if (
    /^(devServers\.(start|stop|restart|kill)|terminals\.(write|interrupt|close|create)|devices\.(start|boot|action|preview)|tasks\.(start|retry|stop|review\.recheck)|crews\.(start|assign|respond|answer|stop)|automations\.(runNow|stopRun)|stewards\.(runNow|stopRun)|logs\.monitors\.(start|stop)|goals\.(create|replan|cancel))$/.test(
      action,
    )
  )
    return ["execution", "local-state"];
  return ["local-state"];
}

/** The caller must pass only entries already exposed to its authenticated principal. */
export function createManagedToolCatalog(
  group: ManagedToolGroup,
  entries: readonly ToolCatalogEntry[],
): ManagedTool[] {
  if (!["conversation", "social", "runtime-logs"].includes(group))
    throw new Error("Unsupported tool group.");
  const seen = new Set<string>();
  const available = new Set(entries.map((entry) => entry.action));
  const references = (actions: string[]) =>
    actions.filter((action) => available.has(action)).map((action) => `${group}:${action}`);
  return entries
    .map((entry): ManagedTool => {
      if (
        !/^[A-Za-z][A-Za-z0-9_.-]{0,199}$/.test(entry.action) ||
        typeof entry.name !== "string" ||
        !entry.name ||
        entry.name.length > 300
      )
        throw new Error("Invalid catalog identity.");
      const id = `${group}:${entry.action}`;
      if (seen.has(id)) throw new Error(`Duplicate tool identity: ${id}`);
      seen.add(id);
      const action = entry.action;
      const family = group === "runtime-logs" ? "logs" : action.split(".")[0];
      const read = knownRead(group, entry);
      const supported = isSupported(group, action);
      const properties = entry.inputSchema.properties as Record<string, unknown> | undefined;
      const fields = Object.keys(properties ?? {});
      const preconditions = fields.filter((field) =>
        /^expected|^leaseId$|^navigationId$|^annotationId$/.test(field),
      );
      const requestFields = fields.filter((field) => field === "requestId");
      let identityFields: string[] = requestFields;
      let mode: ManagedTool["retry"]["mode"] =
        read && !["visuals.render", "browser.annotation.hover"].includes(action)
          ? "safe-read"
          : "read-before-retry";
      // Schema presence alone is not proof of idempotency. These existing operations explicitly bind IDs to payloads.
      if (
        group === "conversation" &&
        requestFields.length &&
        (/^crews\.(start|assign|request|resolve|respond|answer)$/.test(action) ||
          action.startsWith("inbox.") ||
          action === "devices.preview" ||
          action === "terminals.create" ||
          [
            "desktop.act",
            "desktop.click",
            "desktop.setValue",
            "desktop.press",
            "desktop.launch",
            "desktop.clipboard",
          ].includes(action))
      )
        mode = "same-request";
      if (group === "conversation" && action === "browser.preview" && requestFields.length)
        mode = "same-request";
      if (group === "social" && !read && requestFields.length) mode = "same-request";
      if (
        group === "conversation" &&
        ["tasks.create", "notes.create", "automations.create"].includes(action)
      ) {
        identityFields = fields.filter((field) => ["taskId", "id", "automationId"].includes(field));
        mode = "read-before-retry";
      }
      if (!supported) mode = "unsupported";
      let readback =
        group === "social"
          ? (SOCIAL_READBACKS[family] ?? [])
          : group === "runtime-logs"
            ? []
            : (READBACKS[family] ?? []);
      if (action.startsWith("ui.workspace.")) readback = ["ui.workspace.status"];
      if (action.startsWith("browser.annotation."))
        readback = ["browser.annotation.read", "browser.status"];
      if (action === "devices.preview") readback = ["devices.preview.status"];
      if (action === "browser.preview") readback = ["browser.status", "ui.tools.status"];
      if (action === "browser.resize") readback = ["browser.frame"];
      if (action.startsWith("desktop."))
        readback =
          action === "desktop.clipboard"
            ? ["desktop.status"]
            : ["desktop.snapshot", "desktop.status"];
      if (
        action === "servers.ssh.remove" ||
        action === "notes.delete" ||
        action === "tasks.delete" ||
        action === "goals.delete" ||
        action === "stewards.delete" ||
        action === "automations.delete"
      )
        readback = [`${family}.list`];
      if (action === "crews.save") readback = ["crews.definition.get"];
      if (action === "crews.agent.save") readback = ["crews.agent.get"];
      const effects = supported ? effectFor(group, action, read) : [];
      const requirement: ManagedTool["authorization"]["requirement"] =
        group === "social" &&
        /^(replies|messages|comments)\.send$|^campaigns\.schedule$/.test(action)
          ? "owner-or-active-rule"
          : group === "conversation" &&
              (/^inbox\.(comment|review|prAction)$/.test(action) ||
                ["tasks.delete", "tasks.transfer", "tasks.notes.resolve"].includes(action))
            ? "native-owner-approval"
            : group === "conversation" && action === "goals.create"
              ? "owner-approved-plan"
              : "existing-host-gates";
      const presentation: ManagedTool["presentation"] =
        action === "devServers.openExternal"
          ? "system-browser"
          : action === "visuals.render"
            ? "inline"
            : [
                  "visuals.preview",
                  "browser.frame",
                  "devices.capture",
                  "desktop.screenshot",
                ].includes(action)
              ? "image"
              : action.startsWith("ui.") || action === "browser.preview"
                ? "native-panel"
                : "none";
      const capability: ManagedTool["capability"] = !supported
        ? { state: "unsupported", evidence: null }
        : entry.capability &&
            ["unknown", "available", "unavailable"].includes(entry.capability.state) &&
            typeof entry.capability.evidence === "string" &&
            entry.capability.evidence.trim()
          ? { state: entry.capability.state, evidence: boundedText(entry.capability.evidence, 500) }
          : { state: "unknown", evidence: null };
      const description = entry.description ?? "";
      const result: Omit<ManagedTool, "fingerprint"> = {
        id,
        group,
        family,
        action,
        name: entry.name,
        summary:
          boundedText(
            description.replace(new RegExp(`^${action.replaceAll(".", "\\.")}:\\s*`), ""),
            220,
          ) || action,
        inputSchema: structuredClone(entry.inputSchema),
        description,
        annotations: entry.annotations ? { ...entry.annotations } : undefined,
        authorizationScope: read ? ("read" as const) : ("write" as const),
        supported,
        authorization: { legacyScope: read ? ("read" as const) : ("write" as const), requirement },
        effects,
        retry: {
          mode,
          persistence:
            mode === "same-request"
              ? action === "browser.preview"
                ? "in-process"
                : "operation-contract"
              : "none",
          identityFields,
          instruction:
            action === "browser.preview" && mode === "same-request"
              ? "Reuse requestId only with identical input. Receipt lookup is in-process, not durable; after restart or an uncertain result inspect browser and panel state before retrying."
              : mode === "same-request"
                ? "Reuse the same identity and exact payload; inspect the existing result before retrying an uncertain operation."
                : mode === "safe-read"
                  ? "Repeat the read; preserve pagination and scope identity."
                  : mode === "unsupported"
                    ? "No managed workflow is defined for this operation."
                    : "Read current state before retrying; metadata does not establish duplicate suppression.",
        },
        preconditions,
        invalidates:
          group === "conversation" &&
          ["browser.resize", "browser.open", "browser.preview"].includes(action)
            ? ["browser.annotation"]
            : [],
        readback: references(readback),
        cancellation: references(
          group === "social"
            ? [
                "programs.generate",
                "campaigns.schedule",
                "replies.send",
                "messages.send",
                "comments.send",
              ].includes(action)
              ? ["jobs.cancel"]
              : []
            : (CANCELLATIONS[action] ?? []),
        ),
        presentation,
        capability,
      };
      return { ...result, fingerprint: fingerprint(result) };
    })
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
}

export type ToolSearchInput = {
  query?: string;
  group?: ManagedToolGroup;
  family?: string;
  cursor?: string;
  limit?: number;
};
function revision(entries: readonly ManagedTool[]) {
  return fingerprint(
    [...entries]
      .sort((a, b) => a.id.localeCompare(b.id, "en"))
      .map((entry) => [entry.id, entry.fingerprint]),
  );
}
function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Expected an integer from ${min} to ${max}.`);
  return value;
}
function textInput(value: unknown, max: number) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error("Invalid discovery text.");
  return value.trim();
}
function cursorOffset(cursor: string | undefined, key: string) {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string" || cursor.length > 200 || !/^v1:[a-f0-9]{64}:\d+$/.test(cursor))
    throw new Error("Invalid tool cursor.");
  const [, actualKey, offset] = cursor.split(":");
  if (actualKey !== key) throw new Error("Tool cursor is stale or belongs to a different query.");
  return integer(Number(offset), 0, 0, Number.MAX_SAFE_INTEGER);
}
function nextCursor(key: string, offset: number, total: number) {
  return offset < total ? `v1:${key}:${offset}` : null;
}
function selection(entries: readonly ManagedTool[], input: ToolSearchInput) {
  const query = textInput(input.query, 200).toLocaleLowerCase("en");
  const family = textInput(input.family, 80);
  const group = textInput(input.group, 30);
  if (group && !["conversation", "social", "runtime-logs"].includes(group))
    throw new Error("Unsupported tool group.");
  const terms = query.split(/\s+/).filter(Boolean);
  const tools = entries
    .filter(
      (entry) =>
        (!group || entry.group === group) &&
        (!family || entry.family === family) &&
        terms.every((term) =>
          `${entry.id} ${entry.name} ${entry.summary} ${entry.description}`
            .toLocaleLowerCase("en")
            .includes(term),
        ),
    )
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  return { tools, query, family, group };
}
function compact(entry: ManagedTool) {
  return {
    id: entry.id,
    name: entry.name,
    group: entry.group,
    family: entry.family,
    action: entry.action,
    summary: entry.summary,
    effects: entry.effects,
    authorizationScope: entry.authorization.legacyScope,
    capability: entry.capability.state,
    supported: entry.supported,
  };
}
export function searchManagedTools(entries: readonly ManagedTool[], input: ToolSearchInput = {}) {
  const rev = revision(entries);
  const { tools, query, family, group } = selection(entries, input);
  const key = fingerprint([rev, "search", query, family, group]);
  const offset = cursorOffset(input.cursor, key);
  if (offset > tools.length) throw new Error("Tool cursor is out of range.");
  const limit = integer(input.limit, 12, 1, 20);
  return {
    revision: rev,
    total: tools.length,
    tools: tools.slice(offset, offset + limit).map(compact),
    nextCursor: nextCursor(key, offset + limit, tools.length),
  };
}

function resolveIds(entries: readonly ManagedTool[], ids: unknown, maximum: number) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > maximum ||
    ids.some((id) => typeof id !== "string" || !id || id.length > 300)
  )
    throw new Error(`Select 1 to ${maximum} tool IDs or exact names.`);
  return [...new Set(ids as string[])].map((id) => {
    const matches = entries.filter((entry) => entry.id === id || entry.name === id);
    if (matches.length > 1) throw new Error(`Ambiguous tool name: ${id}. Use its group:action ID.`);
    return (
      matches[0] ?? { id, supported: false, capability: { state: "unsupported", evidence: null } }
    );
  });
}
export type ToolDescribeInput = { ids: string[]; cursor?: string; maxChars?: number };
/** JSON text chunks preserve complete schemas; concatenate content until nextCursor is null, then parse. */
export function describeManagedTools(entries: readonly ManagedTool[], input: ToolDescribeInput) {
  const rev = revision(entries);
  const tools = resolveIds(entries, input.ids, 4);
  const document = stableJson({ tools });
  const key = fingerprint([rev, "describe", tools.map((entry) => entry.id)]);
  const offset = cursorOffset(input.cursor, key);
  if (offset > document.length) throw new Error("Tool cursor is out of range.");
  const maxChars = integer(input.maxChars, 10000, 256, 12000);
  // Never split a UTF-16 surrogate pair between chunks.
  let end = Math.min(offset + maxChars, document.length);
  if (end < document.length && /[\uD800-\uDBFF]/.test(document[end - 1])) end--;
  return {
    revision: rev,
    encoding: "json" as const,
    content: document.slice(offset, end),
    offset,
    totalChars: document.length,
    nextCursor: nextCursor(key, end, document.length),
  };
}
export type ToolStatusInput = ToolSearchInput & { ids?: string[] };
export function managedToolStatus(entries: readonly ManagedTool[], input: ToolStatusInput = {}) {
  const rev = revision(entries);
  const filtered = selection(entries, input);
  const tools =
    input.ids === undefined ? filtered.tools : resolveIds(filtered.tools, input.ids, 20);
  const key = fingerprint([
    rev,
    "status",
    filtered.query,
    filtered.family,
    filtered.group,
    tools.map((entry) => entry.id),
  ]);
  const offset = cursorOffset(input.cursor, key);
  if (offset > tools.length) throw new Error("Tool cursor is out of range.");
  const limit = integer(input.limit, 12, 1, 20);
  return {
    revision: rev,
    total: tools.length,
    tools: tools.slice(offset, offset + limit).map((entry) => ({
      id: entry.id,
      supported: entry.supported,
      capability: entry.capability,
      authority:
        "Existing host authorization is checked on execution; discovery grants no authority.",
    })),
    nextCursor: nextCursor(key, offset + limit, tools.length),
  };
}
