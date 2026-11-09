import { describe, expect, it, vi } from "vitest";
import { repositoryFolderName, runContribution, type ContributeDeps } from "./contributeFlow";

const make = (over: Partial<ContributeDeps> = {}) => {
  const deps: ContributeDeps = {
    repositoryUrl: "https://github.com/acme/bycoda.git",
    pickParent: vi.fn(async () => "C:/code/"),
    clone: vi.fn(async (_url: string, parent: string) => `${parent}bycoda`),
    isDirectory: vi.fn(async () => false),
    open: vi.fn(),
    onCloning: vi.fn(),
    ...over,
  };
  return deps;
};

describe("repositoryFolderName", () => {
  it("matches the folder git creates", () => {
    expect(repositoryFolderName("https://github.com/acme/bycoda.git")).toBe("bycoda");
    expect(repositoryFolderName("https://github.com/acme/bycoda/")).toBe("bycoda");
    expect(repositoryFolderName("git@github.com:acme/bycoda.git")).toBe("bycoda");
  });
});

describe("runContribution", () => {
  it("clones into the chosen folder and opens the clone", async () => {
    const deps = make();
    const result = await runContribution(deps);
    expect(deps.clone).toHaveBeenCalledWith("https://github.com/acme/bycoda.git", "C:/code/");
    expect(deps.onCloning).toHaveBeenCalled();
    expect(deps.open).toHaveBeenCalledWith("C:/code/bycoda");
    expect(result).toEqual({ status: "opened", path: "C:/code/bycoda", existed: false });
  });

  it("does nothing when the picker is dismissed", async () => {
    const deps = make({ pickParent: async () => null });
    expect(await runContribution(deps)).toBeNull();
    expect(deps.clone).not.toHaveBeenCalled();
  });

  it("opens an existing checkout without cloning", async () => {
    const deps = make({ isDirectory: vi.fn(async () => true) });
    const result = await runContribution(deps);
    expect(deps.clone).not.toHaveBeenCalled();
    expect(deps.open).toHaveBeenCalledWith("C:/code/bycoda");
    expect(result).toMatchObject({ status: "opened", existed: true });
  });

  it("leaves an existing folder that is not a git checkout alone", async () => {
    const deps = make({ isDirectory: vi.fn(async (path: string) => !path.endsWith(".git")) });
    expect(await runContribution(deps)).toMatchObject({ status: "failed", reason: "failed" });
    expect(deps.clone).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();
  });

  it("reports a missing git and other clone failures", async () => {
    const missing = make({
      clone: vi.fn(async () => {
        throw "git is not installed";
      }),
    });
    expect(await runContribution(missing)).toMatchObject({
      status: "failed",
      reason: "git-missing",
    });
    const broken = make({
      clone: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    expect(await runContribution(broken)).toMatchObject({ status: "failed", reason: "failed" });
    expect(broken.open).not.toHaveBeenCalled();
  });

  it("needs a configured repository", async () => {
    expect(await runContribution(make({ repositoryUrl: null }))).toMatchObject({
      status: "failed",
    });
  });
});
