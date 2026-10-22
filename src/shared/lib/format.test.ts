import { beforeEach, expect, it, vi } from "vitest";
import { formatProjectText } from "./format";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../../platform/tauri/fs", () => ({
  invokeWorkspace: invoke,
  basename: (path: string) => path.split(/[\\/]/).pop()!,
}));
beforeEach(() => { invoke.mockReset(); });
it("sends the unsaved buffer to the owning workspace and normalizes CRLF cursor positions", async () => {
  invoke.mockResolvedValue({ formatted: "a\r\nb\r\n", cursorOffset: 4 });
  expect(await formatProjectText("remote://machine/repo/Page.tsx", "original", 2)).toEqual({
    formatted: "a\nb\n",
    cursorOffset: 3,
  });
  expect(invoke).toHaveBeenCalledWith("format_text_file", {
    path: "remote://machine/repo/Page.tsx",
    source: "original",
    cursorOffset: 2,
  });
});
it("uses bundled Prettier when the project has no installed formatter", async () => {
  invoke.mockResolvedValue(null);
  expect((await formatProjectText("/repo/Page.tsx", "const Page=()=> <div/>;", 0))?.formatted).toBe(
    "const Page = () => <div />;\n",
  );
});
it("preserves project formatter failures instead of replacing their configuration with defaults", async () => {
  invoke.mockRejectedValue(new Error("Invalid project config"));
  await expect(formatProjectText("/repo/Page.tsx", "const a=1", 0)).rejects.toThrow(
    "Invalid project config",
  );
});
