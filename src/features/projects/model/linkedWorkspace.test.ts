import { describe, expect, it } from "vitest";
import { reconcileLinkedWorkspace } from "./linkedWorkspace";

describe("reconcileLinkedWorkspace", () => {
  it("adds new folders and detaches removed ones", () => {
    const result = reconcileLinkedWorkspace({
      previous: ["G:/w/api", "G:/w/web"],
      next: ["G:/w/api", "G:/w/docs"],
      members: ["g:/w/api", "g:/w/web"],
    });
    expect(result.toAdd).toEqual(["G:/w/docs"]);
    expect(result.toDetach).toEqual(["G:/w/web"]);
    expect(result.unchanged).toEqual(["g:/w/api"]);
    expect(result.linked).toEqual(["G:/w/api", "G:/w/docs"]);
  });

  it("treats a rename as a removal plus an addition", () => {
    const result = reconcileLinkedWorkspace({
      previous: ["G:/w/old"],
      next: ["G:/w/new"],
      members: ["g:/w/old"],
    });
    expect(result.toAdd).toEqual(["G:/w/new"]);
    expect(result.toDetach).toEqual(["G:/w/old"]);
  });

  it("compares Windows paths case-insensitively", () => {
    const result = reconcileLinkedWorkspace({
      previous: ["G:/Work/Api"],
      next: ["g:/work/api/"],
      members: ["g:/work/api"],
    });
    expect(result.toAdd).toEqual([]);
    expect(result.toDetach).toEqual([]);
    expect(result.unchanged).toEqual(["g:/work/api"]);
  });

  it("keeps case-sensitive POSIX paths apart", () => {
    const result = reconcileLinkedWorkspace({
      previous: ["/srv/Api"],
      next: ["/srv/api"],
      members: ["/srv/Api"],
    });
    expect(result.toAdd).toEqual(["/srv/api"]);
    expect(result.toDetach).toEqual(["/srv/Api"]);
  });

  it("ignores duplicate folders in every input", () => {
    const result = reconcileLinkedWorkspace({
      previous: ["G:/w/a", "g:/w/a"],
      next: ["G:/w/b", "g:/w/B", "G:/w/b/"],
      members: ["g:/w/a", "g:/w/a", "g:/w/b"],
    });
    expect(result.toAdd).toEqual([]);
    expect(result.toDetach).toEqual(["G:/w/a"]);
    expect(result.unchanged).toEqual(["g:/w/b"]);
    expect(result.linked).toEqual(["G:/w/b"]);
  });

  it("never detaches projects the user added by hand", () => {
    const result = reconcileLinkedWorkspace({
      previous: ["G:/w/api"],
      next: [],
      members: ["g:/w/api", "g:/other/manual"],
    });
    expect(result.toDetach).toEqual(["G:/w/api"]);
    expect(result.unchanged).toEqual(["g:/other/manual"]);
  });

  it("does not pull back a folder the user moved out of the group", () => {
    const result = reconcileLinkedWorkspace({
      previous: ["G:/w/api"],
      next: ["G:/w/api"],
      members: [],
    });
    expect(result.toAdd).toEqual([]);
    expect(result.toDetach).toEqual([]);
  });

  it("does not re-add a new folder that is already a member", () => {
    const result = reconcileLinkedWorkspace({
      previous: [],
      next: ["G:/w/api"],
      members: ["g:/w/api"],
    });
    expect(result.toAdd).toEqual([]);
    expect(result.linked).toEqual(["G:/w/api"]);
  });

  it("changes nothing when the file is missing or unparsable", () => {
    const result = reconcileLinkedWorkspace({
      previous: ["G:/w/api"],
      next: null,
      members: ["g:/w/api", "g:/x"],
    });
    expect(result).toEqual({
      toAdd: [],
      toDetach: [],
      unchanged: ["g:/w/api", "g:/x"],
      linked: ["G:/w/api"],
    });
  });

  it("detaches everything listed when the file lists no folders", () => {
    const result = reconcileLinkedWorkspace({
      previous: ["G:/w/api"],
      next: [],
      members: ["g:/w/api"],
    });
    expect(result.toDetach).toEqual(["G:/w/api"]);
    expect(result.unchanged).toEqual([]);
  });
});
