// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
import { startBykitHostSync } from "./bykitHostSync";
import { toolPreferences } from "./toolPreferences";

let stop: (() => void) | undefined;
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
const sent = () => mocks.request.mock.calls.map((call) => call[2].bykitInstructions);

beforeEach(() => {
  localStorage.clear();
  mocks.request.mockReset().mockResolvedValue({});
  mocks.invoke.mockReset().mockResolvedValue({ id: "local" });
});
afterEach(() => {
  stop?.();
  stop = undefined;
});

it("publishes the switch on start and after each change, without repeating a sent value", async () => {
  stop = startBykitHostSync();
  await flush();
  toolPreferences.bykitInstructions.save(false);
  await flush();
  toolPreferences.bykitInstructions.save(false);
  await flush();
  expect(sent()).toEqual([true, false]);
  expect(mocks.request.mock.calls[0]?.[1]).toBe("host.settings.save");
});

it("retries a failed publish on the next change", async () => {
  mocks.request.mockRejectedValueOnce(new Error("offline"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stop = startBykitHostSync();
  await flush();
  toolPreferences.bykitInstructions.save(false);
  await flush();
  expect(sent()).toEqual([true, false]);
});
