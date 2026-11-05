import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("./platform", () => ({ IS_MAC: true }));
import { resolveFileEntrySpelling } from "./fileEntry";

beforeEach(() => {
  vi.clearAllMocks();
  native.isTauri.mockReturnValue(true);
});

it("uses the native proven directory spelling rather than normalizing a path string", async () => {
  native.invoke.mockResolvedValue("/workspace/cafe\u0301.txt");
  expect(await resolveFileEntrySpelling("/workspace/caf\u00e9.txt")).toBe(
    "/workspace/cafe\u0301.txt",
  );
  expect(native.invoke).toHaveBeenCalledWith("resolve_file_entry_spelling", {
    path: "/workspace/caf\u00e9.txt",
  });
});

it("keeps remote and fixture identities out of the local filesystem route", async () => {
  const remote = "remote://owner/workspace/caf\u00e9.txt";
  expect(await resolveFileEntrySpelling(remote)).toBe(remote);
  native.isTauri.mockReturnValue(false);
  expect(await resolveFileEntrySpelling("/workspace/caf\u00e9.txt")).toBe(
    "/workspace/caf\u00e9.txt",
  );
  expect(native.invoke).not.toHaveBeenCalled();
});

it("propagates an identity race instead of opening a guessed alias", async () => {
  native.invoke.mockRejectedValue(new Error("File identity changed"));
  await expect(resolveFileEntrySpelling("/workspace/caf\u00e9.txt")).rejects.toThrow(
    "File identity changed",
  );
});
