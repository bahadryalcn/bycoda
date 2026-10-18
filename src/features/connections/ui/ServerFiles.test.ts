// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const approval = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./useSshHttpProxyApproval", () => ({
  useSshHttpProxyApproval: () => ({ request: approval.request, dialog: null }),
}));
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  listener: undefined as ((event: { payload: unknown }) => void) | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open, save: native.save }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_: string, listener: (event: { payload: unknown }) => void) => {
    native.listener = listener;
    return () => {};
  }),
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children }: { children: ReactNode }) => children,
}));
import { ServerFiles } from "./ServerFiles";
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function setup(
  recoveries?: unknown[],
  endpoint?: import("../model/serverInventory").SshEndpoint,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  if (recoveries) native.invoke.mockResolvedValueOnce(recoveries);
  await act(async () =>
    root.render(
      createElement(ServerFiles, { connectionId: "canonical-server", endpoint, onClose: vi.fn() }),
    ),
  );
  const button = (text: string) =>
    Array.from(host.querySelectorAll("button")).find((element) => element.textContent === text)!;
  const list = async () => {
    native.invoke.mockResolvedValueOnce([
      { name: "folder", kind: "directory" },
      { name: "file.txt", kind: "file" },
      { name: "link", kind: "symlink" },
    ]);
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  };
  return {
    host,
    button,
    list,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("opens only on explicit action and keeps symlinks without download/follow controls", async () => {
  const context = await setup();
  try {
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("ssh_sftp_recoveries", {
      connectionId: "canonical-server",
    });
    expect(native.invoke).not.toHaveBeenCalledWith("ssh_sftp_resume", expect.anything());
    await context.list();
    expect(native.invoke).toHaveBeenCalledWith(
      "ssh_sftp_list",
      expect.objectContaining({ connectionId: "canonical-server", path: "." }),
    );
    expect(context.host.querySelector('[aria-label="Download file.txt"]')).not.toBeNull();
    expect(context.host.querySelector('[aria-label="Download link"]')).toBeNull();
    expect(context.host.textContent).toContain("Symlink; not followed");
  } finally {
    await context.cleanup();
  }
});

it("shows only real observed bytes for the current operation and ignores another operation", async () => {
  const context = await setup();
  let finish!: () => void;
  try {
    await context.list();
    native.save.mockResolvedValueOnce("C:/Downloads/new-file.txt");
    native.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () =>
      context.host.querySelector<HTMLButtonElement>('[aria-label="Download file.txt"]')!.click(),
    );
    const call = native.invoke.mock.calls.find((call) => call[0] === "ssh_sftp_download")!;
    const operationId = (call[1] as { operationId: string }).operationId;
    await act(async () =>
      native.listener!({
        payload: {
          operationId: "foreign",
          phase: "download",
          transferredBytes: 999,
          totalBytes: 1000,
          state: "running",
        },
      }),
    );
    expect(context.host.textContent).not.toContain("999");
    await act(async () =>
      native.listener!({
        payload: {
          operationId,
          phase: "download",
          transferredBytes: 64,
          totalBytes: 128,
          state: "running",
        },
      }),
    );
    expect(context.host.textContent).toContain("64 / 128");
    await act(async () => finish());
  } finally {
    await context.cleanup();
  }
});

it("lists recovery metadata without auto-resume and requires fresh upload replacement consent", async () => {
  const context = await setup([
    {
      id: "saved-recovery",
      direction: "upload",
      localPath: "C:/source.txt",
      remotePath: "/remote/target.txt",
      partialBytes: 10,
      totalBytes: 20,
    },
  ]);
  try {
    expect(native.invoke).not.toHaveBeenCalledWith("ssh_sftp_resume", expect.anything());
    await act(async () => context.button("Review resume").click());
    expect(context.host.textContent).toContain("/remote/target.txt");
    expect(context.button("Resume").disabled).toBe(true);
    await act(async () =>
      context.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    expect(context.button("Resume").disabled).toBe(false);
    native.invoke.mockResolvedValueOnce(undefined);
    await act(async () => context.button("Resume").click());
    expect(native.invoke).toHaveBeenCalledWith(
      "ssh_sftp_resume",
      expect.objectContaining({
        connectionId: "canonical-server",
        recoveryId: "saved-recovery",
        overwriteConfirmed: true,
      }),
    );
  } finally {
    await context.cleanup();
  }
});

it("requires fresh explicit replacement consent before every upload", async () => {
  const context = await setup();
  try {
    await context.list();
    native.open.mockResolvedValueOnce("C:/chosen.txt");
    await act(async () => context.button("Upload").click());
    expect(context.button("Upload file").disabled).toBe(true);
    const checkbox = context.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    await act(async () => checkbox.click());
    expect(context.button("Upload file").disabled).toBe(false);
    native.invoke.mockResolvedValueOnce(123);
    await act(async () => context.button("Upload file").click());
    expect(native.invoke).toHaveBeenCalledWith(
      "ssh_sftp_upload",
      expect.objectContaining({
        connectionId: "canonical-server",
        localPath: "C:/chosen.txt",
        remotePath: "./chosen.txt",
        overwriteConfirmed: true,
      }),
    );
    expect(context.host.textContent).toContain("123");
    native.open.mockResolvedValueOnce("C:/another.txt");
    await act(async () => context.button("Upload").click());
    expect(context.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(
      false,
    );
    expect(context.button("Upload file").disabled).toBe(true);
  } finally {
    await context.cleanup();
  }
});

it("requires target inspection and metadata-only dismissal after uncertain publication", async () => {
  const context = await setup([
    {
      id: "uncertain",
      direction: "upload",
      localPath: "C:/source",
      remotePath: "/target",
      partialBytes: 0,
      publication: "unknown",
    },
  ]);
  try {
    expect(context.host.textContent).toContain("Publication outcome unknown");
    expect(context.button("Review resume").disabled).toBe(true);
    expect(native.invoke).not.toHaveBeenCalledWith("ssh_sftp_resume", expect.anything());
    await act(async () => context.button("Dismiss recovery").click());
    expect(native.invoke).toHaveBeenCalledWith(
      "ssh_sftp_discard",
      expect.objectContaining({ recoveryId: "uncertain", connectionId: "canonical-server" }),
    );
  } finally {
    await context.cleanup();
  }
});

it("retains the last directory on a network failure instead of erasing it", async () => {
  const context = await setup();
  try {
    await context.list();
    native.invoke.mockRejectedValueOnce(new Error("connection interrupted"));
    await act(async () =>
      context.host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(context.host.textContent).toContain("file.txt");
    expect(context.host.querySelector('[role="alert"]')?.textContent).toContain(
      "connection interrupted",
    );
  } finally {
    await context.cleanup();
  }
});

const proxyEndpoint = {
  host: "target.invalid",
  port: 22,
  httpProxy: { host: "proxy.invalid", port: 3128 },
};
it("binds explicit SFTP list/download/upload to one approved operation and cancels without remote IO", async () => {
  approval.request.mockResolvedValueOnce(null).mockResolvedValue("one-operation-ticket");
  native.invoke.mockImplementation(async (command: string) =>
    command === "ssh_sftp_list"
      ? [{ name: "file.txt", kind: "file" }]
      : command === "ssh_sftp_upload"
        ? 12
        : [],
  );
  const context = await setup(undefined, proxyEndpoint);
  const submit = () =>
    act(async () =>
      context.host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  try {
    expect(approval.request).not.toHaveBeenCalled();
    await submit();
    expect(native.invoke).not.toHaveBeenCalledWith("ssh_sftp_list", expect.anything());
    await submit();
    expect(approval.request).toHaveBeenLastCalledWith({
      connectionId: "canonical-server",
      endpoint: proxyEndpoint,
      operation: expect.objectContaining({
        kind: "sftpList",
        path: ".",
        operationId: expect.any(String),
      }),
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "ssh_sftp_list",
      expect.objectContaining({ httpProxyTicketId: "one-operation-ticket", path: "." }),
    );
    native.save.mockResolvedValueOnce("C:/new.txt");
    await act(async () =>
      context.host.querySelector<HTMLButtonElement>('[aria-label="Download file.txt"]')!.click(),
    );
    const download = approval.request.mock.calls.find(
      ([request]) => request.operation.kind === "sftpDownload",
    )![0];
    expect(download.operation).toMatchObject({ remotePath: "./file.txt", localPath: "C:/new.txt" });
    expect(native.invoke).toHaveBeenCalledWith(
      "ssh_sftp_download",
      expect.objectContaining({
        operationId: download.operation.operationId,
        httpProxyTicketId: "one-operation-ticket",
      }),
    );
    native.open.mockResolvedValueOnce("C:/chosen.txt");
    await act(async () => context.button("Upload").click());
    await act(async () =>
      context.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    await act(async () => context.button("Upload file").click());
    const upload = approval.request.mock.calls.find(
      ([request]) => request.operation.kind === "sftpUpload",
    )![0];
    expect(upload.operation).toMatchObject({
      localPath: "C:/chosen.txt",
      remotePath: "./chosen.txt",
      overwriteConfirmed: true,
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "ssh_sftp_upload",
      expect.objectContaining({
        operationId: upload.operation.operationId,
        httpProxyTicketId: "one-operation-ticket",
      }),
    );
  } finally {
    await context.cleanup();
  }
});
it("binds recovery resume/discard authorization to the exact recovery and overwrite decision", async () => {
  approval.request.mockResolvedValue("recovery-ticket");
  native.invoke.mockResolvedValue([]);
  const context = await setup(
    [
      {
        id: "recovery-id",
        direction: "upload",
        localPath: "C:/source",
        remotePath: "/target",
        partialBytes: 2,
      },
    ],
    proxyEndpoint,
  );
  try {
    expect(approval.request).not.toHaveBeenCalled();
    await act(async () => context.button("Review resume").click());
    await act(async () =>
      context.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    await act(async () => context.button("Resume").click());
    expect(approval.request).toHaveBeenCalledWith({
      connectionId: "canonical-server",
      endpoint: proxyEndpoint,
      operation: expect.objectContaining({
        kind: "sftpResume",
        recoveryId: "recovery-id",
        overwriteConfirmed: true,
      }),
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "ssh_sftp_resume",
      expect.objectContaining({
        httpProxyTicketId: "recovery-ticket",
        recoveryId: "recovery-id",
        overwriteConfirmed: true,
      }),
    );
  } finally {
    await context.cleanup();
  }
  const second = await setup(
    [
      {
        id: "discard-id",
        direction: "download",
        localPath: "C:/source",
        remotePath: "/target",
        partialBytes: 2,
      },
    ],
    proxyEndpoint,
  );
  try {
    await act(async () => second.button("Discard partial").click());
    expect(approval.request).toHaveBeenCalledWith({
      connectionId: "canonical-server",
      endpoint: proxyEndpoint,
      operation: expect.objectContaining({ kind: "sftpDiscard", recoveryId: "discard-id" }),
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "ssh_sftp_discard",
      expect.objectContaining({ httpProxyTicketId: "recovery-ticket", recoveryId: "discard-id" }),
    );
  } finally {
    await second.cleanup();
  }
});
