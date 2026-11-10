// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPEN_CREWS_PAGE_EVENT,
  consumeCrewsPageRequest,
  crewsPageOpen,
  openCrewsPageAt,
  pendingCrewsPageRequest,
  requestOpenCrewsPage,
  setCrewsPageOpen,
} from "./crewsPage";

afterEach(() => setCrewsPageOpen(false));

describe("crews page state", () => {
  it("opens and closes", () => {
    setCrewsPageOpen(true);
    expect(crewsPageOpen()).toBe(true);
    setCrewsPageOpen(false);
    expect(crewsPageOpen()).toBe(false);
  });

  it("requests the page through one window event", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_CREWS_PAGE_EVENT, listener);
    requestOpenCrewsPage();
    window.removeEventListener(OPEN_CREWS_PAGE_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("crews page landing request", () => {
  it("keeps the target until the page consumes it", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_CREWS_PAGE_EVENT, listener);
    openCrewsPageAt({ tab: "work", definitionId: "d", runId: "r" });
    window.removeEventListener(OPEN_CREWS_PAGE_EVENT, listener);
    const pending = pendingCrewsPageRequest();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pending).toMatchObject({ tab: "work", definitionId: "d", runId: "r" });
    consumeCrewsPageRequest(pending!);
    expect(pendingCrewsPageRequest()).toBeNull();
  });

  it("does not drop a newer request when an older one is consumed", () => {
    openCrewsPageAt({ tab: "active" });
    const first = pendingCrewsPageRequest()!;
    openCrewsPageAt({ tab: "teams" });
    consumeCrewsPageRequest(first);
    expect(pendingCrewsPageRequest()?.tab).toBe("teams");
    consumeCrewsPageRequest(pendingCrewsPageRequest()!);
  });

  it("opens without a target through the plain request", () => {
    requestOpenCrewsPage();
    expect(pendingCrewsPageRequest()).toBeNull();
  });
});
