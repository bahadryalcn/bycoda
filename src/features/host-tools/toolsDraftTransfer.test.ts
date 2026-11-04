import { describe, expect, it, vi } from "vitest";
import {
  peekToolsDraftPart,
  readToolsDraftTransfer,
  restoreToolsDraftTransfer,
  subscribeToolsDraftTransfer,
  writeToolsDraftPart,
  holdToolsDraftTransfer,
  readToolsWorkspaceDrafts,
  restoreToolsWorkspaceDrafts,
} from "./toolsDraftTransfer";

describe("tools presentation transfer", () => {
  it("retains independent device input drafts without a control grant", () => {
    const scope = {
      cwd: "/devices",
      sessionId: "input-transfer",
      targetValue: "machine:phone-host",
    };
    writeToolsDraftPart(scope, "device", {
      selected: "phone-a",
      app: "a.app",
      text: "Türkçe draft",
      zoom: 1,
      annotations: {},
      inputs: {
        "phone-a": { app: "a.app", text: "Türkçe draft" },
        "phone-b": { app: "b.app", text: "other draft" },
      },
    });
    const value = readToolsDraftTransfer(scope.cwd, scope.sessionId, scope.targetValue)!;
    restoreToolsDraftTransfer("/destination", scope.sessionId, scope.targetValue, value);
    value.device!.inputs!["phone-a"].text = "changed outside store";
    expect(
      peekToolsDraftPart({ ...scope, cwd: "/destination" }, "device")?.inputs?.["phone-a"].text,
    ).toBe("Türkçe draft");
    expect(JSON.stringify(value)).not.toContain("leaseId");
  });
  it("rejects snapshot while an operation is in flight and permits it after settlement", () => {
    const scope = { cwd: "/repo", sessionId: "pending-test", targetValue: "project" };
    const release = holdToolsDraftTransfer(scope);
    expect(() => readToolsDraftTransfer(scope.cwd, scope.sessionId, scope.targetValue)).toThrow(
      "Wait for the current tool action",
    );
    release();
    expect(readToolsDraftTransfer(scope.cwd, scope.sessionId, scope.targetValue)).toBeUndefined();
  });
  it("restores exact machine scope without carrying control state", () => {
    const source = { cwd: "C:\\Work\\Repo", sessionId: "host-a", targetValue: "local" };
    writeToolsDraftPart(source, "servers", {
      showStart: true,
      name: "api",
      command: "pnpm dev",
      workingDirectory: "src",
      port: "3000",
      restartCommand: "",
      restartCwd: "",
    });
    const snapshot = readToolsDraftTransfer("c:/work/repo", "host-a", "local")!;
    expect(readToolsDraftTransfer("c:/work/repo", "host-a", "machine:other")).toBeUndefined();
    const received = vi.fn();
    const stop = subscribeToolsDraftTransfer(source, received);
    restoreToolsDraftTransfer(source.cwd, source.sessionId, source.targetValue, snapshot);
    expect(received).toHaveBeenCalledWith(snapshot);
    expect(peekToolsDraftPart(source, "servers")?.command).toBe("pnpm dev");
    expect(JSON.stringify(snapshot)).not.toContain("leaseId");
    stop();
  });
  it("rejects over-budget UTF-8 snapshots without replacing the existing draft", () => {
    const scope = { cwd: "/repo", sessionId: "limit", targetValue: "project" };
    const good = {
      showStart: true,
      name: "ok",
      command: "",
      workingDirectory: "",
      port: "",
      restartCommand: "",
      restartCwd: "",
    };
    writeToolsDraftPart(scope, "servers", good);
    expect(() =>
      restoreToolsDraftTransfer(scope.cwd, scope.sessionId, scope.targetValue, {
        servers: { ...good, command: "界".repeat(4_300_000) },
      }),
    ).toThrow("too large");
    expect(peekToolsDraftPart(scope, "servers")).toEqual(good);
  });
  it("moves every target for one session without crossing session boundaries", () => {
    const value = {
      showStart: true,
      name: "first",
      command: "dev",
      workingDirectory: "",
      port: "",
      restartCommand: "",
      restartCwd: "",
    };
    writeToolsDraftPart(
      { cwd: "/multi", sessionId: "a", targetValue: "project" },
      "servers",
      value,
    );
    writeToolsDraftPart({ cwd: "/multi", sessionId: "a", targetValue: "machine:two" }, "servers", {
      ...value,
      name: "second",
    });
    writeToolsDraftPart({ cwd: "/multi", sessionId: "b", targetValue: "project" }, "servers", {
      ...value,
      name: "other",
    });
    const release = holdToolsDraftTransfer({
      cwd: "/multi",
      sessionId: "a",
      targetValue: "machine:two",
    });
    expect(() => readToolsWorkspaceDrafts("/multi", "a")).toThrow(
      "Wait for the current tool action",
    );
    release();
    const snapshot = readToolsWorkspaceDrafts("/multi", "a");
    expect(Object.keys(snapshot).sort()).toEqual(["machine:two", "project"]);
    restoreToolsWorkspaceDrafts("/destination", "a", snapshot);
    expect(readToolsWorkspaceDrafts("/destination", "a")["machine:two"].servers?.name).toBe(
      "second",
    );
    expect(readToolsWorkspaceDrafts("/multi", "b").project.servers?.name).toBe("other");
  });
});
