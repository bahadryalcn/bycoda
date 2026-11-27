// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { decodeBase64 } from "../../shared/lib/base64";
import { copyMessage, messageFilesFromClipboard } from "./clipboard";
import { readBinaryFile, setRemoteCommandRunner } from "./fs";

vi.mock("../../shared/lib/base64", { spy: true });

afterEach(() => vi.restoreAllMocks());

it("decodes remote binary replies through the shared fast decoder", async () => {
  const remote = vi.fn().mockResolvedValue("+/8=");
  setRemoteCommandRunner(remote);

  await expect(readBinaryFile("remote://mac/work/image.png")).resolves.toEqual(
    Uint8Array.of(251, 255),
  );
  expect(remote).toHaveBeenCalledWith("read_binary_file", expect.anything());
  expect(decodeBase64).toHaveBeenCalledWith("+/8=");
});

it("uses the shared fast decoder both for the copied PNG and for pasted attachment bytes", async () => {
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  await copyMessage("[Image 1 · 2 B]", [
    { id: "image", name: "image.png", mimeType: "image/png", kind: "image", size: 2, data: "+/8=" },
  ]);
  const [item] = write.mock.calls[0][0];
  expect(decodeBase64).toHaveBeenCalledWith("+/8=");
  expect(new Uint8Array(await (await item.getType("image/png")).arrayBuffer())).toEqual(
    Uint8Array.of(251, 255),
  );

  vi.mocked(decodeBase64).mockClear();
  const html = await (await item.getType("text/html")).text();
  const files = messageFilesFromClipboard({
    getData: (type) => (type === "text/html" ? html : ""),
  });
  expect(decodeBase64).toHaveBeenCalledWith("+/8=");
  expect(new Uint8Array(await files![0].arrayBuffer())).toEqual(Uint8Array.of(251, 255));
});
