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

describe("projectNameError", () => {
  it("rejects a name another project shows", () => {
    rememberProject(LOCAL);
    rememberProject("/home/me/code/other");
    expect(projectNameError("/home/me/code/other", "Bycoda")).toBe(
      'A project named "Bycoda" already exists. Choose a different name.',
    );
    expect(projectNameError("/home/me/code/other", "fine")).toBeNull();
  });

  it("checks the folder name when the label is cleared", () => {
    rememberProject(LOCAL);
    rememberProject(OTHER);
    saveTabGroupLabel(projectKey(OTHER), "work copy");
    expect(projectNameError(OTHER, "")).toBe(
      'A project named "bycoda" already exists. Choose a different name.',
    );
    expect(projectNameError(LOCAL, "")).toBeNull();
  });
});

describe("autoNameOnConflict", () => {
  it("names only the added project, in the store that does not sync", () => {
    rememberProject(LOCAL);
    rememberProject(REMOTE);
    expect(autoNameOnConflict(REMOTE, "MacBook")).toEqual({
      path: REMOTE,
      name: "bycoda",
      suggested: "bycoda (MacBook)",
    });
    expect(loadAutoTabGroupLabels()).toEqual({ [projectKey(REMOTE)]: "bycoda (MacBook)" });
    expect(loadCustomTabGroupLabels()).toEqual({});
    expect(loadTabGroupLabels()[projectKey(LOCAL)]).toBeUndefined();
    expect(
      railProjectPaths()
        .map((path) => projectDisplayName(path))
        .sort(),
    ).toEqual(["bycoda", "bycoda (MacBook)"]);
  });

  it("numbers a local project and skips names already taken", () => {
    rememberProject(LOCAL);
    rememberProject("/home/me/code/x");
    saveTabGroupLabel(projectKey("/home/me/code/x"), "bycoda 2");
    rememberProject(OTHER);
    expect(autoNameOnConflict(OTHER)?.suggested).toBe("bycoda 3");
  });

  it("leaves a project alone when nothing clashes or it already has a label", () => {
    rememberProject(LOCAL);
    rememberProject("/home/me/code/other");
    expect(autoNameOnConflict("/home/me/code/other")).toBeNull();

    rememberProject(OTHER);
    saveTabGroupLabel(projectKey(OTHER), "bycoda");
    expect(autoNameOnConflict(OTHER)).toBeNull();
    expect(loadAutoTabGroupLabels()).toEqual({});
  });

  it("drops the automatic name once the user names the project", () => {
    rememberProject(LOCAL);
    rememberProject(OTHER);
    autoNameOnConflict(OTHER);
    saveTabGroupLabel(projectKey(OTHER), "work copy");
    expect(loadAutoTabGroupLabels()).toEqual({});
    expect(projectDisplayName(OTHER)).toBe("work copy");
  });
});
