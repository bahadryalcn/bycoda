import { expect, it, vi } from "vitest";
import { openRouterTranscriptionModels } from "./voice-transcription-catalog";

it("discovers transcription models, rejects invalid ids and deduplicates", async () => {
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "provider/model", name: "Model" },
            { id: "provider/model", name: "Duplicate" },
            { id: "../unsafe" },
            { id: "provider/second" },
          ],
        }),
      ),
  );
  expect(await openRouterTranscriptionModels(request as typeof fetch)).toEqual([
    { id: "provider/model", label: "Model" },
    { id: "provider/second", label: "provider/second" },
  ]);
  expect((request.mock.calls as unknown as [string][])[0]?.[0]).toContain(
    "output_modalities=transcription",
  );
});

it("reports catalog failures instead of presenting stale models as current", async () => {
  await expect(
    openRouterTranscriptionModels((async () => new Response("", { status: 503 })) as typeof fetch),
  ).rejects.toThrow("unavailable (503)");
  await expect(
    openRouterTranscriptionModels((async () => new Response("{}")) as typeof fetch),
  ).rejects.toThrow("invalid transcription catalog");
});
