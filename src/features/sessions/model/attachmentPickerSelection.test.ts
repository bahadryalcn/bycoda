// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { pickAttachments, retainAttachmentPickerSelection } from "./attachments";

const native = vi.hoisted(() => ({ invoke: vi.fn(), choose: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.choose }));

beforeEach(() => {
  native.choose.mockReset();
  native.invoke
    .mockReset()
    .mockImplementation(async (_command, { paths }) =>
      paths.map((path: string) => ({ path, name: "selected.txt", size: 4, isDir: false })),
    );
});

it("keeps successful chooser selection immutable when downstream inspection fails", async () => {
  const token = retainAttachmentPickerSelection();
  expect(native.choose).not.toHaveBeenCalled();
  const chosen = ["/fixture/selected.txt"];
  native.choose.mockResolvedValue(chosen);
  native.invoke.mockRejectedValueOnce(new Error("inspection unavailable"));
  await expect(pickAttachments(token)).rejects.toThrow("inspection unavailable");
  chosen[0] = "/fixture/different.txt";
  expect(await pickAttachments(token)).toMatchObject([{ path: "/fixture/selected.txt" }]);
  expect(native.choose).toHaveBeenCalledOnce();
  expect(native.invoke).toHaveBeenNthCalledWith(2, "inspect_paths", {
    paths: ["/fixture/selected.txt"],
  });
});

it("joins a held chooser while retaining the actual selected paths for each inspection", async () => {
  let resolve!: (value: string[]) => void;
  native.choose.mockReturnValue(
    new Promise<string[]>((done) => {
      resolve = done;
    }),
  );
  const token = retainAttachmentPickerSelection();
  const first = pickAttachments(token);
  const second = pickAttachments(token);
  expect(native.choose).toHaveBeenCalledOnce();
  resolve(["/fixture/selected.txt"]);
  expect(await first).toMatchObject([{ path: "/fixture/selected.txt" }]);
  expect(await second).toMatchObject([{ path: "/fixture/selected.txt" }]);
});

it("retains a successful cancellation without reopening a chooser on retry", async () => {
  native.choose.mockResolvedValue(null);
  const token = retainAttachmentPickerSelection();
  expect(await pickAttachments(token)).toEqual([]);
  expect(await pickAttachments(token)).toEqual([]);
  expect(native.choose).toHaveBeenCalledOnce();
  expect(native.invoke).not.toHaveBeenCalled();
});

it("an explicit retry can start a chooser that never returned any successful selection", async () => {
  native.choose.mockRejectedValueOnce(new Error("dialog unavailable"));
  const token = retainAttachmentPickerSelection();
  await expect(pickAttachments(token)).rejects.toThrow("dialog unavailable");
  native.choose.mockResolvedValue(["/fixture/selected.txt"]);
  expect(await pickAttachments(token)).toHaveLength(1);
  expect(native.choose).toHaveBeenCalledTimes(2);
});

it.each([
  { paths: Array.from({ length: 4097 }, () => "/fixture/file") },
  { paths: ["x".repeat(524289)] },
])(
  "rejects an over-capacity selection without truncating or reopening its chooser",
  async ({ paths }) => {
    native.choose.mockResolvedValue(paths);
    const token = retainAttachmentPickerSelection();
    await expect(pickAttachments(token)).rejects.toThrow("retained attachment capacity");
    await expect(pickAttachments(token)).rejects.toThrow("retained attachment capacity");
    expect(native.choose).toHaveBeenCalledOnce();
    expect(native.invoke).not.toHaveBeenCalled();
  },
);

it("ordinary independent no-argument picks still open independent choosers", async () => {
  native.choose.mockResolvedValue(["/fixture/selected.txt"]);
  expect(await pickAttachments()).toHaveLength(1);
  expect(await pickAttachments()).toHaveLength(1);
  expect(native.choose).toHaveBeenCalledTimes(2);
});
