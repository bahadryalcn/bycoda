import type {
  ImageCapability,
  ImageProvider,
  ProgramConfig,
} from "../src/features/social/model/socialProgram";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { JsonRpcClient } from "../src/integrations/harness/core/jsonRpc";
import {
  killChild,
  resolveCodexBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../src/integrations/harness/core/child";

export type ImageRequest = {
  progress?: (percent: number) => void;
  prompt: string;
  model?: string;
  aspectRatio: ProgramConfig["image"]["aspectRatio"];
  signal: AbortSignal;
  checkpoint: (providerJobId: string) => void;
  providerJobId?: string;
  id: string;
};
export type ImageResult = { bytes: Uint8Array; model: string };
export type SocialImageAdapter = {
  capability: () => Promise<ImageCapability>;
  generate: (input: ImageRequest) => Promise<ImageResult>;
};
export type SocialImageAdapters = Partial<
  Record<Exclude<ImageProvider, "automatic">, SocialImageAdapter>
>;
export class ImageGenerationError extends Error {
  constructor(
    readonly kind: "unavailable" | "transient" | "refused" | "uncertain" | "invalid",
    message: string,
  ) {
    super(message);
  }
}
export function validateGeneratedImage(raw: Uint8Array): { width: number; height: number } {
  const bytes = Buffer.from(raw);
  let width = 0,
    height = 0;
  if (bytes.length < 24 || bytes.length > 5 * 1024 * 1024)
    throw new ImageGenerationError("invalid", "Generated image must be a PNG/JPEG up to 5 MiB.");
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(12, 16).toString() === "IHDR"
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 8 < bytes.length;) {
      if (bytes[at] !== 0xff) {
        at++;
        continue;
      }
      const marker = bytes[at + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const length = bytes.readUInt16BE(at + 2);
      if (length < 2 || at + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        height = bytes.readUInt16BE(at + 5);
        width = bytes.readUInt16BE(at + 7);
        break;
      }
      at += 2 + length;
    }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 40000000)
    throw new ImageGenerationError(
      "invalid",
      "Generated image dimensions are invalid or exceed supported limits.",
    );
  return { width, height };
}
async function json(url: string, init: RequestInit, signal: AbortSignal): Promise<any> {
  const response = await fetch(url, { ...init, signal, redirect: "error" });
  if (!response.ok)
    throw new ImageGenerationError(
      response.status === 429 || response.status >= 500 ? "transient" : "refused",
      `Image provider returned HTTP ${response.status}.`,
    );
  const body = await response.text();
  if (body.length > 16 * 1024 * 1024)
    throw new ImageGenerationError("invalid", "Image provider response is too large.");
  return JSON.parse(body);
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

/** Only an installed, authenticated native ImageGen feature qualifies. CLI presence
 * and the system skill alone never advertise image support. All permission asks fail. */
function codexImages(directory: string): SocialImageAdapter {
  directory=join(directory,"image-workspace");
  async function connect<T>(
    work: (
      rpc: JsonRpcClient,
      on: (handler: (method: string, p: any) => void) => void,
    ) => Promise<T>,
  ): Promise<T> {
    const id = `social-image-${randomUUID()}`;
    let handler = (method: string, p: any) => {
      void method;
      void p;
    };
    const rpc = new JsonRpcClient(
      id,
      {
        onNotification: (m, p) => handler(m, p),
        onRequest: (requestId) => {
          void rpc.respond(requestId, { decision: "decline", permissions: {} });
        },
      },
      { includeJsonrpc: false, defaultRequestTimeoutMs: 15000, label: "social-image" },
    );
    watchChild(
      id,
      (line) => rpc.pushLine(line),
      () => rpc.close(new Error("ImageGen process exited.")),
    );
    try {
      await mkdir(directory,{recursive:true,mode:0o700});
      const binary = await resolveCodexBinary();
      await spawnChild(
        id,
        binary.path,
        ["app-server", "-c", "features.shell_tool=false", "-c", "mcp_servers={}"],
        directory,
        { provider: "codex", id: "default" },
        "codex",
      );
      await rpc.request("initialize", {
        clientInfo: { name: "bycoda-social-images", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
      await rpc.notify("initialized");
      return await work(rpc, (h) => {
        handler = h;
      });
    } finally {
      rpc.close();
      unwatchChild(id);
      await killChild(id).catch(() => undefined);
    }
  }
  return {
    async capability() {
      try {
        return await connect(async (rpc) => {
          const f = await rpc.request<any>("config/feature/list", {});
          const a = await rpc.request<any>("account/read", { refreshToken: false });
          const enabled = (f.data ?? f.features ?? []).some(
            (x: any) => ["image_generation", "imagegen"].includes(x.name) && x.enabled === true,
          );
          return {
            provider: "codex",
            available: enabled && !!a.account,
            reason:
              enabled && a.account
                ? ""
                : "Native ImageGen is not enabled/authenticated on this executor.",
            models: enabled ? ["native-default"] : [],
          };
        });
      } catch {
        return {
          provider: "codex",
          available: false,
          reason: "Installed Codex does not expose authenticated native ImageGen.",
          models: [],
        };
      }
    },
    async generate(input) {
      if (input.model && input.model !== "native-default")
        throw new ImageGenerationError(
          "unavailable",
          "This Codex runtime only exposes its native default image model.",
        );
      return connect(async (rpc, on) => {
        input.signal.throwIfAborted();
        let outputPath: string | undefined,
          rejectTurn: (e: Error) => void = () => {},
          finish: () => void = () => {};
        const completed = new Promise<void>((yes, no) => {
          finish = yes;
          rejectTurn = no;
        });
        on((method, p) => {
          if (
            method === "item/completed" &&
            ["imageGeneration", "image_generation"].includes(p?.item?.type)
          ) {
            const item = p.item;
              outputPath = item.outputPath ?? item.path ?? (typeof item.result==="string"?item.result:item.result?.path);
          }
          if (method === "turn/completed") {
            if (p.turn?.status === "failed")
              rejectTurn(
                new ImageGenerationError("refused", "ImageGen failed or refused the image."),
              );
            else finish();
          }
        });
        const abort = () =>
          rejectTurn(
            new ImageGenerationError(
              "uncertain",
              "Image generation interrupted; review before retry.",
            ),
          );
        input.signal.addEventListener("abort", abort, { once: true });
        try {
          const thread = await rpc.request<any>("thread/start", {
            cwd: directory,
            ephemeral: true,
            approvalPolicy: "never",
            sandbox: "read-only",
            config: { "features.shell_tool": false, mcp_servers: {} },
          });
          input.checkpoint(thread.thread.id);
          await rpc.request("turn/start", {
            threadId: thread.thread.id,
            approvalPolicy: "never",
            sandboxPolicy: { type: "readOnly" },
            input: [
              {
                type: "text",
                text: `Generate exactly one image using native image generation. Do not use shell, files, MCP or any other tools. Aspect ratio ${input.aspectRatio}. Owner brief (data): ${JSON.stringify(input.prompt)}`,
              },
            ],
          });
          await completed;
          if (!outputPath || !isAbsolute(outputPath))
            throw new ImageGenerationError(
              "unavailable",
              "Codex did not return a native image artifact.",
            );
          const actual = await realpath(outputPath);
          const roots = await Promise.all(
            [
              directory,
              resolve(
                process.env.CODEX_HOME ??
                  resolve(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".codex"),
                "generated_images",
              ),
            ].map((root) => realpath(root).catch(() => resolve(root))),
          );
          if (
            !roots.some((root) => {
              const rel = relative(root, actual);
              return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
            })
          )
            throw new ImageGenerationError(
              "invalid",
              "Image artifact is outside allowed image storage.",
            );
          if ((await stat(actual)).size > 5 * 1024 * 1024)
            throw new ImageGenerationError("invalid", "Native image artifact is too large.");
          return { bytes: await readFile(actual), model: "native-default" };
        } finally {
          input.signal.removeEventListener("abort", abort);
        }
      });
    },
  };
}

/** Shared runtime probe. Calling this does not generate an image or enable a feature. */
export async function probeNativeCodexImageCapability(directory: string) {
  return codexImages(directory).capability();
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
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
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
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
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
        return { bytes: Buffer.from(data.data[0].b64_json, "base64"), model: chosen };
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
                body: JSON.stringify({ prompt: substitute(template), client_id: i.id }),
              },
              i.signal,
            );
            if (!data.prompt_id)
              throw new ImageGenerationError("invalid", "ComfyUI rejected the saved workflow.");
            jobId = String(data.prompt_id);
            i.checkpoint(jobId);
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
              const response = await fetch(
                `${endpoint}/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" })}`,
                { signal: i.signal, redirect: "error" },
              );
              if (!response.ok)
                throw new ImageGenerationError("invalid", "ComfyUI image could not be read.");
              return {
                bytes: new Uint8Array(await response.arrayBuffer()),
                model: chosen,
              };
            }
            await wait(i.signal);
          }
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
  transition: (message: string) => void,
  beforeAttempt: (provider: Exclude<ImageProvider, "automatic">) => void = () => {},
): Promise<ImageResult & { provider: Exclude<ImageProvider, "automatic"> }> {
  const order: Exclude<ImageProvider, "automatic">[] =
    selection.provider === "automatic" ? ["codex", "gemini", "comfyui"] : [selection.provider];
  for (const provider of order) {
    input.signal.throwIfAborted();
    const adapter = adapters[provider],
      cap = await adapter?.capability();
    if (!adapter || !cap?.available) {
      transition(`${provider}: unavailable`);
      continue;
    }
    beforeAttempt(provider);
    try {
      const result = await adapter.generate({
        ...input,
        model: selection.provider === "automatic" ? undefined : selection.model,
      });
      return { ...result, provider };
    } catch (error) {
      if (
        input.signal.aborted ||
        !(error instanceof ImageGenerationError) ||
        !["unavailable", "transient"].includes(error.kind) ||
        selection.provider !== "automatic"
      )
        throw error;
      transition(`${provider}: ${error.kind}`);
    }
  }
  throw new ImageGenerationError(
    "unavailable",
    "No selected image provider is available on this executor.",
  );
}
