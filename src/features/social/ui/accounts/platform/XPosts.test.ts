import { expect, it } from "vitest";
import type { SocialJob } from "../../../model/social";
import { xPostLabel, xPublishedPosts } from "./XPosts";

const job = (patch: Partial<SocialJob>) =>
  ({
    id: "job",
    accountId: "x1",
    kind: "publish",
    status: "succeeded",
    platformId: "1900",
    payload: { text: "Launch day" },
    ...patch,
  }) as SocialJob;

it("lists only this account's confirmed publications that have an X post id", () => {
  const jobs = [
    job({ id: "a" }),
    job({ id: "b", accountId: "x2" }),
    job({ id: "c", status: "failed" }),
    job({ id: "d", kind: "reply" }),
    job({ id: "e", platformId: undefined }),
  ];
  expect(xPublishedPosts(jobs, "x1").map((item) => item.id)).toEqual(["a"]);
});

it("labels a post by its first words and falls back to its X id", () => {
  expect(xPostLabel(job({}))).toBe("Launch day");
  expect(xPostLabel(job({ payload: { text: "  " } as SocialJob["payload"] }))).toBe("1900");
  expect(
    xPostLabel(job({ payload: { text: "x".repeat(300) } as SocialJob["payload"] })),
  ).toHaveLength(100);
});
