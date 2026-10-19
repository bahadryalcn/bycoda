import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createHash } from "node:crypto";
import { uploadRemoteAttachments } from "./remoteAttachments";
import { hashBase64Prefix } from "./attachmentPrefix";
import { ATTACHMENT_CHUNK_BYTES } from "./attachmentData";
import { AttachmentOwnership } from "./attachmentOwnership";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./attachmentPrefix", () => ({ hashBase64Prefix: vi.fn() }));
afterEach(() => vi.clearAllMocks());

it("claims managed uploads before bytes and includes the generation on resume and upload", async () => {
  const events: string[] = [];
  const values = new Map<string, string>();
  const ownership = new AttachmentOwnership(
    "managed-owner",
    "managed",
    async (method) => {
      events.push(method);
    },
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  );
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method, params } = input as { method: string; params: Record<string, unknown> };
    events.push(method);
    expect(params).toMatchObject({
      ownerId: ownership.ownerId,
      claimId: ownership.claimId("managed"),
    });
    return { offset: method === "attachments.status" ? 0 : 1 };
  });
  await uploadRemoteAttachments(
    "managed-host",
    [{ id: "managed", name: "a", mimeType: "text/plain", kind: "file", size: 1, data: "eA==" }],
    { resumable: true, ownership, ownershipSource: "submit:turn" },
  );
  expect(events).toEqual(["attachments.claim", "attachments.status", "attachments.upload"]);
});

it("claims host-owned attachment reuse without reading bytes and retains it until handoff", async () => {
  const values = new Map<string, string>();
  const request = vi.fn(async () => {});
  const ownership = new AttachmentOwnership("managed-owner", "reuse", request, {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  });
  await uploadRemoteAttachments(
    "managed-host",
    [
      {
        id: "reuse",
        name: "a",
        mimeType: "text/plain",
        kind: "file",
        size: 1,
        hostEnvironmentId: "host",
        path: "/foreign/path",
      },
    ],
    { environmentId: "host", ownership, ownershipSource: "submit:turn" },
  );
  expect(request).toHaveBeenCalledWith(
    "attachments.claim",
    expect.objectContaining({ ids: ["reuse"] }),
  );
  expect(invoke).not.toHaveBeenCalled();
  ownership.finishJob("submit:turn");
  await ownership.replaceDurable("submit:turn", []);
  expect(request).toHaveBeenLastCalledWith(
    "attachments.release",
    expect.objectContaining({ ids: ["reuse"] }),
  );
});

it("reuses a shared queue attachment on its owning host without reading a foreign path", async () => {
  const file = {
    id: "shared",
    name: "queued.txt",
    mimeType: "text/plain",
    kind: "file" as const,
    size: 3,
    path: "/host/attachments/shared",
    hostEnvironmentId: "host",
  };
  expect(await uploadRemoteAttachments("machine", [file], { environmentId: "host" })).toEqual([
    { id: file.id, name: file.name, mimeType: file.mimeType, kind: file.kind, size: file.size },
  ]);
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps browser snapshot metadata with the remote image reference", async () => {
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { params } = input as { params: { offset: number; data: string } };
    return { offset: params.offset + Buffer.from(params.data, "base64").length };
  });
  const browserAnnotation = {
    id: "selection",
    projectId: "p",
    sessionId: "host-session",
    navigationId: "nav",
    capturedAt: "now",
    pageUrl: "https://example.test/",
    viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    devicePixelRatio: 1,
    trust: "untrusted-page-data" as const,
    comment: "Fix padding",
    limitations: [],
    element: {
      tag: "button",
      text: "Save",
      selector: "body > button",
      path: "body > button",
      ancestry: [],
      computedStyle: {},
      bounds: { x: 10, y: 20, width: 50, height: 30 },
      center: { x: 35, y: 35 },
    },
  };
  const refs = await uploadRemoteAttachments("annotation-machine", [
    {
      id: "browser-image",
      name: "browser-element.jpg",
      mimeType: "image/jpeg",
      kind: "image",
      size: 3,
      data: "YWJj",
      browserAnnotation,
    },
  ]);
  expect(refs[0].browserAnnotation).toEqual(browserAnnotation);
  expect(refs[0]).not.toHaveProperty("data");
});

