import { expect, it } from "vitest";
import {
  CONFIGURED_OBS,
  destinationTone,
  groupAccounts,
  hasVerticalAccount,
  selectedAccounts,
  toggleSelection,
} from "./liveDestinations";

const account = (platform: "youtube" | "tiktok" | "x" | "instagram") => ({
  accountId: platform,
  platform,
  label: platform,
});

it("groups accounts by canvas keeping order", () => {
  const groups = groupAccounts([
    account("tiktok"),
    account("youtube"),
    account("instagram"),
    account("x"),
  ]);
  expect(groups.horizontal.map((entry) => entry.accountId)).toEqual(["youtube", "x"]);
  expect(groups.vertical.map((entry) => entry.accountId)).toEqual(["tiktok", "instagram"]);
});

it("toggles accounts and keeps the configured OBS server exclusive", () => {
  let selected = toggleSelection([], "a");
  selected = toggleSelection(selected, "b");
  expect(selected).toEqual(["a", "b"]);
  expect(toggleSelection(selected, "a")).toEqual(["b"]);
  expect(toggleSelection(selected, CONFIGURED_OBS)).toEqual([CONFIGURED_OBS]);
  expect(toggleSelection([CONFIGURED_OBS], "a")).toEqual(["a"]);
  expect(toggleSelection([CONFIGURED_OBS], CONFIGURED_OBS)).toEqual([]);
});

it("stops adding accounts at the Host limit", () => {
  const full = ["1", "2", "3", "4", "5", "6"];
  expect(toggleSelection(full, "7")).toEqual(full);
  expect(toggleSelection(full, "6")).toEqual(["1", "2", "3", "4", "5"]);
});

it("resolves selected accounts in list order and detects the vertical canvas", () => {
  const list = [account("youtube"), account("tiktok")];
  const picked = selectedAccounts(["tiktok", "gone", "youtube"], list);
  expect(picked.map((entry) => entry.accountId)).toEqual(["youtube", "tiktok"]);
  expect(hasVerticalAccount(picked)).toBe(true);
  expect(hasVerticalAccount([list[0]!])).toBe(false);
});

it("maps destination states to status tones", () => {
  expect(destinationTone("starting")).toBe("running");
  expect(destinationTone("streaming")).toBe("done");
  expect(destinationTone("failed")).toBe("failed");
  expect(destinationTone("ended")).toBe("idle");
});
