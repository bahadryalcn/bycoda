import { randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import type { ImageProvider } from "../../src/features/social/model/socialProgram";
import {
  createSocialImageAdapters,
  generateSocialImage,
  ImageGenerationError,
  validateGeneratedImage,
  type SocialImageAdapters,
} from "../social/social-images";
import { antigravityImageModel, listImageModels } from "../images/image-models";
import { generateAntigravityImage } from "../images/antigravity-images";
import type { Session } from "../../src/features/sessions/model/session";
import { imageModelAllowed } from "../../src/shared/model/host-contracts/image-models";
import type { HostStore } from "../store";
import type { SessionRunEngine } from "../sessions/sessionRuns";
import { writeFileAtomic } from "../storage/atomic-write";
import { existingPath, workspacePath } from "../workspaces/workspace";

type Provider = Exclude<ImageProvider, "automatic">;
const PROVIDERS: Provider[] = ["codex", "gemini", "comfyui", "openai-api"];
/** Agents generate within this per-session count; the owner chose budgeted, approval-free use. */
export const MAX_IMAGES_PER_SESSION = 12;
/** The adapters stop their own HTTP work at 180 s; this also bounds a Codex turn. */
const TIMEOUT_MS = 200_000;

export const CONVERSATION_IMAGE_TOOLS = {
  "images.status": { type: "object", properties: {}, additionalProperties: false },
  "images.generate": {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        maxLength: 4000,
        description: "Visual description of one image. Ask for no text unless the asset needs it.",
      },
      path: {
        type: "string",
        minLength: 1,
        maxLength: 4096,
        description:
          "New workspace-relative .png or .jpg path inside your write scope, such as games/snake/assets/menu.png. Existing files are never overwritten.",
      },
      aspectRatio: { enum: ["1:1", "4:5", "16:9"], description: "Default 1:1." },
      provider: {
        enum: ["automatic", ...PROVIDERS, "antigravity"],
        description:
          "Default automatic: the session's selected models, Codex, then Gemini, then ComfyUI, then Nano Banana (antigravity).",
      },
      model: { type: "string", maxLength: 200, description: "Only with an explicit provider." },
    },
    required: ["prompt", "path"],
    additionalProperties: false,
  },
} as const;
export const isImageConversationTool = (action: string) =>
  Object.hasOwn(CONVERSATION_IMAGE_TOOLS, action);

export function describeImageConversationTool(action: string) {
  if (action === "images.status")
    return "List the image models this Host can reach (Codex ImageGen, Nano Banana through Antigravity, Gemini/OpenAI APIs, local ComfyUI) with availability, how to call each (access), output formats, strengths and limits. Call it before planning work that needs generated assets. access images.generate means this tool; antigravity-member means an Antigravity member calls its built-in generate_image tool. Vector or animated assets (SVG, GIF) come from code, for example by a Codex member.";
  if (action === "images.generate")
    return `Generate one raster image (icon, sprite, background, illustration) with a Host image provider and save it as a new workspace file. Only the image models selected for this session (images.status marks them); antigravity runs Nano Banana in a child Antigravity session that may ask for approval. No owner approval per image, at most ${MAX_IMAGES_PER_SESSION} images per conversation. Returns the saved path, provider, model and pixel size. Inspect the file before referencing it; report the provider in your handoff.`;
}

const used = new Map<string, number>();

type ImageSession = Pick<Session, "id" | "modelSettings" | "runtimeMode" | "worktreeCwd">;

