import { beforeEach, expect, it, vi } from "vitest";
import "../../app/model/fileUiAdapters";
import {
  isFileChangedError,
  readTextFileVersioned,
  setRemoteCommandRunner,
  writeTextFileChecked,
} from "./fs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../shared/i18n/core", () => ({ t: (text: string) => text }));

const MIB = 1024 * 1024;
const PATH = "remote://machine/project/big.txt";
const OLD_SAVE_REFUSAL =
  "File is too large to save (maximum 1 MB). Update bycoda Host in Machines settings to save larger files.";

/** A Host reachable only through messages of at most 1 MiB, like the remote transport. */
function fakeHost({ modern = true }: { modern?: boolean } = {}) {
  const host = {
    bytes: Buffer.alloc(0),
    revision: 1,
    calls: [] as string[],
    staged: undefined as Buffer | undefined,
    onChunk: undefined as undefined | ((index: number) => void),
    onCommit: undefined as undefined | (() => void),
    chunkReads: 0,
    get version() {
      return `v${host.revision}:${host.bytes.length}`;
    },
    set(text: string | Buffer) {
      host.bytes = Buffer.from(text);
      host.revision++;
    },
  };
  setRemoteCommandRunner(async (command, args) => {
    host.calls.push(command);
    if (JSON.stringify(args).length > MIB) throw new Error("Message exceeds the 1 MiB cap");
    switch (command) {
      case "read_text_file":
        if (host.bytes.length > MIB) throw new Error("File is too large to edit (maximum 1 MB).");
        return { text: host.bytes.toString("utf8"), version: host.version };
      case "read_file_info":
        return {
          size: host.bytes.length,
          version: host.version,
          ...(modern ? { textEditLimit: 8 * MIB } : {}),
        };
      case "read_file_chunk": {
        host.onChunk?.(host.chunkReads++);
        if (args.version !== host.version)
          throw new Error("The file changed while downloading. Try again.");
        const offset = args.offset as number;
        const data = host.bytes.subarray(offset, offset + (args.length as number));
        return { data: data.toString("base64"), offset, length: data.length };
      }
      case "write_text_file":
        if (args.baseVersion && args.baseVersion !== host.version)
          throw new Error("FILE_CHANGED: The file changed on disk after it was opened.");
        host.set(args.content as string);
        return { version: host.version };
      case "write_file_begin":
        if (!modern) throw new Error(OLD_SAVE_REFUSAL);
        if (args.baseVersion && args.baseVersion !== host.version)
          throw new Error("FILE_CHANGED: The file changed on disk after it was opened.");
        host.staged = Buffer.alloc(0);
        return { uploadId: "u1", chunkBytes: 512 * 1024 };
      case "write_file_chunk":
        if ((args.data as string).length > MIB) throw new Error("chunk too large");
        host.onChunk?.(host.chunkReads++);
        host.staged = Buffer.concat([host.staged!, Buffer.from(args.data as string, "base64")]);
        return { received: host.staged.length };
      case "write_file_commit":
        host.onCommit?.();
        host.set(host.staged!);
        return { version: host.version };
      case "write_file_abort":
        host.staged = undefined;
        return { aborted: true };
      default:
        throw new Error(`unexpected ${command}`);
    }
  });
  return host;
}

/** Three-byte characters so chunk edges fall inside a character. */
const multibyte = (total: number) => {
  const count = Math.floor((total - 2) / 3);
  return Buffer.from(`a${"漢".repeat(count)}${"b".repeat(total - 1 - count * 3)}`);
};

beforeEach(() => setRemoteCommandRunner(async () => undefined));

it.each([2 * MIB, 8 * MIB])(
  "reads %i bytes of remote text in chunks, pinned to one version",
  async (size) => {
    const host = fakeHost();
    host.set(multibyte(size));
    const version = host.version;
    const read = await readTextFileVersioned(PATH);
    expect(Buffer.from(read.text).equals(host.bytes)).toBe(true);
    expect(read.version).toBe(version);
    expect(host.calls.filter((call) => call === "read_file_chunk").length).toBe(
      size / (512 * 1024),
    );
  },
);

it("refuses text over 8 MB with the editor's too-large message", async () => {
  const host = fakeHost();
  host.set(Buffer.alloc(8 * MIB + 1, 97));
  await expect(readTextFileVersioned(PATH)).rejects.toThrow(
    "File is too large to edit (maximum 8 MB).",
  );
  expect(host.calls).not.toContain("read_file_chunk");
});

it("keeps an older Host's 1 MB read limit and message", async () => {
  const host = fakeHost({ modern: false });
  host.set(Buffer.alloc(2 * MIB, 97));
  await expect(readTextFileVersioned(PATH)).rejects.toThrow(
    "File is too large to edit (maximum 1 MB).",
  );
  expect(host.calls).not.toContain("read_file_chunk");
});

