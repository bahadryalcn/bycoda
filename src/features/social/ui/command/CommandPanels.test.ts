// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SummaryCards } from "./SummaryCards";
import { WaitingForYou } from "./WaitingForYou";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

it("labels the four summary cards and shows dashes before the first load", () => {
  act(() => root.render(createElement(SummaryCards, {})));
  const cards = [...element.querySelectorAll(".command-card")].map((card) => [
    card.querySelector(".command-card-label")?.textContent,
    card.querySelector(".command-card-value")?.textContent,
  ]);
  expect(cards).toEqual([
    ["Sent today", "—"],
    ["Pending", "—"],
    ["New people", "—"],
    ["Reply rate", "—"],
  ]);
});

it("shows a loaded zero as 0, not as a dash", () => {
  act(() =>
    root.render(
      createElement(SummaryCards, {
        summary: { sentToday: 0, pending: 0, newPeople: 0, replyRate: 0, waitingForYou: 0 },
      }),
    ),
  );
  expect([...element.querySelectorAll(".command-card-value")].map((n) => n.textContent)).toEqual([
    "0",
    "0",
    "0",
    "0%",
  ]);
});

it("keeps the owner queue section and renders the browser checks inside it", () => {
  act(() =>
    root.render(
      createElement(
        WaitingForYou,
        { approvalCount: 0 },
        createElement("p", { id: "browser-checks" }, "Sign in to continue."),
      ),
    ),
  );
  const section = element.querySelector('section[aria-label="Waiting for you"]');
  expect(section?.querySelector("h3")?.textContent).toBe("Waiting for you");
  expect(section?.querySelector("#browser-checks")?.textContent).toBe("Sign in to continue.");
  expect(section?.querySelector(".command-muted")).toBeNull();
});

it("says how many actions wait for approval, with the number filled in", () => {
  act(() => root.render(createElement(WaitingForYou, { approvalCount: 2 }, null)));
  expect(element.textContent).toContain("2 actions wait for your approval.");
  expect(element.textContent).not.toContain("{count}");
});

it("uses the singular for exactly one waiting action", () => {
  act(() => root.render(createElement(WaitingForYou, { approvalCount: 1 }, null)));
  expect(element.textContent).toContain("1 action waits for your approval.");
});

it("shows the reply rate with a meter and names the approvals on the Pending tile", () => {
  const summary = { sentToday: 3, pending: 2, newPeople: 5, replyRate: 0.25, waitingForYou: 0 };
  act(() => root.render(createElement(SummaryCards, { summary, approvalCount: 2 })));
  const meter = element.querySelector('[role="meter"]');
  expect(meter?.getAttribute("aria-valuenow")).toBe("25");
  expect(element.querySelector(".command-card-note")?.textContent).toBe("2 waiting for approval");
});

it("adds approvals and browser checks into one count badge", () => {
  act(() => root.render(createElement(WaitingForYou, { approvalCount: 2, humanCount: 1 }, null)));
  expect(element.querySelector("section h3 + *")?.textContent).toBe("3");
});
