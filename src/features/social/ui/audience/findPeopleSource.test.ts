import { describe, expect, it } from "vitest";
import {
  buildFindPeopleSource,
  emptyFindPeopleForm,
  findPeopleNeeds,
  type FindPeopleForm,
} from "./findPeopleSource";

function form(patch: Partial<FindPeopleForm>): FindPeopleForm {
  return { ...emptyFindPeopleForm("acc1"), ...patch };
}

describe("buildFindPeopleSource", () => {
  it("asks for an account first", () => {
    expect(buildFindPeopleSource(form({ accountId: "" }))).toEqual({
      error: "Choose an account.",
    });
  });

  it("removes a leading # from a hashtag and requires some text", () => {
    expect(buildFindPeopleSource(form({ kind: "hashtag", query: "#launch" }))).toEqual({
      source: { kind: "hashtag", accountId: "acc1", query: "launch" },
    });
    expect(buildFindPeopleSource(form({ kind: "keyword", query: "  " }))).toEqual({
      error: "Enter a keyword or hashtag.",
    });
  });

  it("removes a leading @ from the handle of another account", () => {
    expect(buildFindPeopleSource(form({ kind: "account_commenters", handle: "@rival" }))).toEqual({
      source: { kind: "account_commenters", accountId: "acc1", handle: "rival" },
    });
  });

  it("leaves the post reference out when it is empty", () => {
    const result = buildFindPeopleSource(form({ kind: "own_post_likes", postRef: "  " }));
    expect(result).toEqual({
      source: { kind: "own_post_likes", accountId: "acc1", postRef: undefined },
    });
  });
});

describe("findPeopleNeeds", () => {
  it("names the one extra field each source kind needs", () => {
    expect(findPeopleNeeds("keyword")).toBe("query");
    expect(findPeopleNeeds("account_commenters")).toBe("handle");
    expect(findPeopleNeeds("own_post_shares")).toBe("postRef");
    expect(findPeopleNeeds("followers")).toBe("none");
  });
});
