import { beforeEach, describe, expect, it } from "vitest";
import { projectKey } from "../../../shared/lib/paths";
import {
  loadAutoTabGroupLabels,
  loadCustomTabGroupLabels,
  loadTabGroupLabels,
  saveAutoTabGroupLabel,
  saveTabGroupLabel,
} from "../../workspace/model/tabGroups";
import {
  autoNameOnConflict,
  findNameConflict,
  projectDisplayName,
  projectNameError,
  railProjectPaths,
  suggestUniqueName,
} from "./projectNames";
import { rememberProject } from "./recents";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
    configurable: true,
  });
}

const LOCAL = "/home/me/code/bycoda";
const OTHER = "/home/me/work/bycoda";
const REMOTE = "remote://env-mac/Users/me/code/bycoda";

beforeEach(mockLocalStorage);

describe("projectDisplayName", () => {
  it("is the folder name, also for a project on another machine", () => {
    expect(projectDisplayName(LOCAL)).toBe("bycoda");
    expect(projectDisplayName(REMOTE)).toBe("bycoda");
  });

  it("prefers the user's label over an automatic one", () => {
    saveAutoTabGroupLabel(projectKey(LOCAL), "bycoda 2");
    expect(projectDisplayName(LOCAL)).toBe("bycoda 2");
    saveTabGroupLabel(projectKey(LOCAL), "Mono");
    expect(projectDisplayName(LOCAL)).toBe("Mono");
  });
});

describe("findNameConflict", () => {
  const rail = [LOCAL, REMOTE, "/home/me/code/other"];

  it("finds the other project showing the name, ignoring case and spaces", () => {
    expect(findNameConflict(REMOTE, "  Bycoda ", rail)).toBe(LOCAL);
    expect(findNameConflict("/home/me/code/other", "bycoda", rail)).toBe(LOCAL);
  });

  it("ignores the project itself and free names", () => {
    expect(findNameConflict(LOCAL, "bycoda", [LOCAL])).toBeUndefined();
    expect(findNameConflict(LOCAL, "something else", rail)).toBeUndefined();
    expect(findNameConflict(LOCAL, "  ", rail)).toBeUndefined();
  });

  it("compares against labels, not folder names", () => {
    saveTabGroupLabel(projectKey(LOCAL), "Mono");
    expect(findNameConflict(REMOTE, "bycoda", [LOCAL, REMOTE])).toBeUndefined();
    expect(findNameConflict(REMOTE, "mono", [LOCAL, REMOTE])).toBe(LOCAL);
  });
});

describe("suggestUniqueName", () => {
  it("uses the machine name when there is one", () => {
    expect(suggestUniqueName("bycoda", ["bycoda"], "MacBook")).toBe("bycoda (MacBook)");
  });

  it("numbers the name otherwise", () => {
    expect(suggestUniqueName("bycoda", ["bycoda"])).toBe("bycoda 2");
    expect(suggestUniqueName("bycoda", ["bycoda", "Bycoda 2", "bycoda 3"])).toBe("bycoda 4");
  });

  it("numbers the hinted name when that is taken too", () => {
    expect(suggestUniqueName("bycoda", ["bycoda", "bycoda (macbook)"], "MacBook")).toBe(
      "bycoda (MacBook) 2",
    );
  });
});

describe("path-based project identity", () => {
  it("allows identical names at different full paths without renaming", () => {
    rememberProject(LOCAL);
    rememberProject(OTHER);
    expect(projectNameError(OTHER, "bycoda")).toBeNull();
    expect(projectNameError(OTHER, "")).toBeNull();
    expect(autoNameOnConflict(OTHER)).toBeNull();
    expect(autoNameOnConflict(REMOTE, "MacBook")).toBeNull();
    expect(loadAutoTabGroupLabels()).toEqual({});
    expect(railProjectPaths()).toEqual(expect.arrayContaining([LOCAL, OTHER]));
    expect(projectDisplayName(LOCAL)).toBe("bycoda");
    expect(projectDisplayName(OTHER)).toBe("bycoda");
    expect(projectKey(LOCAL)).not.toBe(projectKey(OTHER));
  });

  it("preserves existing custom and automatic labels", () => {
    saveAutoTabGroupLabel(projectKey(LOCAL), "bycoda 2");
    saveTabGroupLabel(projectKey(OTHER), "work copy");
    autoNameOnConflict(LOCAL);
    expect(projectDisplayName(LOCAL)).toBe("bycoda 2");
    expect(projectDisplayName(OTHER)).toBe("work copy");
    expect(loadCustomTabGroupLabels()).toEqual({ [projectKey(OTHER)]: "work copy" });
  });
});
