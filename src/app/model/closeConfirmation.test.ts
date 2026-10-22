import { expect, it, vi } from "vitest";
import { confirmWorkspaceClose } from "./closeConfirmation";
it("ilk red sonrası terminal onayını açmaz", async () => {
  const terminal = vi.fn();
  expect(await confirmWorkspaceClose(async () => false, terminal)).toBe(false);
  expect(terminal).not.toHaveBeenCalled();
});
it("onayları sırayla bekler ve terminal reddini korur", async () => {
  const order: string[] = [];
  expect(
    await confirmWorkspaceClose(
      async () => {
        order.push("files");
        return true;
      },
      async () => {
        order.push("terminal");
        return false;
      },
    ),
  ).toBe(false);
  expect(order).toEqual(["files", "terminal"]);
  expect(await confirmWorkspaceClose()).toBe(true);
});
