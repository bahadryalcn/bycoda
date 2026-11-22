import { describe, expect, it } from "vitest";
import {
  hasForeignMachineAttachment,
  projectlessMachineProject,
  projectlessMachineSession,
  remoteSessionProjectKey,
} from "./sessionMachineTarget";

describe("projectless machine target", () => {
  it("keeps a draft in No project while routing it to the chosen Host", () => {
    const shell = { cwd: "~", remoteExecutionEnvironmentId: "office" };
    const project = projectlessMachineProject("office");
    expect(project.cwd).toBe("~");
    expect(remoteSessionProjectKey(shell)).toBe(project.key);
    expect(projectlessMachineSession(project.key)).toEqual(shell);
    expect(remoteSessionProjectKey({ cwd: "~" })).toBe("~");
    expect(remoteSessionProjectKey({ ...shell, cwd: "C:/repo" })).toBe("C:/repo");
  });

  it("keeps the scope distinct per Host and ignores ordinary remote projects", () => {
    expect(projectlessMachineProject("office").key).not.toBe(projectlessMachineProject("mac").key);
    expect(projectlessMachineSession("remote://office/home/user/repo")).toBeUndefined();
  });

  it("accepts transferable local files and rejects references belonging to another Host", () => {
    const file = {
      id: "file",
      name: "file",
      mimeType: "text/plain",
      kind: "file" as const,
      size: 1,
    };
    expect(hasForeignMachineAttachment([{ ...file, path: "C:/file" }], "office")).toBe(false);
    expect(
      hasForeignMachineAttachment([{ ...file, path: "remote://office/home/file" }], "mac"),
    ).toBe(true);
    expect(hasForeignMachineAttachment([{ ...file, hostEnvironmentId: "office" }], "office")).toBe(
      false,
    );
    expect(hasForeignMachineAttachment([{ ...file, hostEnvironmentId: "office" }], undefined)).toBe(
      true,
    );
  });
});
