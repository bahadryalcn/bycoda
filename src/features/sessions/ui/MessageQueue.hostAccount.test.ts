// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageQueue } from "./MessageQueue";
import { LOCAL_MODEL_SOURCE, ModelSourceContext, type ModelSource } from "./modelSource";
import type { QueuedMessage } from "../model/session";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// Queued for another provider than the conversation's, on an account only the Host has.
const queued: QueuedMessage = {
  id: "q1",
  text: "continue on Claude",
  attachments: [],
  modelTarget: {
    harness: "claude",
    model: "claude:opus",
    modelSettings: {},
    providerAccountId: "host-only-account",
  },
};

async function targetLabel(source: ModelSource) {
  await act(async () =>
    root.render(
      createElement(
        ModelSourceContext.Provider,
        { value: source },
        createElement(MessageQueue, {
          messages: [queued],
          canAttach: true,
          account: { harness: "codex" },
        }),
      ),
    ),
  );
  return container.querySelector("[data-queue-target]")?.textContent ?? "";
}

it("names a remote row's account from the owning Host, not from this computer", async () => {
  const label = await targetLabel({
    ...LOCAL_MODEL_SOURCE,
    id: "remote:host",
    accounts: { claude: [{ id: "host-only-account", label: "Personal" }] },
    accountsKnown: () => true,
  });
  expect(label).toContain("Personal");
  expect(label).not.toContain("Removed account");
});

it("leaves the account unnamed until the Host has reported that provider's accounts", async () => {
  const label = await targetLabel({
    ...LOCAL_MODEL_SOURCE,
    id: "remote:host",
    accounts: {},
    accountsKnown: () => false,
  });
  expect(label).not.toBe("");
  expect(label).not.toContain("account");
});

it("marks an account the Host no longer lists as unavailable there", async () => {
  const label = await targetLabel({
    ...LOCAL_MODEL_SOURCE,
    id: "remote:host",
    accounts: { claude: [{ id: "other", label: "Work" }] },
    accountsKnown: () => true,
  });
  expect(label).toContain("Unavailable Host account");
});

it("keeps the removed-account label for a local row whose account is gone", async () => {
  expect(await targetLabel(LOCAL_MODEL_SOURCE)).toContain("Removed account");
});