it("uploads local bytes before returning host attachment references", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "read_attachment_chunk")
      return { data: Buffer.from("sample").toString("base64"), offset: 6, size: 6 };
    if (command === "remote_request") {
      const { method, params } = input as {
        method: string;
        params: Record<string, unknown>;
      };
      calls.push({ method, params });
      return { offset: 6 };
    }
    throw new Error(`Unexpected invoke ${command}`);
  });
  const file = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "sample.txt",
    mimeType: "text/plain",
    kind: "file" as const,
    size: 6,
    path: "/laptop/sample.txt",
  };
  const refs = await uploadRemoteAttachments("machine", [file]);
  expect(refs).toEqual([
    {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      kind: file.kind,
      size: 6,
    },
  ]);
  expect(calls).toEqual([
    {
      method: "attachments.upload",
      params: {
        id: file.id,
        offset: 0,
        size: 6,
        data: Buffer.from("sample").toString("base64"),
      },
    },
  ]);
  expect(invoke).not.toHaveBeenCalledWith("read_file_base64", expect.anything());
});

it("retries only the unacknowledged chunk after an interrupted transfer", async () => {
  const size = 600_000;
  const data = Buffer.alloc(size, 7).toString("base64");
  const offsets: number[] = [];
  let failed = false;
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { params } = input as { params: { offset: number; data: string } };
    offsets.push(params.offset);
    if (params.offset > 0 && !failed) {
      failed = true;
      throw new Error("Disconnected");
    }
    return { offset: params.offset + Buffer.from(params.data, "base64").length };
  });
  const file = {
    id: "retry-image",
    name: "large",
    mimeType: "application/octet-stream",
    kind: "file" as const,
    size,
    data,
  };
  await expect(uploadRemoteAttachments("retry-machine", [file])).rejects.toThrow("Disconnected");
  await uploadRemoteAttachments("retry-machine", [file]);
  expect(offsets).toEqual([0, 524286, 524286]);
});

it("keeps two uploads in flight while preserving the attachment order", async () => {
  let active = 0;
  let maximum = 0;
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { params } = input as { params: { offset: number; data: string } };
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 0));
    active--;
    return { offset: params.offset + Buffer.from(params.data, "base64").length };
  });
  const files = Array.from({ length: 4 }, (_, n) => ({
    id: `parallel-${n}`,
    name: String(n),
    mimeType: "text/plain",
    kind: "file" as const,
    size: 3,
    data: "YWJj",
  }));
  const refs = await uploadRemoteAttachments("parallel", files);
  expect(maximum).toBe(2);
  expect(refs.map((file) => file.id)).toEqual(files.map((file) => file.id));
});

it.each([5 * 1024 * 1024, 20 * 1024 * 1024])(
  "resumes a %i byte native file with bounded reads and no renderer prefix decode",
  async (size) => {
    const prefix = 5 * 1024 * 1024 - 1;
    const bytes = Buffer.alloc(size, 17);
    const calls: Array<{ command: string; input: Record<string, unknown> }> = [];
    const progress = vi.fn();
    const atobSpy = vi.spyOn(globalThis, "atob");
    vi.mocked(invoke).mockImplementation(async (command, input) => {
      const params = input as Record<string, unknown>;
      calls.push({ command, input: params });
      if (command === "hash_attachment_prefix") {
        expect(params).toMatchObject({ path: "/files/native", size, offset: prefix });
        return createHash("sha256").update(bytes.subarray(0, prefix)).digest("hex");
      }
      if (command === "read_attachment_chunk") {
        expect(params.length).toBe(ATTACHMENT_CHUNK_BYTES);
        const offset = Number(params.offset);
        const end = Math.min(size, offset + Number(params.length));
        return { data: bytes.subarray(offset, end).toString("base64"), offset: end, size };
      }
      if (command === "remote_request") {
        if (params.method === "attachments.status")
          return {
            offset: prefix,
            hash: createHash("sha256").update(bytes.subarray(0, prefix)).digest("hex"),
          };
        const chunk = params.params as { offset: number; data: string };
        return { offset: chunk.offset + Buffer.from(chunk.data, "base64").length };
      }
      throw new Error(`Unexpected invoke ${command}`);
    });
    try {
      await uploadRemoteAttachments(
        `native-${size}`,
        [
          {
            id: `native-${size}`,
            name: "native",
            mimeType: "application/octet-stream",
            kind: "file",
            size,
            path: "/files/native",
          },
        ],
        { resumable: true, onProgress: progress },
      );
      const reads = calls.filter((call) => call.command === "read_attachment_chunk");
      expect(reads[0].input.offset).toBe(prefix);
      expect(reads).toHaveLength(Math.ceil((size - prefix) / ATTACHMENT_CHUNK_BYTES));
      expect(progress).toHaveBeenLastCalledWith(`native-${size}`, size, size);
      expect(atobSpy).not.toHaveBeenCalled();
      expect(hashBase64Prefix).not.toHaveBeenCalled();
    } finally {
      atobSpy.mockRestore();
    }
  },
);

