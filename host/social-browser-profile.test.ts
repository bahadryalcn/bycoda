import { expect, it, vi } from "vitest";
import { XProfileActions, parseXProfilePatch } from "./social-browser-profile";
import type { BrowserPage } from "./social-browser";

function fixture(persist = true) {
  let stored = { name: "bycoda", bio: "Old bio", location: "", website: "" };
  let editor = { ...stored };
  const page = {
    goto: vi.fn(async () => {
      editor = { ...stored };
    }),
    evaluate: vi.fn(async (expression: string) =>
      expression.includes("const read = name") ? { ...editor } : true,
    ),
    fill: vi.fn(async (selector: string, value: string) => {
      const field = Object.entries({
        name: "displayName",
        bio: "description",
        location: "location",
        website: "url",
      }).find(([, name]) => selector.includes(`"${name}"`))![0];
      (editor as Record<string, string>)[field] = value;
    }),
    click: vi.fn(async () => {
      if (persist) stored = { ...editor };
    }),
    setFiles: vi.fn(),
  } as unknown as BrowserPage;
  const verify = vi.fn(async () => undefined);
  const until = vi.fn(async <T>(expression: string) => page.evaluate<T>(expression));
  return { page, verify, until, actions: new XProfileActions(page, verify, until) };
}
it("accepts only public profile fields, bounded images and HTTPS websites", () => {
  expect(parseXProfilePatch({ bio: "", location: "", website: "" })).toEqual({
    bio: "",
    location: "",
    website: "",
  });
  for (const patch of [
    { password: "synthetic" },
    { name: "" },
    { bio: "a".repeat(161) },
    { website: "http://example.com" },
    { website: "https://user:synthetic@example.com" },
    { avatarUploadId: "C:/private.png" },
    { constructor: "unexpected" },
  ])
    expect(() => parseXProfilePatch(patch)).toThrow();
});
it("updates fields and verifies persistence by reopening instead of trusting optimistic values", async () => {
  const s = fixture();
  const saved = await s.actions.update({ bio: "New bio", website: "https://example.com" }, {});
  expect(saved).toMatchObject({ bio: "New bio", website: "https://example.com" });
  expect(s.page.goto).toHaveBeenCalledTimes(2);
  expect(s.page.click).toHaveBeenCalledWith('[data-testid="Profile_Save_Button"]');
  expect(s.verify).toHaveBeenCalledTimes(6);
  const lost = fixture(false);
  await expect(lost.actions.update({ bio: "Not persisted" }, {})).rejects.toMatchObject({
    code: "unknown",
  });
});
it("does not click Save after the current account identity changes", async () => {
  const s = fixture();
  s.verify
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Identity changed"));
  await expect(s.actions.update({ bio: "New" }, {})).rejects.toThrow("Identity changed");
  expect(s.page.click).not.toHaveBeenCalled();
});
it("follows only the resolved numeric target, is idempotent, and requires visible acknowledgement", async () => {
  const s = fixture();
  s.until
    .mockResolvedValueOnce({ id: "123", following: false } as never)
    .mockResolvedValueOnce(true as never);
  expect(await s.actions.follow("github")).toMatchObject({ platformId: "123", changed: true });
  expect(s.page.click).toHaveBeenCalledWith('[data-testid="123-follow"]');
  s.until.mockResolvedValueOnce({ id: "123", following: true } as never);
  expect(await s.actions.follow("github")).toMatchObject({ changed: false });
  expect(s.page.click).toHaveBeenCalledTimes(1);
  s.until
    .mockResolvedValueOnce({ id: "123", following: false } as never)
    .mockResolvedValueOnce(undefined);
  await expect(s.actions.follow("github")).rejects.toMatchObject({ code: "unknown" });
  await expect(s.actions.follow("github?other=1")).rejects.toThrow("username");
});