it("rejects binary and invalid UTF-8 large files like a small one", async () => {
  const host = fakeHost();
  host.set(Buffer.concat([Buffer.alloc(2 * MIB, 97), Buffer.from([0])]));
  await expect(readTextFileVersioned(PATH)).rejects.toThrow("Binary files cannot be edited.");
  // A character cut by the end of the file is invalid, not silently replaced.
  host.set(Buffer.concat([Buffer.alloc(2 * MIB, 97), Buffer.from([0xe6, 0xbc])]));
  await expect(readTextFileVersioned(PATH)).rejects.toThrow("File is not valid UTF-8.");
});

it("aborts with FILE_CHANGED when the file changes while it is being read", async () => {
  const host = fakeHost();
  host.set(multibyte(2 * MIB));
  host.onChunk = (index) => {
    if (index === 1) host.set("changed under the reader");
  };
  const failure = await readTextFileVersioned(PATH).catch((error: unknown) => error);
  expect(isFileChangedError(failure)).toBe(true);
});

it("saves large text as a staged upload and keeps small text on one call", async () => {
  const host = fakeHost();
  host.set("original");
  const content = multibyte(2 * MIB).toString("utf8");
  const saved = await writeTextFileChecked(PATH, content, host.version);
  expect(host.calls).not.toContain("write_text_file");
  expect(host.calls.filter((call) => call === "write_file_chunk").length).toBe(4);
  expect(host.bytes.equals(Buffer.from(content))).toBe(true);
  expect(saved.version).toBe(host.version);

  host.calls.length = 0;
  await writeTextFileChecked(PATH, "small", saved.version);
  expect(host.calls).toEqual(["write_text_file"]);
});

it("uploads exactly 8 MiB and refuses one byte more before contacting the Host", async () => {
  const host = fakeHost();
  host.set("original");
  const exact = multibyte(8 * MIB).toString("utf8");
  await writeTextFileChecked(PATH, exact, host.version);
  expect(host.bytes.length).toBe(8 * MIB);
  host.calls.length = 0;
  await expect(writeTextFileChecked(PATH, `${exact}x`, host.version)).rejects.toThrow(
    "File is too large to save (maximum 8 MB).",
  );
  expect(host.calls).toEqual([]);
});

it("treats heavily escaped text as large even when its bytes are under 1 MiB", async () => {
  const host = fakeHost();
  host.set("original");
  // Control characters become six-byte escapes in the JSON message.
  await writeTextFileChecked(PATH, "\u0001".repeat(300 * 1024), host.version);
  expect(host.calls).not.toContain("write_text_file");
  expect(host.bytes.length).toBe(300 * 1024);
});

it("keeps the original and aborts the upload when a transfer is interrupted", async () => {
  const host = fakeHost();
  host.set("original");
  host.onChunk = (index) => {
    if (index === 2) throw new Error("Host rejected the chunk");
  };
  await expect(
    writeTextFileChecked(PATH, multibyte(2 * MIB).toString("utf8"), host.version),
  ).rejects.toThrow("Host rejected the chunk");
  expect(host.bytes.toString()).toBe("original");
  expect(host.calls).toContain("write_file_abort");
  expect(host.staged).toBeUndefined();
});

it("surfaces FILE_CHANGED from begin and from commit so the conflict view opens", async () => {
  const host = fakeHost();
  host.set("original");
  const content = multibyte(2 * MIB).toString("utf8");
  const stale = host.version;
  host.set("edited elsewhere");
  const atBegin = await writeTextFileChecked(PATH, content, stale).catch((error: unknown) => error);
  expect(isFileChangedError(atBegin)).toBe(true);
  expect(host.bytes.toString()).toBe("edited elsewhere");

  host.onCommit = () => {
    throw new Error("FILE_CHANGED: The file changed on disk after it was opened.");
  };
  const atCommit = await writeTextFileChecked(PATH, content, host.version).catch(
    (error: unknown) => error,
  );
  expect(isFileChangedError(atCommit)).toBe(true);
  expect(host.bytes.toString()).toBe("edited elsewhere");
  expect(host.calls.at(-1)).toBe("write_file_abort");
});

it("keeps an older Host's 1 MB save limit and message", async () => {
  const host = fakeHost({ modern: false });
  host.set("original");
  await expect(
    writeTextFileChecked(PATH, multibyte(2 * MIB).toString("utf8"), host.version),
  ).rejects.toThrow("File is too large to save (maximum 1 MB).");
  expect(host.bytes.toString()).toBe("original");
  // A save that fits one message still works on the older Host.
  await writeTextFileChecked(PATH, "small", host.version);
  expect(host.bytes.toString()).toBe("small");
});
