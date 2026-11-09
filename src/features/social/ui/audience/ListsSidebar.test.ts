// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialList } from "../../model/audience";
import { ListsSidebar, type ListsSidebarProps } from "./ListsSidebar";
import {
  SEGMENT_LIST,
  STATIC_LIST,
  buttonByText,
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

  it("offers the two creation actions", () => {
    const props = renderSidebar();
    act(() => buttonByText("New list")!.click());
    act(() => buttonByText("New segment")!.click());
    expect(props.onNewList).toHaveBeenCalledTimes(1);
    expect(props.onNewSegment).toHaveBeenCalledTimes(1);
  });
});