/** Image providers stay Host-owned; agents choose only prompt, file, ratio and provider. */
export async function callImageConversationTool(
  root: string,
  action: string,
  input: Record<string, unknown>,
  options: {
    session: ImageSession;
    projectId: string;
    engine: SessionRunEngine & { store: HostStore };
    authorized: () => Promise<boolean>;
    adapters?: SocialImageAdapters;
    /** The Antigravity model that runs generate_image, or undefined when unavailable. */
    antigravity?: () => Promise<string | undefined>;
    runAntigravity?: typeof generateAntigravityImage;
  },
) {
  const check = async () => {
    if (!(await options.authorized())) throw new Error("Image authority was revoked.");
  };
  await check();
  const { session } = options;
  const allowed = (id: string) => imageModelAllowed(session.modelSettings, id);
  const antigravity = options.antigravity ?? (() => antigravityImageModel());
  const all =
    options.adapters ??
    createSocialImageAdapters(join(dirname(options.engine.store.attachmentDir), "images"));
  if (action === "images.status")
    return {
      models: (await listImageModels(all, async () => !!(await antigravity()))).map((model) => ({
        ...model,
        selected: allowed(model.provider),
      })),
      remaining: Math.max(0, MAX_IMAGES_PER_SESSION - (used.get(session.id) ?? 0)),
    };
  if (action !== "images.generate") throw new Error("Unknown image action.");
  const target = workspacePath(root, input.path);
  const extension = extname(target).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(extension))
    throw new Error("Image path must end with .png, .jpg or .jpeg.");
  if (await exists(target))
    throw new Error("A file already exists at this path; choose a new name.");
  const count = used.get(session.id) ?? 0;
  if (count >= MAX_IMAGES_PER_SESSION)
    throw new Error(`Image limit reached (${MAX_IMAGES_PER_SESSION} per conversation).`);
  const provider = String(input.provider ?? "automatic");
  if (input.model !== undefined && provider === "automatic")
    throw new Error("Choose an explicit provider to select a model.");
  if (provider !== "automatic" && !allowed(provider))
    throw new Error(
      `${provider} is not selected for this session; images.status lists the selected models.`,
    );
  // The session's selection narrows every provider the Host may try.
  const adapters = Object.fromEntries(
    Object.entries(all).filter(([id]) => allowed(id)),
  ) as SocialImageAdapters;
  const aspectRatio = (input.aspectRatio ?? "1:1") as "1:1" | "4:5" | "16:9";
  // Counting before the call keeps a failed or uncertain generation inside the budget.
  used.set(session.id, count + 1);
  await mkdir(dirname(target), { recursive: true });
  // Resolve the parent through links so a symlinked folder cannot leave the workspace.
  await existingPath(root, relative(root, dirname(target)), true);
  const nanoBanana = async () => {
    const model = allowed("antigravity") ? await antigravity() : undefined;
    if (!model) throw new Error("Nano Banana (Antigravity) is not available or not selected.");
    await check();
    const result = await (options.runAntigravity ?? generateAntigravityImage)({
      store: options.engine.store,
      engine: options.engine,
      projectId: options.projectId,
      parent: session,
      model,
      prompt: String(input.prompt),
      aspectRatio,
      target,
    });
    const size = validateGeneratedImage(result.bytes);
    return {
      path: relative(root, target).split("\\").join("/"),
      provider: "antigravity",
      model,
      ...size,
    };
  };
  if (provider === "antigravity") return await nanoBanana();
  const transitions: string[] = [];
  let result;
  try {
    result = await generateSocialImage(
      adapters,
      {
        mode: "generate",
        provider: provider as ImageProvider,
        model: typeof input.model === "string" ? input.model : undefined,
        aspectRatio,
        media: [],
      },
      {
        prompt: String(input.prompt),
        aspectRatio,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        checkpoint: () => undefined,
        id: randomUUID(),
      },
      (message) => {
        transitions.push(message);
      },
    );
  } catch (error) {
    // Automatic falls through to Nano Banana only when no Host provider could run.
    if (
      provider === "automatic" &&
      error instanceof ImageGenerationError &&
      error.kind === "unavailable" &&
      allowed("antigravity") &&
      (await antigravity())
    )
      return await nanoBanana();
    throw error;
  }
  const size = validateGeneratedImage(result.bytes);
  const bytes = Buffer.from(result.bytes);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  // Keep the generated image when the provider's format differs from the requested name.
  const saved =
    jpeg === (extension !== ".png")
      ? target
      : target.slice(0, -extension.length) + (jpeg ? ".jpg" : ".png");
  await check();
  if (await exists(saved))
    throw new Error("A file appeared at this path during generation; choose a new name.");
  await writeFileAtomic(saved, bytes);
  return {
    path: relative(root, saved).split("\\").join("/"),
    provider: result.provider,
    model: result.model,
    ...size,
    ...(transitions.length ? { skipped: transitions } : {}),
  };
}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );
