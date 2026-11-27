import { expect, it } from "vitest";
import { instagramManagementApply } from "./instagramManagement";

it("rebuilds each owner action with its confirm token", () => {
  expect(
    instagramManagementApply({ kind: "post.delete", details: { postUrl: "https://x/p/1" } }),
  ).toEqual({
    type: "post",
    change: { action: "delete", postUrl: "https://x/p/1", confirm: "DELETE_INSTAGRAM_POST" },
  });
  expect(
    instagramManagementApply({
      kind: "highlight.edit",
      details: { id: "h", expectedName: "Old", name: "New" },
    }),
  ).toEqual({
    type: "highlight",
    change: {
      action: "edit",
      id: "h",
      expectedName: "Old",
      name: "New",
      confirm: "EDIT_INSTAGRAM_HIGHLIGHT",
    },
  });
  expect(
    instagramManagementApply({ kind: "dm.draft", details: { handle: "ada", text: "Hi" } }),
  ).toEqual({ type: "message", handle: "ada", text: "Hi" });
});

it("rejects unusable details", () => {
  expect(instagramManagementApply({ kind: "post.edit", details: {} })).toBeUndefined();
  expect(instagramManagementApply({ kind: "profile.update", details: {} })).toBeUndefined();
});
