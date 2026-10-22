import { describe, expect, it } from "vitest";
import { parseCodeWorkspace } from "./codeWorkspace";

const FILE = "G:/work/acme/acme.code-workspace";

function folders(paths: unknown[]): string {
  return JSON.stringify({ folders: paths });
}

describe("parseCodeWorkspace", () => {
  it("names the workspace after the file", () => {
    expect(parseCodeWorkspace(folders([]), FILE).name).toBe("acme");
    expect(parseCodeWorkspace(folders([]), "/home/me/my.app.code-workspace").name).toBe("my.app");
  });

  it("resolves relative folders against the file's directory", () => {
    const text = folders([{ path: "." }, { path: "web" }, { path: "../shared/ui" }]);
    expect(parseCodeWorkspace(text, FILE).folders).toEqual([
      "G:/work/acme",
      "G:/work/acme/web",
      "G:/work/shared/ui",
    ]);
  });

  it("keeps absolute folders", () => {
    expect(parseCodeWorkspace(folders([{ path: "D:\\repos\\api" }]), FILE).folders).toEqual([
      "D:/repos/api",
    ]);
    expect(
      parseCodeWorkspace(folders([{ path: "/srv/api" }]), "/home/me/a.code-workspace").folders,
    ).toEqual(["/srv/api"]);
  });

  it("normalises backslashes for a Windows workspace file", () => {
    const text = folders([{ path: "..\\backend\\api" }]);
    expect(parseCodeWorkspace(text, "G:\\work\\acme\\acme.code-workspace").folders).toEqual([
      "G:/work/backend/api",
    ]);
  });

  it("accepts comments and trailing commas", () => {
    const text = `{
      // the folders
      "folders": [
        { "path": "web" }, /* front end */
        { "path": "docs//notes", },
      ],
      "settings": { "a": "http://example.com", },
    }`;
    expect(parseCodeWorkspace(text, FILE).folders).toEqual([
      "G:/work/acme/web",
      "G:/work/acme/docs/notes",
    ]);
  });

  it("drops duplicate folders", () => {
    const text = folders([{ path: "web" }, { path: "./web/" }, { path: "WEB" }]);
    expect(parseCodeWorkspace(text, FILE).folders).toEqual(["G:/work/acme/web"]);
  });

  it("reports entries without a path as unsupported", () => {
    const text = folders([{ path: "web" }, { uri: "vscode-remote://ssh/x" }, 7]);
    expect(parseCodeWorkspace(text, FILE)).toEqual({
      name: "acme",
      folders: ["G:/work/acme/web"],
      folderNames: { "g:/work/acme/web": "web" },
      unsupported: ["vscode-remote://ssh/x", "(unknown entry)"],
    });
  });

  it("rejects a malformed file", () => {
    expect(() => parseCodeWorkspace("{ folders: ", FILE)).toThrow(/not valid JSON/);
  });

  it("rejects a file without a folders list", () => {
    expect(() => parseCodeWorkspace("{}", FILE)).toThrow(/no folders/);
    expect(() => parseCodeWorkspace("[]", FILE)).toThrow(/no folders/);
  });
});

it("preserves folder aliases with full-path identity and basename fallback", () => {
  const workspace = parseCodeWorkspace(
    folders([
      { name: "pf-account-srv", path: "pf-account/srv" },
      { name: "pf-payment-srv", path: "pf-payment/srv" },
      { path: "another/srv" },
    ]),
    FILE,
  );
  expect(workspace.folderNames).toEqual({
    "g:/work/acme/pf-account/srv": "pf-account-srv",
    "g:/work/acme/pf-payment/srv": "pf-payment-srv",
    "g:/work/acme/another/srv": "srv",
  });
  expect(workspace.folders).toHaveLength(3);
});
