import { describe, expect, it } from "vitest";
import {
  duplicateProjectNames,
  identityLine,
  isDuplicateProjectName,
  parentFolderLabel,
} from "./projectIdentity";

describe("parentFolderLabel", () => {
  it("names the folder that holds the project", () => {
    expect(parentFolderLabel(String.raw`C:\code\clients\app`)).toBe("clients");
    expect(parentFolderLabel("/home/dev/work/app/")).toBe("work");
    expect(parentFolderLabel("/Users/ayşe/Projeler/uygulama")).toBe("Projeler");
  });

  it("returns nothing for a root-level folder or a drive", () => {
    expect(parentFolderLabel(String.raw`C:\app`)).toBe("");
    expect(parentFolderLabel("/app")).toBe("");
    expect(parentFolderLabel("app")).toBe("");
    expect(parentFolderLabel("")).toBe("");
  });
});

describe("duplicateProjectNames", () => {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  it("finds names that different projects share, ignoring case and spacing", () => {
    const names = duplicateProjectNames(
      [
        { path: "/a/app", name: "App" },
        { path: "/b/app", name: " app " },
        { path: "/a/site", name: "Site" },
      ],
      same,
    );
    expect(isDuplicateProjectName(names, "APP")).toBe(true);
    expect(isDuplicateProjectName(names, "Site")).toBe(false);
  });

  it("does not count one project listed twice", () => {
    const names = duplicateProjectNames(
      [
        { path: "/a/app", name: "app" },
        { path: "/A/APP", name: "app" },
      ],
      same,
    );
    expect(names.size).toBe(0);
  });

  it("ignores empty names", () => {
    expect(
      duplicateProjectNames([
        { path: "/a", name: "" },
        { path: "/b", name: "  " },
      ]).size,
    ).toBe(0);
  });
});

describe("identityLine", () => {
  it("drops empty parts and keeps the order", () => {
    expect(identityLine(["app", "/work/app", false, null, undefined, "Working"])).toBe(
      "app · /work/app · Working",
    );
  });
});
