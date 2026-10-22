// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { projectKey } from "../../../shared/lib/paths";
import {
  loadRailBackgrounds,
  saveRailBackgrounds,
  rebaseProjectTabGroupSettings,
  clearTabGroupSettings,
} from "./tabGroups";

beforeEach(() => localStorage.clear());

it("retains separate header and expanded colors across reads and folder moves", () => {
  const from = projectKey("/work/old");
  const to = projectKey("/work/new");
  const colors = {
    header: { color: "#a855f7", opacity: 24 },
    body: { color: "#22c55e", opacity: 10 },
  };
  saveRailBackgrounds(from, colors);
  saveRailBackgrounds("group-1", { body: colors.body });
  rebaseProjectTabGroupSettings("/work/old", "/work/new");
  expect(loadRailBackgrounds(from)).toEqual({});
  expect(loadRailBackgrounds(to)).toEqual(colors);
  expect(loadRailBackgrounds("group-1")).toEqual({ body: colors.body });
  clearTabGroupSettings(to);
  expect(loadRailBackgrounds(to)).toEqual({});
});

it("ignores malformed colors and clamps opacity from persisted data", () => {
  localStorage.setItem(
    "bycoda:tab-group:rail-backgrounds",
    JSON.stringify({
      "group-1": JSON.stringify({
        header: { color: "url(untrusted)", opacity: 20 },
        body: { color: "#123456", opacity: 400 },
      }),
    }),
  );
  expect(loadRailBackgrounds("group-1")).toEqual({ body: { color: "#123456", opacity: 100 } });
});
