import { expect, it, vi } from "vitest";
import { confirmWorkspaceClose } from "./closeConfirmation";
it("does not open the terminal confirmation after the first rejection", async () => {
  const terminal = vi.fn();
  expect(await confirmWorkspaceClose(async () => false, terminal)).toBe(false);
  expect(terminal).not.toHaveBeenCalled();
});
it("waits for confirmations in order and preserves the terminal rejection", async () => {
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
