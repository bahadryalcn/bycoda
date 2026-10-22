// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SshRunbooks } from "./SshRunbooks";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { SshRunbook, SshRunStatus } from "../model/sshRunbooks";
import type { ServerRecord } from "../model/serverInventory";
const native = vi.hoisted(() => ({
  abandon: vi.fn(),
  proxyRequest: vi.fn(),
  revoke: vi.fn(),
  pending: vi.fn(),
  dismiss: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  review: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("./useSshHttpProxyApproval", () => ({
  useSshHttpProxyApproval: () => ({ request: native.proxyRequest, dialog: null }),
}));
vi.mock("../model/sshHttpProxyApproval", () => ({ revokeSshHttpProxyApproval: native.revoke }));
vi.mock("../model/sshRunbooks", async (importActual) => ({
  ...(await importActual<object>()),
  abandonMissingSshRunbookStart: native.abandon,
  listSshRunbooks: native.list,
  pendingSshRunbookIntents: native.pending,
  dismissSshRunbookIntent: native.dismiss,
  saveSshRunbook: native.save,
  removeSshRunbook: native.remove,
  reviewSshRunbook: native.review,
  startSshRunbook: native.start,
  statusSshRunbook: native.status,
  cancelSshRunbook: native.cancel,
}));
vi.mock("../../../shared/ui/SearchableSelect", () => ({
  SearchableSelect: ({ label, value, onChange, options, multiple, disabled }: any) =>
    createElement(
      "label",
      {},
      label,
      createElement(
        "select",
        {
          multiple,
          disabled,
          "aria-label": label,
          value,
          onChange: (event: any) =>
            onChange(
              multiple
                ? [...event.target.selectedOptions].map((item: any) => item.value)
                : event.target.value,
            ),
        },
        options.map((item: any) =>
          createElement("option", { key: item.value, value: item.value }, item.label),
        ),
      ),
    ),
}));
const server: ServerRecord = {
  id: "server-1",
  name: "First server",
  kind: "ssh",
  sshEndpoint: { host: "server.invalid", user: "local", port: 22 },
  metadata: { tags: [], favorite: false },
};
const book: SshRunbook = {
  id: "book-1",
  name: "Inspect",
  revision: 3,
  script: "printf '%s' '$HOME'\npwd",
  shell: "posix",
  targetIds: [server.id],
  limits: { concurrency: 1, timeoutSeconds: 60 },
};
const outcome = (
  runId: string,
  state: "exited" | "running" | "cancelled" = "exited",
): SshRunStatus => ({
  runId,
  automationId: book.id,
  revision: 3,
  owner: "main",
  digest: "a".repeat(64),
  targets: [{ serverId: server.id, state, exitCode: state === "exited" ? 0 : null, reason: null }],
});
const review = () => ({
  review: { reviewId: "review-ticket", digest: "a".repeat(64), expiresInSeconds: 120 },
  profile: book,
  targets: [{ serverId: server.id, endpoint: { ...server.sshEndpoint, user: "effective" } }],
});
let root: Root, host: HTMLDivElement, lastRun: string | undefined;
function Harness({ initialRun }: { initialRun?: string }) {
  const [runId, setRun] = useState(initialRun);
  return createElement(SshRunbooks, {
    server,
    servers: [server],
    runId,
    onRun: (id) => {
      lastRun = id;
      setRun(id);
    },
    onAbandon: () => {
      lastRun = undefined;
      setRun(undefined);
    },
    onClose: vi.fn(),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  resetRetainedState();
  lastRun = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  native.abandon.mockResolvedValue(undefined);
  native.revoke.mockResolvedValue(undefined);
  native.proxyRequest.mockResolvedValue(undefined);
  native.pending.mockResolvedValue([]);
  native.dismiss.mockResolvedValue(undefined);
  native.list.mockResolvedValue([book]);
  native.review.mockResolvedValue(review());
  native.status.mockImplementation(async (id: string) => outcome(id));
  native.start.mockImplementation(async (_id, _revision, _review, id: string) => outcome(id));
  native.save.mockImplementation(async (value: SshRunbook) => ({
    ...value,
    revision: value.revision + 1,
  }));
  native.cancel.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent === name)!;
const field = (name: string) => {
  const select = document.querySelector(`select[aria-label="${name}"]`);
  if (select) return select as HTMLInputElement;
  const label = [...document.querySelectorAll("label")].find(
    (item) => item.textContent?.trim() === name,
  )!;
  return (
    label.htmlFor
      ? document.getElementById(label.htmlFor)
      : label.querySelector("input,textarea,select")
  ) as HTMLInputElement;
};
async function input(name: string, value: string) {
  const item = field(name);
  const prototype =
    item.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : item.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(item, value);
    item.dispatchEvent(
      new Event(item.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
    );
  });
}
async function render(initialRun?: string) {
  await act(async () => root.render(createElement(Harness, { initialRun })));
}
async function selectSaved() {
  await input("Runbook", book.id);
}
it("mounts/list reads only; reopening a known run asks status without execution", async () => {
  await render("known-run");
  expect(native.list).toHaveBeenCalledOnce();
  expect(native.status).toHaveBeenCalledWith("known-run");
  expect(native.review).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Exited");
});
it("saves an explicit new definition without reviewing or executing it", async () => {
  await render();
  await input("Runbook name", "New command");
  await input("SSH script", "echo '$HOME'\npwd");
  await act(async () => button("Save runbook").click());
  expect(native.save).toHaveBeenCalledWith(
    expect.objectContaining({
      revision: 0,
      name: "New command",
      script: "echo '$HOME'\npwd",
      targetIds: [server.id],
    }),
    null,
  );
  expect(native.review).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
});
it("reviews the saved revision/effective target, invalidates edits, and dispatches approval once", async () => {
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  expect(native.review).toHaveBeenCalledWith(book.id, 3);
  expect(document.body.textContent).toContain("effective@server.invalid:22");
  await input("SSH script", "changed");
  expect(button("Approve and run")).toBeUndefined();
  expect(button("Review execution").disabled).toBe(true);
  await input("SSH script", book.script);
  await act(async () => button("Review execution").click());
  await act(async () => {
    button("Approve and run").click();
    button("Approve and run").click();
  });
  expect(native.start).toHaveBeenCalledOnce();
  expect(native.start).toHaveBeenCalledWith(book.id, 3, "review-ticket", lastRun, {});
  expect(lastRun).toMatch(/^[a-f0-9-]+$/);
});
it("preserves revision-conflicted drafts and refuses expired approval", async () => {
  await render();
  await selectSaved();
  await input("Runbook name", "Changed name");
  native.save.mockRejectedValueOnce(new Error("revision conflict"));
  await act(async () => button("Save runbook").click());
  expect(field("Runbook name").value).toBe("Changed name");
  expect(document.body.textContent).toContain("revision conflict");
  await input("Runbook name", book.name);
  await act(async () => button("Review execution").click());
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 121000);
  await act(async () => button("Approve and run").click());
  expect(native.start).not.toHaveBeenCalled();
});
it("retains ambiguous dispatch identity and recovers/cancels by status without retry", async () => {
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  native.start.mockRejectedValueOnce(new Error("response interrupted"));
  native.status.mockRejectedValueOnce(new Error("status unavailable"));
  await act(async () => button("Approve and run").click());
  expect(lastRun).toBeTruthy();
  expect(document.body.textContent).toContain(lastRun!);
  expect(field("SSH script").closest("fieldset")!.disabled).toBe(true);
  expect(button("Approve and run")).toBeUndefined();
  native.status.mockResolvedValue(outcome(lastRun!, "running"));
  await act(async () => button("Refresh status").click());
  expect(native.status).toHaveBeenCalledWith(lastRun);
  native.status.mockResolvedValue(outcome(lastRun!, "cancelled"));
  await act(async () => button("Cancel target").click());
  expect(native.cancel).toHaveBeenCalledWith(lastRun, server.id);
  expect(native.start).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain("Cancelled");
});
it("discards late reviews after unmount instead of preserving executable approval", async () => {
  let answer: (value: any) => void = () => {};
  native.review.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  await act(async () => root.render(null));
  await act(async () => answer(review()));
  expect(native.start).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("Approve and run");
});

it("exposes native effective public auth, hop trust and group provenance in the review", async () => {
  native.review.mockResolvedValue({
    ...review(),
    targets: [
      {
        serverId: server.id,
        endpoint: {
          ...server.sshEndpoint,
          identityFile: "~/keys/effective",
          certificateFile: "~/keys/cert.pub",
          jumpPolicies: [
            {
              host: "hop.invalid",
              port: 2222,
              user: "jump",
              identityFile: "~/keys/hop",
              knownHostsFile: "~/trust/hop",
            },
          ],
        },
        configuration: {
          digest: "c".repeat(64),
          environment: [{ name: "APP_STAGE", value: "literal" }],
          shellKind: "posix",
          provenance: { identityFile: { source: "group", groupId: "group-1", revision: 5 } },
        },
      },
    ],
  });
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  expect(document.body.textContent).toContain("~/keys/effective");
  expect(document.body.textContent).toContain("~/keys/cert.pub");
  expect(document.body.textContent).toContain("jump@hop.invalid:2222");
  expect(document.body.textContent).toContain("~/trust/hop");
  expect(document.body.textContent).toContain("group-1");
  expect(document.body.textContent).toContain("APP_STAGE=literal");
  expect(native.start).not.toHaveBeenCalled();
});
it("rejects a review for another saved revision without changing the draft", async () => {
  native.review.mockResolvedValue({ ...review(), profile: { ...book, revision: 4 } });
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  expect(button("Approve and run")).toBeUndefined();
  expect(document.body.textContent).toContain("Runbook changed");
  expect(field("SSH script").value).toBe(book.script);
  expect(native.start).not.toHaveBeenCalled();
});

it("keeps trigger edits as saved metadata and creates no execution approval", async () => {
  await render();
  await selectSaved();
  await input("Schedule interval (minutes)", "15");
  await act(async () => button("Save runbook").click());
  expect(native.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      triggers: { startupServerIds: [], intervalMinutes: 15, nextRunAt: null },
    }),
    3,
  );
  expect(native.review).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
});
it("pending scheduled reviews never execute on mount and dismiss independently", async () => {
  native.pending.mockResolvedValue([
    {
      id: "intent-1",
      automationId: book.id,
      revision: 3,
      trigger: "scheduled",
      status: "pendingReview",
      createdAt: 1,
    },
  ]);
  await render();
  expect(document.body.textContent).toContain("Pending review");
  expect(native.start).not.toHaveBeenCalled();
  expect(native.review).not.toHaveBeenCalled();
  await act(async () => button("Review").click());
  await act(async () => button("Review execution").click());
  expect(native.review).toHaveBeenCalledWith(book.id, 3, "intent-1");
  await act(async () => button("Dismiss").click());
  expect(native.dismiss).toHaveBeenCalledWith("intent-1");
  expect(native.start).not.toHaveBeenCalled();
});
it("rejects a stale pending revision before requesting native execution review", async () => {
  native.pending.mockResolvedValue([
    {
      id: "old",
      automationId: book.id,
      revision: 2,
      trigger: "startup",
      status: "pendingReview",
      createdAt: 1,
    },
  ]);
  await render();
  await act(async () => button("Review").click());
  expect(native.review).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Runbook changed");
});

it("revokes earlier target grants when a later proxy approval is cancelled before dispatch", async () => {
  const multi = { ...book, targetIds: [server.id, "server-2"] };
  native.list.mockResolvedValue([multi]);
  native.review.mockResolvedValue({
    ...review(),
    profile: multi,
    targets: multi.targetIds.map((serverId) => ({
      serverId,
      endpoint: { ...server.sshEndpoint, httpProxy: { host: "proxy.invalid", port: 8080 } },
    })),
  });
  native.proxyRequest.mockResolvedValueOnce("unused-first").mockResolvedValueOnce(null);
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  await act(async () => button("Approve and run").click());
  expect(native.revoke).toHaveBeenCalledExactlyOnceWith("unused-first");
  expect(native.start).not.toHaveBeenCalled();
  expect(lastRun).toBeUndefined();
});
it("keeps dispatched grants untouched when the start response is ambiguous", async () => {
  native.review.mockResolvedValue({
    ...review(),
    targets: [
      {
        serverId: server.id,
        endpoint: { ...server.sshEndpoint, httpProxy: { host: "proxy.invalid", port: 8080 } },
      },
    ],
  });
  native.proxyRequest.mockResolvedValueOnce("dispatched-ticket");
  native.start.mockRejectedValueOnce(new Error("Ambiguous start"));
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  await act(async () => button("Approve and run").click());
  expect(native.start).toHaveBeenCalledOnce();
  expect(native.revoke).not.toHaveBeenCalled();
  expect(lastRun).toBeDefined();
});

it("retains the original failed-attempt authority on abandon failure then releases only after native confirmation", async () => {
  native.start.mockRejectedValueOnce(new Error("preclaim rejected"));
  native.status.mockRejectedValue(new Error("not found"));
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  await act(async () => button("Approve and run").click());
  const originalRun = lastRun;
  expect(button("Abandon pending start")).toBeDefined();
  native.abandon.mockRejectedValueOnce(new Error("abandon response interrupted"));
  await act(async () => button("Abandon pending start").click());
  expect(lastRun).toBe(originalRun);
  expect(document.body.textContent).toContain("abandon response interrupted");
  expect(native.abandon).toHaveBeenCalledWith(originalRun, book.id, 3);
  await act(async () => button("Abandon pending start").click());
  expect(lastRun).toBeUndefined();
  expect(document.body.textContent).not.toContain("Abandon pending start");
  expect(native.start).toHaveBeenCalledOnce();
  expect(native.review).toHaveBeenCalledOnce();
  expect(button("Review execution").disabled).toBe(false);
});
it("never offers abandonment for a known running execution", async () => {
  native.start.mockImplementation(async (_id, _rev, _review, id) => outcome(id, "running"));
  native.status.mockImplementation(async (id) => outcome(id, "running"));
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  await act(async () => button("Approve and run").click());
  expect(document.body.textContent).toContain("Running");
  expect(button("Abandon pending start")).toBeUndefined();
  expect(native.abandon).not.toHaveBeenCalled();
});

it("does not clear parent authority when abandon confirmation arrives after unmount", async () => {
  native.start.mockRejectedValueOnce(new Error("preclaim rejected"));
  native.status.mockRejectedValue(new Error("missing"));
  let answer: () => void = () => {};
  native.abandon.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        answer = resolve;
      }),
  );
  await render();
  await selectSaved();
  await act(async () => button("Review execution").click());
  await act(async () => button("Approve and run").click());
  const originalRun = lastRun;
  await act(async () => button("Abandon pending start").click());
  await act(async () => root.render(null));
  await act(async () => answer());
  expect(lastRun).toBe(originalRun);
  expect(native.start).toHaveBeenCalledOnce();
});
it("never guesses an original pending-start profile from an arbitrary restored run ID", async () => {
  native.status.mockRejectedValue(new Error("missing"));
  await render("legacy-id-without-origin");
  expect(button("Abandon pending start")).toBeUndefined();
  expect(native.abandon).not.toHaveBeenCalled();
});

