import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InboxDetail } from "../../../src/features/inbox/ui/InboxDetail";
import type { InboxItem, InboxProvider } from "../../../src/features/inbox/model/githubTasks";
import { inboxItemKey } from "../../../src/features/inbox/model/githubTasks";
import { useRetainedState } from "../../../src/shared/hooks/useRetainedState";
import { useRef, useState } from "react";
import { InboxMedia } from "../../../src/features/inbox/ui/InboxMedia";
import { InboxConnectMenu } from "../../../src/features/inbox/ui/InboxConnectMenu";
import { InboxScopeCollection } from "../../../src/features/settings/ui/InboxScopeCollection";
import { Button } from "../../../src/shared/ui/Button";
import "../../../src/features/settings/ui/SettingsCollection.css";
import "../../../src/features/settings/ui/InboxSettings.css";

const params = new URLSearchParams(location.search);
export const inboxAudit = params.has("auditProvider");
const providers: InboxProvider[] = ["github", "jira", "gitlab", "azuredevops", "linear"];
const requestedProvider = params.get("auditProvider");
const provider = providers.find((value) => value === requestedProvider) ?? "github";
const pullRequest =
  params.get("auditKind") === "pr" && provider !== "jira" && provider !== "linear";
let readError = params.get("auditState") === "error";
const head = "a".repeat(40);
const mediaReads = new Map<string, number>();
const body =
  "## Payment validation\n\nKeep the entered amount when validation fails.\n\n- Preserve the draft\n- Show the error beside the field\n\n| Field | Expected |\n| --- | --- |\n| Amount | Existing value |\n\n`validatePayment(amount)`";
