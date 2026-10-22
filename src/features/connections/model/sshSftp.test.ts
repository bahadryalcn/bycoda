import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/core", () => native);
import {
  cancelSftp,
  downloadSftp,
  listSftp,
  sftpParent,
  sftpPath,
  uploadSftp,
  validSftpProgress,
  resumeSftp,
  discardSftp,
} from "./sshSftp";
beforeEach(() => vi.clearAllMocks());

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
