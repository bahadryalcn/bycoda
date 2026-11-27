// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { saveSessionAdditionalDirs } from "../../projects/public/additionalDirs";
import { remoteSessionAdditionalDirs } from "./remoteSessionDirs";

const project = "remote://env-a/home/me/app";

describe("remoteSessionAdditionalDirs", () => {
  beforeEach(() => localStorage.clear());

  it("sends the session's folders on the same machine as Host paths", () => {
    saveSessionAdditionalDirs("s1", project, [
      "remote://env-a/home/me/docs",
      "remote://env-b/home/me/other",
      "/Users/me/local",
    ]);
    expect(remoteSessionAdditionalDirs("s1", project)).toEqual(["/home/me/docs"]);
  });

  it("is empty without a choice or for a local project", () => {
    expect(remoteSessionAdditionalDirs("s1", project)).toEqual([]);
    expect(remoteSessionAdditionalDirs("s1", "/Users/me/app")).toEqual([]);
  });
});
