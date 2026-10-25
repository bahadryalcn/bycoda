import { expect, it } from "vitest";
import { StoreDatabase } from "./store-db";
import {
  desktopActorId,
  desktopOperationId,
  desktopReviewSecret,
  openDesktopReview,
  sealDesktopReview,
  openDesktopResource,
  sealDesktopResource,
} from "./reviewed-desktop-scope";
const scope = { environmentId: "host", projectId: "project", sessionId: "session" };
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = 1792620000000;
const secret = "synthetic-host-only-key";
it("separates resource roles, features, actors and sources without exposing credentials", () => {
  const pty = { ...scope, feature: "pty-mobile" as const };
  const handle = sealDesktopResource(secret, "first-credential", pty, "terminal", id);
  expect(openDesktopResource(secret, "first-credential", pty, "terminal", handle)).toBe(id);
  expect(handle).not.toContain("first-credential");
  for (const role of ["epoch", "lease", "workspace"] as const)
    expect(() => openDesktopResource(secret, "first-credential", pty, role, handle)).toThrow();
  for (const other of [
    { ...pty, feature: "ssh-workspace" as const },
    { ...pty, projectId: "other" },
    { ...pty, sessionId: "other" },
    { ...pty, environmentId: "other" },
  ])
    expect(() =>
      openDesktopResource(secret, "first-credential", other, "terminal", handle),
    ).toThrow();
  expect(() => openDesktopResource(secret, "second-credential", pty, "terminal", handle)).toThrow();
  expect(() => openDesktopResource(secret, "first-credential", pty, "terminal", id)).toThrow();
  const forged = sealDesktopResource("second-credential", "second-credential", pty, "terminal", id);
  expect(() => openDesktopResource(secret, "second-credential", pty, "terminal", forged)).toThrow();
  expect(desktopActorId(secret, "first-credential", pty)).toBe(
    desktopActorId(secret, "first-credential", pty),
  );
  expect(desktopActorId(secret, "first-credential", pty)).not.toBe(
    desktopActorId(secret, "second-credential", pty),
  );
  expect(desktopActorId(secret, "first-credential", pty)).not.toBe(
    desktopActorId(secret, "first-credential", { ...pty, feature: "ssh-workspace" }),
  );
  expect(desktopOperationId(secret, "first-credential", pty, "request")).not.toBe(
    desktopOperationId(secret, "first-credential", scope, "request"),
  );
  const review = sealDesktopReview(
    secret,
    "first-credential",
    { ...scope, feature: "ssh-workspace" },
    id,
    now + 1000,
    now,
  );
  expect(() => openDesktopReview(secret, "first-credential", scope, review, now)).toThrow();
});
it("binds an exact native review and expiry to the paired device and source", () => {
  const review = sealDesktopReview(secret, "first-credential", scope, id, now + 120_000, now);
  expect(openDesktopReview(secret, "first-credential", scope, review, now)).toBe(id);
  expect(review).not.toContain("first-credential");
  for (const [token, other] of [
    ["second-credential", scope],
    ["first-credential", { ...scope, environmentId: "other" }],
    ["first-credential", { ...scope, projectId: "other" }],
    ["first-credential", { ...scope, sessionId: "other" }],
  ] as const)
    expect(() => openDesktopReview(secret, token, other, review, now)).toThrow();
  expect(() =>
    openDesktopReview(
      secret,
      "first-credential",
      scope,
      review.replace(String(now + 120_000), String(now + 119_000)),
      now,
    ),
  ).toThrow();
  expect(() =>
    openDesktopReview(secret, "first-credential", scope, review, now + 120_000),
  ).toThrow();
  expect(() => openDesktopReview(secret, "first-credential", scope, id, now)).toThrow();
  const forged = sealDesktopReview(
    "second-credential",
    "second-credential",
    scope,
    id,
    now + 120_000,
    now,
  );
  expect(() => openDesktopReview(secret, "second-credential", scope, forged, now)).toThrow();
});
it("isolates status and approval request IDs without a volatile host mapping", () => {
  const first = desktopOperationId(secret, "first-credential", scope, "phone-request");
  expect(desktopOperationId(secret, "first-credential", { ...scope }, "phone-request")).toBe(first);
  expect(desktopOperationId(secret, "second-credential", scope, "phone-request")).not.toBe(first);
  expect(
    desktopOperationId(
      secret,
      "first-credential",
      { ...scope, sessionId: "other" },
      "phone-request",
    ),
  ).not.toBe(first);
  expect(() => desktopOperationId(secret, "first-credential", scope, "")).toThrow();
});
it("keeps the signing key in the canonical host database and refuses corrupt state", async () => {
  const db = new StoreDatabase(":memory:");
  await db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  try {
    const first = await desktopReviewSecret({ db });
    expect(first === (await desktopReviewSecret({ db }))).toBe(true);
    await db
      .prepare("UPDATE metadata SET value=? WHERE key='desktopReviewSecret.v1'")
      .run("invalid");
    await expect((async () => await desktopReviewSecret({ db }))()).rejects.toThrow("unavailable");
  } finally {
    await db.close();
  }
});