const thread = {
  comments: [
    {
      id: "audit-comment",
      kind: "comment",
      author: "Ada Yılmaz",
      body: "**Review note**\n\nThe draft must survive retry.",
      createdAt: "2026-11-13T10:00:00Z",
      url: "",
      state: "",
      path: "",
      line: null,
      resolved: false,
      threadId: "audit-comment",
      replies: [],
    },
  ],
  commits: [],
  truncated: false,
  reviewDecision: pullRequest ? "REVIEW_REQUIRED" : "",
  baseRefName: pullRequest ? "main" : "",
  headRefName: pullRequest ? "fix/payment-validation" : "",
};
const fileNames = [
  "src/payment/validation.ts",
  "src/payment/validation.test.ts",
  "src/payment/form.tsx",
  "src/payment/messages.ts",
  "src/payment/types.ts",
  "src/payment/amount.ts",
  "docs/payment-validation.md",
];
const diff = {
  headOid: head,
  additions: 7,
  deletions: 7,
  truncated: false,
  files: fileNames.map((path) => ({ path, additions: 1, deletions: 1 })),
  patch: fileNames
    .map(
      (path) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-const valid = false;\n+const valid = true;`,
    )
    .join("\n"),
};
const item: InboxItem = {
  provider,
  kind:
    provider === "jira" ? "jira" : provider === "linear" ? "linear" : pullRequest ? "pr" : "issue",
  id: "audit-item",
  identifier: "PAY-42",
  number: 42,
  title: "Keep payment form drafts when validation fails, including long project and account names",
  url:
    provider === "jira"
      ? "https://example.atlassian.net/browse/PAY-42"
      : `https://example.test/${provider}/42`,
  state: "open",
  updatedAt: "2026-11-13T10:00:00Z",
  labels: [{ name: "payment-validation", color: "" }],
  assignees: [{ login: "Grace Öztürk" }],
  draft: false,
  repo: "fixture/payment-service",
  projectPath: "G:/fixture/payment-service",
  teamId: "payment",
  teamName: "Payments",
  projectId: "payment",
  projectName: "Payment service",
};

Object.assign(window, {
  inboxAuditRecover: () => {
    readError = false;
  },
});

/** Offline typed-response fixture. Undefined delegates to the existing board fixture. */
export async function inboxAuditResponse(
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!inboxAudit) return undefined;
  if (command === "fetch_inbox_media") {
    const url = String(args.url);
    const reads = (mediaReads.get(url) ?? 0) + 1;
    mediaReads.set(url, reads);
    if (url.endsWith("audit-image") && reads === 1)
      return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]).buffer;
    if (url.endsWith("audit-image"))
      return Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=",
        ),
        (value) => value.charCodeAt(0),
      ).buffer;
    return new TextEncoder().encode(
      url.endsWith("audit-pdf") ? "%PDF-1.7\n%%EOF" : "Offline fixture attachment",
    ).buffer;
  }
  if (/(?:_comment|_pr_action|_issue_transition|_board_move|_set_config|_set_token)$/.test(command))
    throw new Error("Offline fixture: provider writes are blocked");
  const details = /(?:work_item_details|issue_details)$/.test(command);
  const discussion = /(?:work_item_thread|issue_thread)$/.test(command);
  if (details || discussion) {
    if (params.get("auditState") === "loading") return new Promise(() => {});
    if (readError) throw new Error("Offline fixture: access temporarily unavailable");
    if (params.get("auditState") === "empty")
      return details
        ? { body: "", author: "Ada Yılmaz", headRefOid: head }
        : { ...thread, comments: [] };
    return details
      ? {
          body,
          author: "Ada Yılmaz",
          ...(pullRequest
            ? { headRefOid: head, baseRefName: "main", headRefName: "fix/payment-validation" }
            : {}),
        }
      : thread;
  }
  if (command.endsWith("_pr_checks"))
    return {
      provider,
      headOid: head,
      checks: [
        {
          name: "Unit tests",
          workflow: "Validation",
          state: "fail",
          url: null,
          startedAt: "2026-11-13T10:00:00Z",
          completedAt: "2026-11-13T10:00:12Z",
        },
        {
          name: "Type check",
          workflow: "Validation",
          state: "pass",
          url: null,
          startedAt: "2026-11-13T10:00:00Z",
          completedAt: "2026-11-13T10:00:08Z",
        },
      ],
    };
  if (command.endsWith("_pr_diff") || command.endsWith("_mr_diff")) return diff;
  return undefined;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export function InboxAuditFixture() {
  useRetainedState(
    `inbox:comment:${item.projectPath}:${item.projectPath}:${inboxItemKey(item)}:comment`,
    params.has("auditDraft") ? "**Ready for review**\n\nPreserve the entered amount." : "",
  );
  if (params.get("auditScreen") === "scope") return <ScopeAuditFixture />;
  if (params.get("auditScreen") === "media")
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <h1>Offline attachment previews</h1>
        <InboxMedia
          src="https://github.com/user-attachments/assets/audit-image"
          alt="Audit image"
        />
        <InboxMedia src="https://github.com/user-attachments/assets/audit-pdf" alt="Audit PDF" />
        <InboxMedia src="https://github.com/user-attachments/assets/audit-file" alt="Audit file" />
      </main>
    );
  return (
    <QueryClientProvider client={client}>
      <main className="h-dvh min-w-0">
        <InboxDetail
          item={item}
          cwd={item.projectPath}
          revision={0}
          relatedSessions={[]}
          projects={[
            {
              path: item.projectPath,
              name: "payment-service",
              logoPath: null,
              mascotName: null,
              mascotColor: "",
            },
          ]}
          onDiscuss={() => {}}
          onStart={() => {}}
        />
      </main>
    </QueryClientProvider>
  );
}

function ScopeAuditFixture() {
  const [selected, setSelected] = useState(["one", "unavailable-project"]);
  const [connect, setConnect] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  Object.assign(window, { inboxAuditSelectedIds: () => selected });
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <h1>Inbox connection scope</h1>
      <Button ref={anchor} onClick={() => setConnect(true)}>
        Connect an inbox source
      </Button>
      {connect ? (
        <InboxConnectMenu
          anchor={anchor}
          sources={["github", "jira", "gitlab", "azuredevops", "linear"]}
          onClose={() => setConnect(false)}
          onConnect={() => setConnect(false)}
        />
      ) : null}
      <InboxScopeCollection
        label="Projects"
        searchLabel="Search projects"
        selectedIds={selected}
        onChange={setSelected}
        items={[
          { id: "one", title: "Payment validation service", meta: "PAY" },
          {
            id: "two",
            title: "Merchant portal with a long project name for overflow checking",
            meta: "PORTAL",
          },
        ]}
        summary={(count, total) => `${count} of ${total} projects selected`}
        emptyLabel="No projects"
        noMatchLabel="No matching projects"
      />
    </main>
  );
}
