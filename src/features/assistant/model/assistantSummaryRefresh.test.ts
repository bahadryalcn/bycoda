import { expect, it, vi } from "vitest";
import { refreshAssistantSummary, hasAssistantSummaryRefresh } from "./assistantSummaryRefresh";
import type {
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
function storage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
}
const thread = {
  id: "thread",
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  summary: "",
  summaryState: { status: "pending" as const, updatedAt: 1 },
};
it("reconciles a lost ACK with the same durable request after reopening before allowing a new explicit refresh", async () => {
  const saved = storage(),
    request = vi.fn(
      async (_input: AssistantRequest, _environmentId: string): Promise<AssistantResponse> => ({
        thread,
      }),
    );
  request.mockRejectedValueOnce(new Error("Acknowledgement lost"));
  await expect(
    refreshAssistantSummary(saved, "original-host", "thread", request, () => true),
  ).rejects.toThrow("lost");
  expect(hasAssistantSummaryRefresh(saved, "original-host", "thread")).toBe(true);
  expect(
    await refreshAssistantSummary(saved, "original-host", "thread", request, () => true),
  ).toEqual(thread);
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  expect(hasAssistantSummaryRefresh(saved, "original-host", "thread")).toBe(false);
  await refreshAssistantSummary(saved, "original-host", "thread", request, () => true);
  expect(request.mock.calls[2][0]).not.toEqual(request.mock.calls[0][0]);
});
it("retains uncertain original identity on replacement Host and refuses before effects when storage is unavailable", async () => {
  const saved = storage();
  let active = true;
  const request = vi.fn(async (): Promise<AssistantResponse> => {
    active = false;
    return { thread };
  });
  await expect(
    refreshAssistantSummary(saved, "original-host", "thread", request, () => active),
  ).rejects.toThrow("not confirmed");
  expect(hasAssistantSummaryRefresh(saved, "original-host", "thread")).toBe(true);
  expect(hasAssistantSummaryRefresh(saved, "replacement-host", "thread")).toBe(false);
  const denied = vi.fn();
  await expect(
    refreshAssistantSummary(
      {
        ...saved,
        setItem: () => {
          throw new Error("Storage unavailable");
        },
      },
      "original-host",
      "thread",
      denied,
      () => true,
    ),
  ).rejects.toThrow("Storage unavailable");
  expect(denied).not.toHaveBeenCalled();
});
