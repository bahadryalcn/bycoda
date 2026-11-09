import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(async () => []) }));
const events = vi.hoisted(() => ({ listen: vi.fn(), label: "main" }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: events.label }),
}));
import {
  cancelSftp,
  downloadSftp,
  listSftp,
  sftpParent,
  sftpPath,
  uploadSftp,
  validSftpProgress,
  subscribeSftpProgress,
  resumeSftp,
  discardSftp,
} from "./sshSftp";
beforeEach(() => vi.clearAllMocks());

it("routes progress to its target window and exposes registration failure", async () => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  events.listen.mockImplementation(async (_name, callback, options) => {
    handlers.set(options.target, callback);
    return () => handlers.delete(options.target);
  });
  const first = vi.fn();
  const second = vi.fn();
  events.label = "main";
  const releaseFirst = await subscribeSftpProgress(first);
  events.label = "other";
  const releaseSecond = await subscribeSftpProgress(second);
  const progress = { operationId: "op", phase: "upload", transferredBytes: 1, state: "running" };
  handlers.get("main")?.({ payload: progress });
  expect(first).toHaveBeenCalledExactlyOnceWith(progress);
  expect(second).not.toHaveBeenCalled();
  releaseFirst();
  releaseSecond();
  events.listen.mockRejectedValueOnce(new Error("registration failed"));
  await expect(subscribeSftpProgress(vi.fn())).rejects.toThrow("registration failed");
  events.label = "";
  events.listen.mockClear();
  await expect(subscribeSftpProgress(vi.fn())).rejects.toThrow("window identity");
  expect(events.listen).not.toHaveBeenCalled();
  events.label = "main";
});

describe("SFTP literal remote paths", () => {
  it("preserves remote Unicode and spaces without interpreting local paths", () => {
    expect(sftpPath("/home/alice", "Türkçe file.txt")).toBe("/home/alice/Türkçe file.txt");
    expect(sftpPath("/", "name")).toBe("/name");
    for (const name of ["", ".", "..", "../secret", "a\\b", "*", "x\nput bad", "x\0"])
      expect(() => sftpPath(".", name)).toThrow();
  });
  it("navigates absolute and relative parents without silently switching to local cwd", () => {
    expect(sftpParent("/")).toBe("/");
    expect(sftpParent(".")).toBe("..");
    expect(sftpParent("..")).toBe("../..");
    expect(sftpParent("../..")).toBe("../../..");
    expect(sftpParent("./folder")).toBe(".");
    expect(sftpParent("/home/alice/")).toBe("/home");
    expect(sftpParent("folder")).toBe(".");
  });
});

it("validates observed byte progress without allowing impossible counts", () => {
  const base = {
    operationId: "op",
    phase: "download",
    transferredBytes: 5,
    totalBytes: 10,
    state: "running",
  };
  expect(validSftpProgress(base)).toBe(true);
  for (const change of [
    { transferredBytes: -1 },
    { transferredBytes: 11 },
    { transferredBytes: NaN },
    { totalBytes: -1 },
    { state: "estimated" },
  ])
    expect(validSftpProgress({ ...base, ...change })).toBe(false);
  expect(validSftpProgress({ ...base, totalBytes: undefined })).toBe(true);
});

it("resume and discard are explicit target-bound actions carrying current overwrite choice", async () => {
  await resumeSftp("server", "recovery", false, "resume-op");
  expect(native.invoke).toHaveBeenLastCalledWith("ssh_sftp_resume", {
    connectionId: "server",
    recoveryId: "recovery",
    overwriteConfirmed: false,
    operationId: "resume-op",
  });
  await discardSftp("server", "recovery", "discard-op");
  expect(native.invoke).toHaveBeenLastCalledWith("ssh_sftp_discard", {
    connectionId: "server",
    recoveryId: "recovery",
    operationId: "discard-op",
  });
});

it("sends canonical connection IDs, explicit upload consent and operation-scoped cancellation", async () => {
  await listSftp("server", "/home/alice", "op-list");
  expect(native.invoke).toHaveBeenLastCalledWith("ssh_sftp_list", {
    connectionId: "server",
    path: "/home/alice",
    operationId: "op-list",
  });
  await downloadSftp("server", "/remote/file", "C:/Downloads/new-file", "op-get");
  expect(native.invoke).toHaveBeenLastCalledWith("ssh_sftp_download", {
    connectionId: "server",
    remotePath: "/remote/file",
    localPath: "C:/Downloads/new-file",
    operationId: "op-get",
  });
  await uploadSftp("server", "C:/upload/file", "/remote/file", false, "op-put");
  expect(native.invoke).toHaveBeenLastCalledWith("ssh_sftp_upload", {
    connectionId: "server",
    localPath: "C:/upload/file",
    remotePath: "/remote/file",
    overwriteConfirmed: false,
    operationId: "op-put",
  });
  await cancelSftp("op-put");
  expect(native.invoke).toHaveBeenLastCalledWith("ssh_sftp_cancel", { operationId: "op-put" });
});

it("passes a proxy ticket only to the explicitly approved SFTP operation", async () => {
  await uploadSftp(
    "server",
    "C:/upload/file",
    "/remote/file",
    false,
    "approved-operation",
    "one-use-ticket",
  );
  expect(native.invoke).toHaveBeenLastCalledWith("ssh_sftp_upload", {
    connectionId: "server",
    localPath: "C:/upload/file",
    remotePath: "/remote/file",
    overwriteConfirmed: false,
    operationId: "approved-operation",
    httpProxyTicketId: "one-use-ticket",
  });
  await listSftp("server", "/remote", "another-operation");
  expect(native.invoke).toHaveBeenLastCalledWith("ssh_sftp_list", {
    connectionId: "server",
    path: "/remote",
    operationId: "another-operation",
  });
});
