// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { CrewDefinition } from "./crew";
import { loadCrewAppearances, saveCrewAppearance } from "./crewAppearance";
import {
  keepMigratedLook,
  mergeLook,
  migrationLook,
  outgoingWithLook,
  resolveCrewLook,
  settleLocalLook,
} from "./crewLook";

const crew = (appearance?: CrewDefinition["appearance"]) =>
  ({ id: "c1", name: "Crew", updatedAt: 5, appearance }) as CrewDefinition;

beforeEach(() => localStorage.clear());

it("resolves draft look, then host look, then device look, then the default", () => {
  const local = { c1: { icon: "lab" } };
  expect(resolveCrewLook(crew({ icon: "api" }), local, { icon: "docs" })).toEqual({ icon: "docs" });
  expect(resolveCrewLook(crew({ icon: "api" }), local)).toEqual({ icon: "api" });
  expect(resolveCrewLook(crew(), local)).toEqual({ icon: "lab" });
  expect(resolveCrewLook(crew({}), local)).toEqual({ icon: "lab" });
  expect(resolveCrewLook(crew(), {})).toBeUndefined();
});

it("merges an edit and drops cleared fields", () => {
  expect(mergeLook({ icon: "lab", color: 2 }, { color: undefined })).toEqual({ icon: "lab" });
  expect(mergeLook({ icon: "lab" }, { icon: undefined })).toEqual({});
});

it("migrates a device look only on a supporting host without its own look", () => {
  const local = { c1: { icon: "lab", color: 3 } };
  expect(migrationLook(crew(), local, true)).toEqual({ icon: "lab", color: 3 });
  expect(migrationLook(crew(), local, false)).toBeUndefined();
  expect(migrationLook(crew({ icon: "api" }), local, true)).toBeUndefined();
  expect(migrationLook(crew({}), local, true)).toBeUndefined();
  expect(migrationLook(crew(), {}, true)).toBeUndefined();
});

it("reading and building the outgoing save never writes storage", () => {
  saveCrewAppearance("c1", { icon: "lab" });
  const write = vi.spyOn(Storage.prototype, "setItem");
  loadCrewAppearances();
  resolveCrewLook(crew(), loadCrewAppearances());
  const sent = outgoingWithLook(crew(), loadCrewAppearances(), true);
  expect(sent.appearance).toEqual({ icon: "lab" });
  expect(write).not.toHaveBeenCalled();
  expect(loadCrewAppearances().c1).toEqual({ icon: "lab" });
  write.mockRestore();
});

it("removes the device entry only once the host save succeeded", () => {
  saveCrewAppearance("c1", { icon: "lab" });
  const sent = crew();
  // A failed save never calls settle: the entry stays for the next attempt.
  expect(loadCrewAppearances().c1).toEqual({ icon: "lab" });
  settleLocalLook(sent, { ...crew({ icon: "lab" }), updatedAt: 6 });
  expect(loadCrewAppearances().c1).toBeUndefined();
});

it("keeps an unrelated device entry when the save carried no look", () => {
  saveCrewAppearance("c1", { icon: "lab" });
  settleLocalLook(crew(), crew());
  expect(loadCrewAppearances().c1).toEqual({ icon: "lab" });
});

it("an untouched draft adopts the migrated look; an explicit clear stays cleared", () => {
  const returned = crew({ icon: "lab" });
  expect(keepMigratedLook(crew(), crew(), returned).appearance).toEqual({ icon: "lab" });
  expect(keepMigratedLook(crew({}), crew(), returned).appearance).toEqual({});
});
