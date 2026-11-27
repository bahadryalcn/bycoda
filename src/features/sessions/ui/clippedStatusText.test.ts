// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrewManagedBar } from "../../crews/ui/CrewManagedBar";
import { MessageQueue } from "./MessageQueue";
import { ModelSwitchRow } from "./ModelSwitchRow";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const textElement = (text: string): HTMLElement => {
  const found = [...container.querySelectorAll<HTMLElement>("*")].find(
    (el) => el.children.length === 0 && el.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no element with text: ${text}`);
  return found;
};

describe("clipped status sentences stay readable", () => {
  it("lets the model switch summary note shrink and ellipsize instead of shrink-0 (#1280)", async () => {
    await act(async () =>
      root.render(
        createElement(ModelSwitchRow, {
          meta: {
            steps: [
              { harness: "claude", account: "work", model: "Opus 5.5", at: 1 },
              { harness: "codex", model: "GPT-5.5", at: 2, note: "summary" },
            ],
          },
        }),
      ),
    );
    expect(
      container.querySelector('[role="img"][aria-label="Summary goes with next message"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Summary goes with next message");
  });

  it("makes the queue's subagent wait sentence truncating and focusable for its overflow tooltip (#1281)", async () => {
    await act(async () =>
      root.render(
        createElement(MessageQueue, {
          parentSessionId: "clipped-status-queue",
          messages: [{ id: "q1", text: "first", attachments: [] }],
          canAttach: true,
          waitingOnSubagents: true,
          onSteer: () => true,
          onDelete: () => true,
        }),
      ),
    );
    const note = textElement("Sends when the subagents finish");
    expect(note.hasAttribute("data-truncate")).toBe(true);
    expect(note.getAttribute("tabindex")).toBe("0");
  });

  it("keeps the Crew managed bar name truncating for its overflow tooltip (#1281)", async () => {
    await act(async () =>
      root.render(
        createElement(CrewManagedBar, {
          managed: {
            sessionId: "s",
            runId: "run-1",
            definitionId: "def-1",
            crewName: "Product Team",
            role: "coordinator",
            memberName: "Lead",
          },
        }),
      ),
    );
    // The explanatory note is gone; the crew name is the long line that must clip and stay reachable.
    const name = textElement("Product Team");
    expect(name.hasAttribute("data-truncate")).toBe(true);
  });
});
