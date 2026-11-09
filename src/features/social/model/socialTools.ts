/**
 * MCP identifiers use underscores; host RPC/CLI keeps the dot contract.
 * Every entry is an AI-callable operation. Owner-only actions never appear here; the Host
 * registry's `tool` flag and this list must agree (guarded by social-tools.test.ts).
 */
export const SOCIAL_TOOLS = [
  "policy.get",
  "accounts.list",
  "capabilities.get",
  "campaigns.create",
  "campaigns.preview",
  "campaigns.schedule",
  "campaigns.status",
  "inbox.list",
  "thread.read",
  "replies.draft",
  "drafts.read",
  "drafts.update",
  "replies.send",
  "contacts.upsert",
  "contacts.search",
  "segments.create",
  "messages.draft",
  "messages.send",
  "comments.draft",
  "comments.send",
  "automations.create",
  "automations.pause",
  "jobs.status",
  "jobs.cancel",
  "programs.list",
  "programs.configure",
  "programs.status",
  "programs.generate",
  "programs.preview-schedule",
  // Audience (4B-host-1)
  "people.list",
  "people.get",
  "people.update",
  "people.merge",
  "people.matchSuggestions",
  "people.score",
  "lists.list",
  "lists.save",
  "lists.delete",
  "lists.addMembers",
  "lists.removeMembers",
  "audience.collect",
  "captureRules.list",
  "captureRules.save",
  "captureRules.setEnabled",
  "captureRules.delete",
  // Outreach and email (4B-host-2)
  "sequences.list",
  "sequences.save",
  "sequences.start",
  "sequences.pause",
  "sequences.stats",
  "enrollments.list",
  "email.send",
  "suppressions.add",
  // Inbox (4C)
  "inbox.unified",
  "inbox.setStatus",
  "inbox.timeline",
  "inbox.replyOptions",
  // Autonomy and AI (4D)
  "autonomy.get",
  "ai.actions.list",
  "ai.actions.undo",
  "ai.stop",
  "ai.summary",
  "ai.report",
  // Browser layers (4H)
  "browser.needsHuman.list",
  "browser.recipeSuggestions.list",
] as const;
export type SocialTool = (typeof SOCIAL_TOOLS)[number];
export function socialToolName(tool: SocialTool): string {
  return `social_${tool.replace(/[.-]/g, "_")}`;
}

/**
 * Thrown by the AI command path when no agent/model is set in the Social policy. The UI matches
 * this exact text to show the first-use model choice instead of a generic failure.
 */
export const AI_MODEL_REQUIRED_MESSAGE = "Choose an AI agent and model first.";
