import { beforeEach, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("./assistantBuilderClient", () => ({ requestAssistantAvatarData: read }));

import { clearGeneratedAvatarCache, loadGeneratedAvatar } from "./generatedAvatarCache";

beforeEach(() => {
  read.mockReset();
  clearGeneratedAvatarCache();
});

it("reads each generated avatar once", async () => {
  read.mockResolvedValue("data:image/png;base64,AA");
  await expect(loadGeneratedAvatar("a")).resolves.toBe("data:image/png;base64,AA");
  await expect(loadGeneratedAvatar("a")).resolves.toBe("data:image/png;base64,AA");
  expect(read).toHaveBeenCalledTimes(1);
});

it("retries after a failed read", async () => {
  read
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce("data:image/png;base64,BB");
  await expect(loadGeneratedAvatar("b")).rejects.toThrow("offline");
  await expect(loadGeneratedAvatar("b")).resolves.toBe("data:image/png;base64,BB");
  expect(read).toHaveBeenCalledTimes(2);
});
