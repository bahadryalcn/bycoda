import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { JsonRpcClient } from "../../src/integrations/harness/core/jsonRpc";
import {
  createChildProcessHandle,
  killChild,
  resolveCodexBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../src/integrations/harness/core/child";
import {
  ImageGenerationError,
  validateGeneratedImage,
  type SocialImageAdapter,
} from "./social-image-core";

/** Only an installed, authenticated native ImageGen feature qualifies. CLI presence
 * and the system skill alone never advertise image support. All permission asks fail. */
class ImageProbeAuthorizationError extends Error {
  constructor(readonly failure: unknown) {
    super("Image capability authorization failed.");
  }
}

export function codexImages(
  directory: string,
  authorize?: () => Promise<void>,
): SocialImageAdapter {
  directory = join(directory, "image-workspace");
  const checkAuthority = async () => {
    try {
      await authorize?.();
    } catch (error) {
      throw new ImageProbeAuthorizationError(error);
    }
  };
  async function connect<T>(
    work: (
      rpc: JsonRpcClient,
      on: (handler: (method: string, p: any) => void) => void,
    ) => Promise<T>,
  ): Promise<T> {
    const id = `social-image-${randomUUID()}`;
    const imageProcess = createChildProcessHandle(id);
    let handler = (method: string, p: any) => {
      void method;
      void p;
    };
    const rpc = new JsonRpcClient(
      imageProcess,
      {
        onNotification: (m, p) => handler(m, p),
        onRequest: (requestId) => {
          void rpc
            .respond(requestId, { decision: "decline", permissions: {} })
            .catch(() => undefined);
        },
      },
      {
        includeJsonrpc: false,
        defaultRequestTimeoutMs: 15000,
        label: "social-image",
      },
    );
    watchChild(
      imageProcess,
      (line) => rpc.pushLine(line),
      () => rpc.close(new Error("ImageGen process exited.")),
    );
    try {
      await checkAuthority();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await checkAuthority();
      const binary = await resolveCodexBinary();
      await checkAuthority();
      await spawnChild(
        imageProcess,
        binary.path,
        ["app-server", "-c", "features.shell_tool=false", "-c", "mcp_servers={}"],
        directory,
        { provider: "codex", id: "default" },
        "codex",
        undefined,
        undefined,
        checkAuthority,
      );
      await checkAuthority();
      await rpc.request("initialize", {
        clientInfo: { name: "bycoda-social-images", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
      await checkAuthority();
      await rpc.notify("initialized");
      return await work(rpc, (h) => {
        handler = h;
      });
    } finally {
      rpc.close();
      unwatchChild(imageProcess);
      await killChild(imageProcess).catch(() => undefined);
    }
  }
  return {
    async capability() {
      try {
        return await connect(async (rpc) => {
          await checkAuthority();
          // Codex app-server lists feature flags (stable ones included) via experimentalFeature/list.
          const features: any[] = [];
          let cursor: string | null | undefined;
          for (let page = 0; page < 5; page++) {
            const f: any = await rpc.request<any>("experimentalFeature/list", {
              limit: 500,
              ...(cursor ? { cursor } : {}),
            });
            await checkAuthority();
            features.push(...(f.data ?? f.features ?? []));
            cursor = f.nextCursor;
            if (!cursor) break;
          }
          const a = await rpc.request<any>("account/read", {
            refreshToken: false,
          });
          await checkAuthority();
          const enabled = features.some(
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
      } catch (error) {
        if (error instanceof ImageProbeAuthorizationError) throw error.failure;
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
          inlineImage: string | undefined,
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
            // Codex 0.16x returns the image inline as base64 in `result`; older builds wrote a file.
            const result = typeof item.result === "string" ? item.result : undefined;
            outputPath =
              item.outputPath ??
              item.savedPath ??
              item.path ??
              (result && isAbsolute(result) ? result : item.result?.path);
            if (result && !isAbsolute(result)) inlineImage = result;
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
          await input.checkpoint(thread.thread.id);
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
          // Prefer the inline bytes: a savedPath may sit outside the allowed image roots.
          if (inlineImage) return decodeInlineCodexImage(inlineImage);
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
          if ((await stat(actual)).size > MAX_NATIVE_IMAGE_BYTES)
            throw new ImageGenerationError("invalid", "Native image artifact is too large.");
          return { bytes: await readFile(actual), model: "native-default" };
        } finally {
          input.signal.removeEventListener("abort", abort);
        }
      });
    },
  };
}

const MAX_NATIVE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Decodes Codex's inline base64 image result; `validateGeneratedImage` enforces format and size. */
export function decodeInlineCodexImage(base64: string): {
  bytes: Buffer;
  model: string;
} {
  if (base64.length > Math.ceil((MAX_NATIVE_IMAGE_BYTES * 4) / 3) + 4)
    throw new ImageGenerationError("invalid", "Native image artifact is too large.");
  const bytes = Buffer.from(base64, "base64");
  validateGeneratedImage(bytes);
  return { bytes, model: "native-default" };
}
