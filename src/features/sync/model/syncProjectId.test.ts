import { describe, expect, it } from "vitest";
import {
  canonicalHostPath,
  folderName,
  hostProjectId,
  isLocationProjectId,
  machineProjectId,
  machineProjectIdPrefix,
} from "./syncProjectId";

describe("canonicalHostPath", () => {
  it("lower-cases Windows drive paths and uses forward slashes", () => {
    expect(canonicalHostPath("G:\\Projects\\Acme\\WEB APPS\\web-portal")).toBe(
      "g:/projects/acme/web apps/web-portal",
    );
    expect(canonicalHostPath("G:/Projects/Acme/WEB APPS/web-portal/")).toBe(
      "g:/projects/acme/web apps/web-portal",
    );
    expect(canonicalHostPath("C:\\")).toBe("c:");
  });

  it("keeps the case of every other path", () => {
    expect(canonicalHostPath("/Users/Me/Projects/Bycoda/")).toBe("/Users/Me/Projects/Bycoda");
    expect(canonicalHostPath("//Server/Share/App")).toBe("//Server/Share/App");
    expect(canonicalHostPath("/")).toBe("/");
  });
});

describe("project ids", () => {
  it("name the host and the canonical path", () => {
    expect(hostProjectId("env-w", "G:\\X\\App")).toBe("loc:env-w:g:/x/app");
    expect(hostProjectId("env-w", "G:/x/app/")).toBe(hostProjectId("env-w", "G:\\X\\App"));
    expect(hostProjectId("env-m", "/Users/me/App")).toBe("loc:env-m:/Users/me/App");
    expect(hostProjectId("env-m", "/Users/me/app")).not.toBe(
      hostProjectId("env-m", "/Users/me/App"),
    );
    expect(hostProjectId("env-w", "/Users/me/App")).not.toBe(
      hostProjectId("env-m", "/Users/me/App"),
    );
  });

  it("fall back to the desktop's machine id when it has no host", () => {
    expect(machineProjectId("m1", "/code/app")).toBe("loc:machine:m1:/code/app");
    expect(machineProjectId("m1", "/code/app").startsWith(machineProjectIdPrefix("m1"))).toBe(true);
  });

  it("tell location ids from older ones", () => {
    expect(isLocationProjectId("loc:env:/x")).toBe(true);
    expect(isLocationProjectId("name:app")).toBe(false);
  });

  it("show a folder by its name", () => {
    expect(folderName("G:\\Projects\\App\\")).toBe("App");
    expect(folderName("/Users/me/Site")).toBe("Site");
  });
});
