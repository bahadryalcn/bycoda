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
  const cards = [...element.querySelectorAll("[role=group] > div")].map((card) => [
    card.children[0]?.textContent,
    card.children[1]?.textContent,
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
  expect(
    [...element.querySelectorAll("[role=group] > div > :nth-child(2)")].map((n) => n.textContent),
  ).toEqual(["0", "0", "0", "0%"]);
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

it("states the waiting count once, on the Waiting for you badge", () => {
  act(() => root.render(createElement(WaitingForYou, { approvalCount: 2 }, null)));
  expect(element.querySelector('[aria-label="2 waiting for you"]')?.textContent).toBe("2");
  expect(element.textContent).not.toContain("wait for your approval");
});

it("shows the reply rate with a meter", () => {
  const summary = { sentToday: 3, pending: 2, newPeople: 5, replyRate: 0.25, waitingForYou: 0 };
  act(() => root.render(createElement(SummaryCards, { summary })));
  const meter = element.querySelector('[role="meter"]');
  expect(meter?.getAttribute("aria-valuenow")).toBe("25");
  expect(element.querySelector(".command-card-note")).toBeNull();
});

it("adds approvals and browser checks into one count badge", () => {
  act(() => root.render(createElement(WaitingForYou, { approvalCount: 2, humanCount: 1 }, null)));
  expect(element.querySelector("section h3 + *")?.textContent).toBe("3");
});
