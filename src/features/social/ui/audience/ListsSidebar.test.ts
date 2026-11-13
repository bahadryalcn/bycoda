// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialList } from "../../model/audience";
import { ListsSidebar, type ListsSidebarProps } from "./ListsSidebar";
import {
  SEGMENT_LIST,
  STATIC_LIST,
  bodyText,
  buttonByText,
  clickMenuItem,
  menuItem,
  mountHost,
  type MountedHost,
} from "./audienceTestKit";

let host: MountedHost;

beforeEach(() => {
  host = mountHost();
});

afterEach(() => {
  host.unmount();
});

const commenters = {
  id: "lc",
  name: "Commenters",
  kind: "static",
  projectIds: [],
  system: "commenters",
  createdAt: 1,
} as SocialList;

function renderSidebar(overrides: Partial<ListsSidebarProps> = {}) {
  const props: ListsSidebarProps = {
    lists: [STATIC_LIST, commenters, SEGMENT_LIST],
    selectedId: null,
    onSelect: vi.fn(),
    onNewList: vi.fn(),
    onNewSegment: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  host.render(createElement(ListsSidebar, props));
  return props;
}

describe("ListsSidebar", () => {
  it("groups static lists and segments under their own headings", () => {
    renderSidebar();
    const headings = Array.from(document.querySelectorAll("h3")).map((item) => item.textContent);
    expect(headings).toEqual(["Lists", "Segments"]);
    const [listsGroup, segmentsGroup] = Array.from(document.querySelectorAll("ul")).slice(1);
    expect(listsGroup!.textContent).toContain("Buyers");
    expect(listsGroup!.textContent).toContain("Commenters");
    expect(listsGroup!.textContent).not.toContain("Turkish");
    expect(segmentsGroup!.textContent).toContain("Turkish");
    expect(segmentsGroup!.textContent).not.toContain("Commenters");
  });

  it("shows the system Commenters list under Lists with its translated name, not the stored one", () => {
    renderSidebar({ lists: [{ ...commenters, name: "stored-name" }, SEGMENT_LIST] });
    const listsGroup = Array.from(document.querySelectorAll("ul")).slice(1)[0];
    expect(listsGroup!.textContent).toContain("Commenters");
    expect(listsGroup!.textContent).not.toContain("stored-name");
  });

  it("marks the open list as current and selects a list or everyone on click", () => {
    const props = renderSidebar({ selectedId: "l1" });
    expect(buttonByText("Buyers")?.getAttribute("aria-current")).toBe("true");
    expect(buttonByText("All people")?.getAttribute("aria-current")).toBeNull();

    act(() => buttonByText("Turkish")!.click());
    expect(props.onSelect).toHaveBeenCalledWith("s1");
    act(() => buttonByText("All people")!.click());
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it("marks All people as current when no list is open", () => {
    renderSidebar({ selectedId: null });
    expect(buttonByText("All people")?.getAttribute("aria-current")).toBe("true");
  });

  it("labels the ready-made commenters list as automatic", () => {
    renderSidebar();
    const buttons = Array.from(document.querySelectorAll("button"));
    const commentersButton = buttons.find((item) => item.textContent?.includes("Commenters"));
    expect(commentersButton?.textContent).toContain("Automatic");
    expect(buttonByText("Buyers")?.textContent).not.toContain("Automatic");
  });

  it("offers the two creation actions as named icon buttons in their section headings", () => {
    const props = renderSidebar();
    const create = (name: string) =>
      document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    act(() => create("New list")!.click());
    act(() => create("New segment")!.click());
    expect(props.onNewList).toHaveBeenCalledTimes(1);
    expect(props.onNewSegment).toHaveBeenCalledTimes(1);
  });

  it("says when there are no lists or segments yet instead of leaving the groups blank", () => {
    renderSidebar({ lists: [] });
    expect(bodyText()).toContain("No lists yet.");
    expect(bodyText()).toContain("No segments yet.");
  });
});

function openMenu(name: string) {
  const trigger = document.querySelector<HTMLButtonElement>(
    `button[aria-label="Actions for ${name}"]`,
  );
  if (!trigger) throw new Error(`No actions menu for ${name}`);
  act(() => trigger.click());
}

describe("ListsSidebar row actions", () => {
  it("renames or deletes a custom list from its own menu", () => {
    const props = renderSidebar();
    openMenu("Buyers");
    clickMenuItem("Rename list…");
    expect(props.onEdit).toHaveBeenCalledWith(STATIC_LIST);

    openMenu("Buyers");
    clickMenuItem("Delete…");
    expect(props.onDelete).toHaveBeenCalledWith(STATIC_LIST);
  });

  it("edits the conditions of a segment from its menu", () => {
    const props = renderSidebar();
    openMenu("Turkish");
    expect(menuItem("Rename list…")).toBeUndefined();
    clickMenuItem("Edit segment…");
    expect(props.onEdit).toHaveBeenCalledWith(SEGMENT_LIST);
  });

  it("protects the system Commenters list and says why in the menu", () => {
    const props = renderSidebar();
    openMenu("Commenters");
    expect(menuItem("Rename list…")).toBeUndefined();
    expect(menuItem("Delete…")).toBeUndefined();
    expect(bodyText()).toContain("The Commenters rule fills this list");
    act(() => menuItem("Automatic list")!.click());
    expect(props.onEdit).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });
});
