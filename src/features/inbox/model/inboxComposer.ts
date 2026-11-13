import {
  inboxItemRef,
  type GithubLabel,
  type InboxItem,
  type InboxKind,
  type InboxProvider,
} from "./githubTasks";

export function inboxStartDraft(item: InboxItem, body?: string): string {
  if (item.provider === "linear" || item.provider === "jira") {
    const provider = item.provider === "jira" ? "Jira" : "Linear";
    const id = item.identifier?.trim() || `${provider} #${item.number}`;
    const title = item.title.trim() || id;
    const lines = [`Work on this ${provider} issue:`, "", `${id} ${title}`];
    const url = item.url.trim();
    if (url) lines.push(url);
    const description = body?.trim();
    if (description) {
      lines.push("", description);
    }
    return `${lines.join("\n")}\n`;
  }
  const kind = item.kind === "pr" ? "pull request" : "issue";
  const provider =
    item.provider === "gitlab" ? "GitLab" : item.provider === "azuredevops" ? "ADO" : "GitHub";
  const providerKind = item.provider === "gitlab" && item.kind === "pr" ? "merge request" : kind;
  const title = item.title.trim() || `${provider} ${providerKind} #${item.number}`;
  const lines = [`Work on this ${provider} ${providerKind}:`, "", `#${item.number} ${title}`];
  const url = item.url.trim();
  if (url) lines.push(url);
  return `${lines.join("\n")}\n`;
}

/** Compact chip shown above the composer when starting from Inbox. */
export type InboxComposerCard = {
  provider: InboxProvider;
  kind: InboxKind;
  identifier: string;
  title: string;
  url: string;
  source: string;
  labels: GithubLabel[];
  prompt: string;
};

export function inboxComposerCard(item: InboxItem, body?: string): InboxComposerCard {
  const tracker = item.provider === "linear" || item.provider === "jira";
  return {
    provider: item.provider,
    kind: item.kind,
    identifier: inboxItemRef(item),
    title: item.title.trim() || inboxItemRef(item),
    url: item.url.trim(),
    source: tracker ? item.teamName || item.repo : item.repo,
    labels: item.labels.slice(0, 2),
    prompt: inboxStartDraft(item, body).trimEnd(),
  };
}

export function composeInboxMessage(card: InboxComposerCard | undefined, text: string): string {
  const prompt = card?.prompt.trim() ?? "";
  const note = text.trim();
  if (!prompt) return note;
  if (!note) return prompt;
  return `${prompt}\n\n${note}`;
}
