import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateSocialImage,
  ImageGenerationError,
  validateGeneratedImage,
  createSocialImageAdapters,
  type SocialImageAdapter,
} from "./social-images";
import { defaultProgram } from "../src/features/social/model/socialProgram";
afterEach(() => vi.unstubAllGlobals());
const adapter = (
  provider: "codex" | "gemini" | "comfyui",
  available = true,
): SocialImageAdapter => ({
  capability: async () => ({ provider, available, reason: "", models: ["model"] }),
  generate: vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), model: "model" })),
});
const request = () => ({
  id: "test",
  prompt: "Owner image brief",
  aspectRatio: "1:1" as const,
  signal: new AbortController().signal,
  checkpoint: vi.fn(),
});
describe("image provider routing", () => {
  it("discovers owner-workflow model choices and follows ComfyUI progress/results", async () => {
    const folder = mkdtempSync(join(tmpdir(), "bycoda-comfy-test-")),
      path = join(folder, "workflow.json");
    const sockets: Array<{
      onmessage: ((event: { data: string }) => void) | null;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    class Socket {
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: unknown;
      close = vi.fn();
      constructor() {
        sockets.push(this);
      }
    }
    vi.stubGlobal("WebSocket", Socket);
    writeFileSync(
      path,
      JSON.stringify({
        "1": {
          class_type: "FluxLoader",
          inputs: {
            model_name: "{{model}}",
            prompt: "{{prompt}}",
            width: "{{width}}",
            height: "{{height}}",
          },
        },
      }),
    );
    let submitted: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (raw: string, init?: RequestInit) => {
        if (raw.endsWith("/object_info"))
          return Response.json({
            FluxLoader: { input: { required: { model_name: [["flux-dev", "flux-schnell"]] } } },
          });
        if (raw.endsWith("/prompt")) {
          submitted = JSON.parse(String(init?.body));
          return Response.json({ prompt_id: "known-job" });
        }
        if (raw.includes("/history/")) {
          sockets[0]?.onmessage?.({
            data: JSON.stringify({
              type: "progress",
              data: { prompt_id: "known-job", value: 5, max: 10 },
            }),
          });
          return Response.json({
            "known-job": {
              outputs: { "1": { images: [{ filename: "output.png", type: "output" }] } },
            },
          });
        }
        return new Response(new Uint8Array([137, 80, 78, 71]));
      }),
    );
    try {
      const adapter = createSocialImageAdapters(folder, {
        BYCODA_SOCIAL_COMFYUI_ENDPOINT: "http://127.0.0.1:8188",
        BYCODA_SOCIAL_COMFYUI_WORKFLOW: path,
      }).comfyui!;
      expect((await adapter.capability()).models).toEqual(["flux-dev", "flux-schnell"]);
      const progress = vi.fn(),
        result = await adapter.generate({
          ...request(),
          model: "flux-schnell",
          aspectRatio: "16:9",
          progress,
        });
      expect(submitted.prompt["1"].inputs).toMatchObject({
        model_name: "flux-schnell",
        prompt: "Owner image brief",
        width: 1280,
        height: 720,
      });
      expect(result.model).toBe("flux-schnell");
      expect(progress).toHaveBeenCalledWith(50);
      expect(sockets[0].close).toHaveBeenCalled();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it("reports invalid local configuration without breaking the host", async () => {
    const adapters = createSocialImageAdapters(".", {
      BYCODA_SOCIAL_COMFYUI_ENDPOINT: "http://192.168.1.2:8188",
      BYCODA_SOCIAL_COMFYUI_WORKFLOW: "workflow.json",
    });
    expect((await adapters.comfyui!.capability()).available).toBe(false);
  });
  it("rejects unsupported media and oversized dimensions before host storage", () => {
    expect(() => validateGeneratedImage(new Uint8Array([1, 2, 3]))).toThrow();
    const png = Buffer.alloc(32);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write("IHDR", 12);
    png.writeUInt32BE(1024, 16);
    png.writeUInt32BE(1024, 20);
    expect(validateGeneratedImage(png)).toEqual({ width: 1024, height: 1024 });
    png.writeUInt32BE(10000, 16);
    expect(() => validateGeneratedImage(png)).toThrow("dimensions");
  });
  it("uses Codex, Gemini, then ComfyUI and never implicitly uses paid OpenAI API", async () => {
    const codex = adapter("codex", false),
      gemini = adapter("gemini", false),
      comfyui = adapter("comfyui"),
      transition = vi.fn(),
      budget = vi.fn();
    const result = await generateSocialImage(
      { codex, gemini, comfyui },
      defaultProgram().image,
      request(),
      transition,
      budget,
    );
    expect(result.provider).toBe("comfyui");
    expect(budget).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledTimes(2);
  });
  it("falls back on a transient failure and budgets each actual provider attempt", async () => {
    const codex = adapter("codex"),
      gemini = adapter("gemini"),
      budget = vi.fn();
    vi.mocked(codex.generate).mockRejectedValue(
      new ImageGenerationError("transient", "Temporarily unavailable"),
    );
    expect(
      (
        await generateSocialImage(
          { codex, gemini },
          defaultProgram().image,
          request(),
          vi.fn(),
          budget,
        )
      ).provider,
    ).toBe("gemini");
    expect(budget).toHaveBeenCalledTimes(2);
  });
  it("does not bypass safety refusal or fallback for a fixed provider", async () => {
    const codex = adapter("codex"),
      gemini = adapter("gemini");
    vi.mocked(codex.generate).mockRejectedValue(
      new ImageGenerationError("refused", "Safety refusal"),
    );
    await expect(
      generateSocialImage({ codex, gemini }, defaultProgram().image, request(), vi.fn()),
    ).rejects.toThrow("Safety");
    expect(gemini.generate).not.toHaveBeenCalled();
    await expect(
      generateSocialImage(
        { gemini },
        { ...defaultProgram().image, provider: "codex" },
        request(),
        vi.fn(),
      ),
    ).rejects.toThrow("No selected");
  });
  it("stops routing when the generation budget is exhausted", async () => {
    const codex = adapter("codex");
    await expect(
      generateSocialImage({ codex }, defaultProgram().image, request(), vi.fn(), () => {
        throw new Error("budget");
      }),
    ).rejects.toThrow("budget");
    expect(codex.generate).not.toHaveBeenCalled();
  });
});
