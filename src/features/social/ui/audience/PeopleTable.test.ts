// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleTable, type PeopleTableProps } from "./PeopleTable";
import { buttonByText, mountHost, person, type MountedHost } from "./audienceTestKit";

let host: MountedHost;

beforeEach(() => {
  host = mountHost();
});

afterEach(() => {
  host.unmount();
});

const ada = person({
  id: "p1",
  name: "Ada",
  tags: ["vip"],
  score: { value: 87, reason: "Replied twice", at: 1 },
});
const grace = person({
  id: "p2",
  name: "Grace",
  handles: [],
  tags: ["alpha", "bravo", "charlie", "delta", "echo"],
});

function renderTable(overrides: Partial<PeopleTableProps> = {}) {
  const props: PeopleTableProps = {
    people: [ada, grace],
    selected: new Set<string>(),
    hasMore: false,
    loadingMore: false,
    onToggle: vi.fn(),
    onToggleAll: vi.fn(),
    onOpen: vi.fn(),
    onLoadMore: vi.fn(),
    ...overrides,
  };
  host.render(createElement(PeopleTable, props));
  return props;
}

function box(label: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`No checkbox "${label}"`);
  return input;
}

describe("PeopleTable", () => {
  it("names every row checkbox after the person so a screen reader hears who is selected", () => {
    renderTable();
    expect(box("Select Ada").type).toBe("checkbox");
    expect(box("Select Grace").type).toBe("checkbox");
    expect(box("Select all people on this page").type).toBe("checkbox");
  });

  it("labels the pipeline column with a translated header and shows platforms as icon marks with names", () => {
    renderTable();
    const headers = Array.from(document.querySelectorAll("th")).map((item) => item.textContent);
    expect(headers).toContain("Status");
    expect(headers).not.toContain("Stage");
    const marks = document.querySelectorAll("tbody tr:first-child .social-platform-mark");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]!.getAttribute("aria-label")).toBe("X");
  });

  it("reports a row toggle with the person id", () => {
    const props = renderTable();
    act(() => box("Select Grace").click());
    expect(props.onToggle).toHaveBeenCalledWith("p2");
  });

  it("selects every person on the page from the header box and clears them when all are selected", () => {
    const first = renderTable();
    act(() => box("Select all people on this page").click());
    expect(first.onToggleAll).toHaveBeenCalledWith(["p1", "p2"], true);

    const second = renderTable({ selected: new Set(["p1", "p2"]) });
    expect(box("Select all people on this page").checked).toBe(true);
    act(() => box("Select all people on this page").click());
    expect(second.onToggleAll).toHaveBeenCalledWith(["p1", "p2"], false);
  });

  it("shows a partial selection as mixed instead of checked", () => {
    renderTable({ selected: new Set(["p1"]) });
    const header = box("Select all people on this page");
    expect(header.checked).toBe(false);
    expect(header.indeterminate).toBe(true);
    expect(box("Select Ada").checked).toBe(true);
    expect(box("Select Grace").checked).toBe(false);
  });

  it("marks the open and the selected rows", () => {
    renderTable({ selected: new Set(["p2"]), activePersonId: "p1" });
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    expect(rows[0]!.getAttribute("data-active")).toBe("true");
    expect(rows[1]!.getAttribute("data-selected")).toBe("true");
  });

  it("opens the person panel from a row click as well as from the name", () => {
    const props = renderTable();
    act(() => document.querySelectorAll<HTMLElement>("tbody tr")[1]!.click());
    expect(props.onOpen).toHaveBeenCalledWith("p2");
  });

  it("opens the person panel from the name", () => {
    const props = renderTable();
    act(() => buttonByText("Ada")!.click());
    expect(props.onOpen).toHaveBeenCalledWith("p1");
  });

  it("shows the platforms, the stage, the score and at most two tags with a +N overflow", () => {
    renderTable();
    const [adaRow, graceRow] = Array.from(document.querySelectorAll("tbody tr"));
    expect(adaRow!.querySelector('[aria-label="X"]')).not.toBeNull();
    expect(adaRow!.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("87");
    expect(adaRow!.textContent).toContain("New");
    expect(adaRow!.textContent).toContain("87");
    expect(adaRow!.textContent).toContain("vip");

    expect(graceRow!.textContent).toContain("No account");
    expect(graceRow!.textContent).toContain("–");
    expect(graceRow!.textContent).toContain("alpha");
    expect(graceRow!.textContent).toContain("bravo");
    expect(graceRow!.textContent).not.toContain("charlie");
    expect(graceRow!.textContent).toContain("+3");
  });

  it("offers Load more only while the Host has another page", () => {
    const withMore = renderTable({ hasMore: true });
    act(() => buttonByText("Load more people")!.click());
    expect(withMore.onLoadMore).toHaveBeenCalledTimes(1);

    renderTable({ hasMore: false });
    expect(buttonByText("Load more people")).toBeUndefined();
  });
});
