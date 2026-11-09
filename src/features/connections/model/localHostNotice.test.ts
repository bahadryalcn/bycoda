import { expect, it } from "vitest";
import { localHostNotice } from "./localHostNotice";

const BUSY = "Could not check whether the host is busy.";
const deferred = (installed: string | null, bundled: string | null, message = BUSY) => ({
  state: "deferred",
  installed,
  bundled,
  message,
});

it("says nothing when the equal-version deferred host was verified or is still being checked", () => {
  expect(localHostNotice(deferred("0.7.7", "0.7.7"), "ok")).toBeNull();
  expect(localHostNotice(deferred("0.7.7", "0.7.7"), "pending")).toBeNull();
});

it("says the host could not be verified when versions match but no descriptor answered", () => {
  expect(localHostNotice(deferred("0.7.7", "0.7.7"), "unavailable")).toEqual({
    tone: "info",
    title: "This computer's host could not be verified.",
    details: [{ text: "It continues when the host can be restarted safely." }],
  });
});

it("reports a waiting update with both versions and the mapped reason", () => {
  expect(localHostNotice(deferred("0.5.53", "0.5.54"), "ok")).toEqual({
    tone: "info",
    title: "A host update is waiting.",
    details: [
      {
        text: "This computer's host is {p0}; this app includes {p1}.",
        params: { p0: "0.5.53", p1: "0.5.54" },
      },
      { text: "It continues when the host can be restarted safely." },
    ],
  });
  const unknown = localHostNotice(deferred(null, "0.5.54", "Another host update is being installed."), "ok");
  expect(unknown?.title).toBe("A host update is waiting.");
  expect(unknown?.details).toEqual([{ text: "Another host update is being installed." }]);
});

it("warns when the update failed and shows versions only when they differ", () => {
  const failed = { state: "failed", installed: "1", bundled: "2", message: "Disk full" };
  expect(localHostNotice(failed, "ok")).toMatchObject({
    tone: "warning",
    title: "The host on this computer could not be updated.",
    details: [{ params: { p0: "1", p1: "2" } }, { text: "Disk full" }],
  });
  expect(localHostNotice({ ...failed, installed: "2" }, "ok")?.details).toEqual([
    { text: "Disk full" },
  ]);
});

it("keeps the mismatch warnings ahead of update state", () => {
  expect(localHostNotice(deferred("1", "1"), "capabilities")?.details[0]?.text).toContain(
    "does not support managed workspace",
  );
  expect(localHostNotice(null, "identity")?.details[0]?.text).toBe(
    "The serving Host source differs from the Host bundled with this app.",
  );
});

it("is silent for settled states", () => {
  expect(localHostNotice(null, "pending")).toBeNull();
  expect(localHostNotice({ state: "current" }, "ok")).toBeNull();
});
