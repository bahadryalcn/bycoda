import { HttpStreamScope, readHttpBytes } from "../transport/http/http-stream-scope";
import {
  ImageGenerationError,
  type ImageRequest,
  type ImageResult,
  type SocialImageAdapters,
} from "./social-image-core";
import type { ImageProvider, ProgramConfig } from "../../src/features/social/model/socialProgram";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { codexImages } from "./social-images-codex";

export * from "./social-image-core";
export { decodeInlineCodexImage } from "./social-images-codex";

const IMAGE_HTTP_TOTAL_MS = 180_000;
async function imageHttpBytes(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  limit: number,
): Promise<Uint8Array> {
  const scope = new HttpStreamScope(signal, {
    firstMs: IMAGE_HTTP_TOTAL_MS,
    idleMs: 30_000,
    totalMs: IMAGE_HTTP_TOTAL_MS,
    label: "Image provider",
  });
  try {
    const response = await scope.request((signal) =>
      fetch(url, { ...init, signal, redirect: "error" }),
    );
    if (!response.ok)
      throw new ImageGenerationError(
        response.status === 429 || response.status >= 500 ? "transient" : "refused",
        `Image provider returned HTTP ${response.status}.`,
      );
    return await readHttpBytes(scope, response, limit);
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    // Aborting a request/body does not prove that generation was not accepted.
    // Keep original checkpoints and require review; never route to a new provider.
    throw new ImageGenerationError(
      "uncertain",
      "Image provider response did not complete. Generation may have been accepted; reconcile before retry.",
    );
  } finally {
    scope.close();
  }
}
async function json(url: string, init: RequestInit, signal: AbortSignal): Promise<any> {
  const body = await imageHttpBytes(url, init, signal, 16 * 1024 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new ImageGenerationError(
      "uncertain",
      "Image provider response was unreadable. Generation may have been accepted; reconcile before retry.",
    );
  }
}
async function wait(signal: AbortSignal) {
  await new Promise<void>((yes, no) => {
    const abort = () => {
      clearTimeout(timer);
      no(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      yes();
    }, 1000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
function localEndpoint(raw: string) {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("Use an explicit loopback ComfyUI endpoint on this executor host.");
  return url.href.replace(/\/$/, "");
}
function comfyProgress(
  endpoint: string,
  clientId: string,
  job: () => string | undefined,
  progress: ImageRequest["progress"],
  signal: AbortSignal,
) {
  if (typeof WebSocket === "undefined" || !progress) return () => {};
  const url = new URL(`${endpoint}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("clientId", clientId);
  const socket = new WebSocket(url.href);
  let activePrompt: string | undefined,
    lastAt = 0;
  socket.onerror = () => {};
  socket.onmessage = (event) => {
    try {
      const value = JSON.parse(String(event.data));
      if (value.data?.prompt_id) activePrompt = String(value.data.prompt_id);
      if (
        value.type !== "progress" ||
        activePrompt !== job() ||
        !Number.isFinite(value.data?.value) ||
        !Number.isFinite(value.data?.max) ||
        value.data.max <= 0 ||
        signal.aborted
      )
        return;
      const at = Date.now();
      if (at - lastAt < 1000 && value.data.value < value.data.max) return;
      lastAt = at;
      progress(Math.max(0, Math.min(100, Math.round((value.data.value / value.data.max) * 100))));
    } catch {
      /* Progress data cannot become instructions or abort another job. */
    }
  };
  const close = () => {
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
      /* Already closed. */
    }
  };
  signal.addEventListener("abort", close, { once: true });
  return () => {
    signal.removeEventListener("abort", close);
    close();
  };
}

/** Shared runtime probe. Calling this does not generate an image or enable a feature. */
export async function probeNativeCodexImageCapability(
  directory: string,
  authorize?: () => Promise<void>,
) {
  return codexImages(directory, authorize).capability();
}

/** API keys or a local ComfyUI workflow make the Host image-capable without native Codex. */
export async function configuredImageProviderAvailable(
  directory: string,
  authorize?: () => Promise<void>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const { codex: _native, ...configured } = createSocialImageAdapters(directory, env);
  for (const adapter of Object.values(configured)) {
    await authorize?.();
    if ((await adapter.capability().catch(() => undefined))?.available) return true;
  }
  return false;
}

export function createSocialImageAdapters(
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
): SocialImageAdapters {
  const adapters: SocialImageAdapters = { codex: codexImages(directory) };
  if (env.GEMINI_API_KEY && env.BYCODA_SOCIAL_GEMINI_IMAGE_MODEL) {
    const key = env.GEMINI_API_KEY,
      model = env.BYCODA_SOCIAL_GEMINI_IMAGE_MODEL;
    adapters.gemini = {
      async capability() {
        try {
          const info = await json(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
            { headers: { "x-goog-api-key": key } },
            AbortSignal.timeout(5000),
          );
          const available =
            /image/i.test(info.name ?? model) &&
            (info.supportedGenerationMethods ?? []).includes("generateContent");
          return {
            provider: "gemini",
            available,
            reason: available
              ? ""
              : "The configured model does not expose supported image generation.",
            models: available ? [model] : [],
          };
        } catch {
          return {
            provider: "gemini",
            available: false,
            reason: "Gemini model/authentication could not be verified.",
            models: [],
          };
        }
      },
      async generate(i) {
        const chosen = i.model ?? model;
        if (!/^[a-zA-Z0-9._-]+$/.test(chosen))
          throw new ImageGenerationError("invalid", "Invalid Gemini image model.");
        const data = await json(
          `https://generativelanguage.googleapis.com/v1beta/models/${chosen}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": key,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: i.prompt }] }],
              generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio: i.aspectRatio },
              },
            }),
          },
          i.signal,
        );
        if (
          data.promptFeedback?.blockReason ||
          data.candidates?.some((c: any) =>
            ["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT"].includes(c.finishReason),
          )
        )
          throw new ImageGenerationError("refused", "Gemini refused the image.");
        const image = data.candidates?.[0]?.content?.parts?.find((p: any) =>
          p.inlineData?.mimeType?.startsWith("image/"),
        )?.inlineData;
        if (!image?.data) throw new ImageGenerationError("invalid", "Gemini returned no image.");
        return { bytes: Buffer.from(image.data, "base64"), model: chosen };
      },
    };
  }
  if (env.OPENAI_API_KEY && env.BYCODA_SOCIAL_OPENAI_IMAGE_MODEL) {
    const key = env.OPENAI_API_KEY,
      model = env.BYCODA_SOCIAL_OPENAI_IMAGE_MODEL;
    adapters["openai-api"] = {
      async capability() {
        try {
          const info = await json(
            `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
            { headers: { Authorization: `Bearer ${key}` } },
            AbortSignal.timeout(5000),
          );
          const available = info.id === model && /^gpt-image-/i.test(model);
          return {
            provider: "openai-api",
            available,
            reason: available
              ? "Separately billed API; explicit selection only. Supports 1:1 in this adapter."
              : "The configured image model is unsupported.",
            models: available ? [model] : [],
          };
        } catch {
          return {
            provider: "openai-api",
            available: false,
            reason: "Image API model/authentication could not be verified.",
            models: [],
          };
        }
      },
      async generate(i) {
        if (i.aspectRatio !== "1:1")
          throw new ImageGenerationError(
            "unavailable",
            "This paid API adapter currently supports 1:1 images. Select Gemini or a configured ComfyUI workflow for other ratios.",
          );
        const chosen = i.model ?? model;
        const data = await json(
          "https://api.openai.com/v1/images/generations",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: chosen,
              prompt: i.prompt,
              n: 1,
              size: "1024x1024",
              output_format: "png",
            }),
          },
          i.signal,
        );
        if (!data.data?.[0]?.b64_json)
          throw new ImageGenerationError("invalid", "Image API returned no artifact.");
        return {
          bytes: Buffer.from(data.data[0].b64_json, "base64"),
          model: chosen,
        };
      },
    };
  }
  if (env.BYCODA_SOCIAL_COMFYUI_ENDPOINT && env.BYCODA_SOCIAL_COMFYUI_WORKFLOW) {
    let endpoint: string;
    const workflowPath = env.BYCODA_SOCIAL_COMFYUI_WORKFLOW;
    try {
      endpoint = localEndpoint(env.BYCODA_SOCIAL_COMFYUI_ENDPOINT);
      if (!isAbsolute(workflowPath)) throw new Error("Absolute workflow path required.");
    } catch {
      adapters.comfyui = {
        capability: async () => ({
          provider: "comfyui",
          available: false,
          reason: "Select a loopback endpoint and an absolute workflow path on this executor.",
          models: [],
        }),
        generate: async () => {
          throw new ImageGenerationError("unavailable", "ComfyUI configuration is invalid.");
        },
      };
      return adapters;
    }
    adapters.comfyui = {
      async capability() {
        try {
          const info = await json(`${endpoint}/object_info`, {}, AbortSignal.timeout(5000));
          const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
          const valid =
            Object.values(workflow).length > 0 &&
            Object.values(workflow).every((n: any) => info[n.class_type]);
          const choices: string[][] = Object.values(workflow).flatMap((n: any) =>
            Object.entries(n.inputs ?? {})
              .filter(([, value]) => value === "{{model}}")
              .map(([key]) => {
                const values = info[n.class_type]?.input?.required?.[key]?.[0];
                return Array.isArray(values)
                  ? values.filter((x: unknown) => typeof x === "string")
                  : [];
              }),
          );
          const models = choices.length
            ? choices.reduce((common, next) => common.filter((model) => next.includes(model)))
            : [env.BYCODA_SOCIAL_COMFYUI_MODEL ?? "configured-flux"];
          return {
            provider: "comfyui",
            available: valid && models.length > 0,
            reason: valid ? "" : "Workflow requires missing nodes.",
            models: valid ? models : [],
          };
        } catch {
          return {
            provider: "comfyui",
            available: false,
            reason: "Selected local ComfyUI/workflow is unavailable.",
            models: [],
          };
        }
      },
      async generate(i) {
        const capability = await adapters.comfyui!.capability();
        const chosen = i.model ?? env.BYCODA_SOCIAL_COMFYUI_MODEL ?? capability.models[0];
        if (!capability.available || !chosen || !capability.models.includes(chosen))
          throw new ImageGenerationError(
            "unavailable",
            "Select the model installed in the saved ComfyUI workflow.",
          );
        let jobId = i.providerJobId;
        const stopProgress = comfyProgress(endpoint, i.id, () => jobId, i.progress, i.signal);
        try {
          if (!jobId) {
            // Only substitute named value placeholders in an owner-maintained API workflow.
            const template = JSON.parse(await readFile(workflowPath, "utf8"));
            const substitute = (v: any): any =>
              v === "{{model}}"
                ? chosen
                : v === "{{prompt}}"
                  ? i.prompt
                  : v === "{{width}}"
                    ? i.aspectRatio === "16:9"
                      ? 1280
                      : 1024
                    : v === "{{height}}"
                      ? i.aspectRatio === "4:5"
                        ? 1280
                        : i.aspectRatio === "16:9"
                          ? 720
                          : 1024
                      : Array.isArray(v)
                        ? v.map(substitute)
                        : v && typeof v === "object"
                          ? Object.fromEntries(
                              Object.entries(v).map(([k, val]) => [k, substitute(val)]),
                            )
                          : v;
            const data = await json(
              `${endpoint}/prompt`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  prompt: substitute(template),
                  client_id: i.id,
                }),
              },
              i.signal,
            );
            if (!data.prompt_id)
              throw new ImageGenerationError("invalid", "ComfyUI rejected the saved workflow.");
            jobId = String(data.prompt_id);
            await i.checkpoint(jobId);
          }
          while (true) {
            i.signal.throwIfAborted();
            const data = await json(
                `${endpoint}/history/${encodeURIComponent(jobId)}`,
                {},
                i.signal,
              ),
              entry = data[jobId];
            if (entry?.status?.status_str === "error")
              throw new ImageGenerationError("invalid", "ComfyUI workflow failed.");
            const file = Object.values(entry?.outputs ?? {}).flatMap(
              (o: any) => o.images ?? [],
            )[0] as any;
            if (file) {
              const bytes = await imageHttpBytes(
                `${endpoint}/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" })}`,
                {},
                i.signal,
                5 * 1024 * 1024,
              );
              return {
                bytes,
                model: chosen,
              };
            }
            await wait(i.signal);
          }
        } catch (error) {
          if (
            jobId &&
            error instanceof ImageGenerationError &&
            (error.kind === "transient" || error.kind === "unavailable")
          )
            throw new ImageGenerationError(
              "uncertain",
              "The accepted ComfyUI job is still unresolved. Resume its original provider job before retrying generation.",
            );
          throw error;
        } finally {
          stopProgress();
        }
      },
    };
  }
  return adapters;
}