it("initializes from completed native intent loads, preserves manual edits on refresh, and responds to a new intent prop", async () => {
  const second = { ...book, id: "book-2", name: "Second definition", revision: 7 };
  native.list.mockResolvedValue([book, second]);
  native.pending.mockResolvedValue([
    {
      id: "intent-a",
      automationId: book.id,
      revision: 3,
      trigger: "scheduled",
      status: "pendingReview",
    },
    {
      id: "intent-b",
      automationId: second.id,
      revision: 7,
      trigger: "scheduled",
      status: "pendingReview",
    },
  ]);
  const props = (intentId: string, initialAutomationId: string) => ({
    server,
    servers: [server],
    intentId,
    initialAutomationId,
    onRun: vi.fn(),
    onClose: vi.fn(),
  });
  await act(async () => root.render(createElement(SshRunbooks, props("intent-a", book.id))));
  expect(field("Runbook name").value).toBe(book.name);
  await input("Runbook name", "Unsubmitted local draft");
  await act(async () => button("Refresh").click());
  expect(field("Runbook name").value).toBe("Unsubmitted local draft");
  await act(async () => root.render(createElement(SshRunbooks, props("intent-b", second.id))));
  expect(field("Runbook name").value).toBe(second.name);
  expect(native.review).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
});
it("ignores an older native initialization response after the requested profile changes", async () => {
  let oldAnswer: (value: SshRunbook[]) => void = () => {};
  native.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        oldAnswer = resolve;
      }),
  );
  const second = { ...book, id: "book-2", name: "Current native definition", revision: 7 };
  native.list.mockResolvedValueOnce([second]);
  const props = (initialAutomationId: string) => ({
    server,
    servers: [server],
    initialAutomationId,
    onRun: vi.fn(),
    onClose: vi.fn(),
  });
  await act(async () => root.render(createElement(SshRunbooks, props(book.id))));
  await act(async () => root.render(createElement(SshRunbooks, props(second.id))));
  expect(field("Runbook name").value).toBe(second.name);
  await act(async () => oldAnswer([book]));
  expect(field("Runbook name").value).toBe(second.name);
  expect(native.start).not.toHaveBeenCalled();
  expect(native.review).not.toHaveBeenCalled();
});
