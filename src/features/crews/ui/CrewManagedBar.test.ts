// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { consumeCrewsPageRequest, pendingCrewsPageRequest } from "../model/crewsPage";
import { CrewManagedBar } from "./CrewManagedBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  const pending = pendingCrewsPageRequest();
  if (pending) consumeCrewsPageRequest(pending);
});

it("shows crew and role, offers only Open in Crews and lands on that run", async () => {
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(CrewManagedBar, {
        managed: {
          sessionId: "s",
          runId: "run-9",
          definitionId: "def-3",
          crewName: "Product Team",
          role: "coordinator",
          memberName: "Lead",
        },
      }),
    );
  });
  expect(host.textContent).toContain("Product Team");
  expect(host.textContent).toContain("Lead");
  expect(host.querySelector("textarea,input,[contenteditable]")).toBeNull();
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons).toHaveLength(1);
  await act(async () => buttons[0]!.click());
  expect(pendingCrewsPageRequest()).toMatchObject({
    tab: "work",
    definitionId: "def-3",
    runId: "run-9",
  });
  await act(async () => root.unmount());
});