export async function generateSocialImage(
  adapters: SocialImageAdapters,
  selection: ProgramConfig["image"],
  input: Omit<ImageRequest, "model">,
  transition: (message: string) => void | Promise<void>,
  beforeAttempt: (provider: Exclude<ImageProvider, "automatic">) => void | Promise<void> = () => {},
): Promise<ImageResult & { provider: Exclude<ImageProvider, "automatic"> }> {
  const order: Exclude<ImageProvider, "automatic">[] =
    selection.provider === "automatic" ? ["codex", "gemini", "comfyui"] : [selection.provider];
  for (const provider of order) {
    input.signal.throwIfAborted();
    const adapter = adapters[provider],
      cap = await adapter?.capability();
    if (!adapter || !cap?.available) {
      await transition(`${provider}: unavailable`);
      continue;
    }
    await beforeAttempt(provider);
    let acceptingProgress = true;
    let progress = Promise.resolve();
    let progressFailed = false;
    let progressError: unknown;
    const reportProgress = input.progress;
    try {
      const result = await adapter.generate({
        ...input,
        progress: reportProgress
          ? (percent) => {
              if (!acceptingProgress) return Promise.resolve();
              const pending = progress.then(() => reportProgress(percent));
              progress = pending.catch((error) => {
                if (!progressFailed) {
                  progressFailed = true;
                  progressError = error;
                }
              });
              return pending;
            }
          : undefined,
        model: selection.provider === "automatic" ? undefined : selection.model,
      });
      acceptingProgress = false;
      await progress;
      if (progressFailed) throw progressError;
      return { ...result, provider };
    } catch (error) {
      acceptingProgress = false;
      await progress;
      if (progressFailed) throw progressError;
      if (
        input.signal.aborted ||
        !(error instanceof ImageGenerationError) ||
        !["unavailable", "transient"].includes(error.kind) ||
        selection.provider !== "automatic"
      )
        throw error;
      await transition(`${provider}: ${error.kind}`);
    }
  }
  throw new ImageGenerationError(
    "unavailable",
    "No selected image provider is available on this executor.",
  );
}