it("verifies an unaligned in-memory prefix in the worker before sending its tail", async () => {
  vi.mocked(hashBase64Prefix).mockResolvedValue("prefix-hash");
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { method, params } = input as {
      method: string;
      params: { offset: number; data: string };
    };
    if (method === "attachments.status") return { offset: 2, hash: "prefix-hash" };
    expect(Buffer.from(params.data, "base64").toString()).toBe("cdef");
    expect(params.offset).toBe(2);
    return { offset: 6 };
  });
  await uploadRemoteAttachments(
    "memory-resume",
    [
      {
        id: "memory-resume",
        name: "memory",
        mimeType: "text/plain",
        kind: "file",
        size: 6,
        data: Buffer.from("abcdef").toString("base64"),
      },
    ],
    { resumable: true },
  );
  expect(hashBase64Prefix).toHaveBeenCalledWith(Buffer.from("abcdef").toString("base64"), 2);
});

it("rejects a mismatched prefix before reading or uploading any tail", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "hash_attachment_prefix") return "different";
    return { offset: 2, hash: "original" };
  });
  await expect(
    uploadRemoteAttachments(
      "mismatched",
      [
        {
          id: "mismatched",
          name: "file",
          mimeType: "text/plain",
          kind: "file",
          size: 6,
          path: "/file",
        },
      ],
      { resumable: true },
    ),
  ).rejects.toThrow("does not match");
  expect(invoke).not.toHaveBeenCalledWith("read_attachment_chunk", expect.anything());
  expect(invoke).not.toHaveBeenCalledWith(
    "remote_request",
    expect.objectContaining({ method: "attachments.upload" }),
  );
});

it("checks declared size, zero-byte acknowledgements and native read bounds", async () => {
  await expect(
    uploadRemoteAttachments("wrong-size", [
      {
        id: "wrong-size",
        name: "file",
        mimeType: "text/plain",
        kind: "file",
        size: 5,
        data: "YWJj",
      },
    ]),
  ).rejects.toThrow("declared size");
  expect(invoke).not.toHaveBeenCalled();

  vi.mocked(invoke).mockResolvedValue({ offset: 0 });
  const progress = vi.fn();
  await uploadRemoteAttachments(
    "empty",
    [
      {
        id: "empty",
        name: "empty",
        mimeType: "text/plain",
        kind: "file",
        size: 0,
        data: "",
      },
    ],
    { onProgress: progress },
  );
  expect(progress).toHaveBeenCalledWith("empty", 0, 0);

  vi.mocked(invoke).mockResolvedValue({ data: "YWJj", size: 6, offset: 3 });
  await expect(
    uploadRemoteAttachments("bad-read", [
      {
        id: "bad-read",
        name: "file",
        mimeType: "text/plain",
        kind: "file",
        size: 6,
        path: "/file",
      },
    ]),
  ).rejects.toThrow("Invalid attachment read");
});

it.each(["File access is not permitted", "Attachment size changed", "File not found"])(
  "propagates native failure %s without uploading or advancing progress",
  async (message) => {
    vi.mocked(invoke).mockRejectedValue(new Error(message));
    const progress = vi.fn();
    await expect(
      uploadRemoteAttachments(
        message,
        [
          {
            id: message,
            name: "file",
            mimeType: "text/plain",
            kind: "file",
            size: 6,
            path: "/unknown/file",
          },
        ],
        { onProgress: progress },
      ),
    ).rejects.toThrow(message);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("read_attachment_chunk", expect.anything());
    expect(progress).not.toHaveBeenCalled();
  },
);

it("checks native access and size again when an acknowledged file is reused", async () => {
  const file = {
    id: "cached-native",
    name: "cached",
    mimeType: "text/plain",
    kind: "file" as const,
    size: 3,
    path: "/cached/file",
  };
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "read_attachment_chunk" ? { data: "YWJj", size: 3, offset: 3 } : { offset: 3 },
  );
  await uploadRemoteAttachments("cached-native", [file]);
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockRejectedValue(new Error("File access is not permitted"));
  await expect(uploadRemoteAttachments("cached-native", [file])).rejects.toThrow("not permitted");
  expect(invoke).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith(
    "read_attachment_chunk",
    expect.objectContaining({ offset: 3 }),
  );
});
