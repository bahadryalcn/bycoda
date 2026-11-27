import {
  AppearanceCreateDesignParamsSchema,
  AppearanceCancelDesignParamsSchema,
  AppearanceBackgroundImageParamsSchema,
  AppearanceBackgroundSuggestionsParamsSchema,
  AppearanceCancelGenerationParamsSchema,
  AppearanceThemeSuggestionsParamsSchema,
} from "../../src/shared/model/host-contracts/appearance";
import { generateAppearanceBackgroundImage } from "../appearance/background-image";
import { generateBackgroundSuggestion } from "../appearance/background-suggestions";
import { generateThemeSuggestions } from "../appearance/theme-suggestions";
import { createAppearanceDesign, cancelAppearanceDesign } from "../appearance/create-design";
import type { OwnerRpcRequest } from "./owner-rpc-context";

const activeGenerations = new Map<string, AbortController>();

/** Correlate cancellation only within the credential that started the generation. */
async function runGeneration<T>(
  request: OwnerRpcRequest,
  generationId: string | undefined,
  run: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  const requestSignal = request.domainContext.signal;
  if (!generationId) return run(requestSignal);
  const key = `${request.tokenHash}:${generationId}`;
  if (activeGenerations.has(key)) throw new Error("Appearance generation is already running.");
  const controller = new AbortController();
  activeGenerations.set(key, controller);
  try {
    return await run(
      requestSignal ? AbortSignal.any([requestSignal, controller.signal]) : controller.signal,
    );
  } finally {
    activeGenerations.delete(key);
  }
}

export async function handleAppearanceRpc(_dependencies: unknown, request: OwnerRpcRequest) {
  switch (request.input.method) {
    case "appearance.createDesign": {
      const controller = new AbortController();
      const abort = () => controller.abort(new Error("Creation authority disconnected"));
      request.response.once("close", abort);
      const monitor = setInterval(() => {
        if (request.pollState.revoked || request.closing) abort();
      }, 500);
      try {
        request.result = await createAppearanceDesign(
          AppearanceCreateDesignParamsSchema.parse(request.params),
          request.tokenHash,
          undefined,
          controller.signal,
        );
      } finally {
        clearInterval(monitor);
        request.response.off("close", abort);
      }
      break;
    }
    case "appearance.cancelDesign":
      request.result = cancelAppearanceDesign(
        AppearanceCancelDesignParamsSchema.parse(request.params).requestId,
        request.tokenHash,
      );
      break;
    case "appearance.themeSuggestions": {
      const params = AppearanceThemeSuggestionsParamsSchema.parse(request.params);
      request.result = await runGeneration(request, params.generationId, (signal) =>
        generateThemeSuggestions(params, undefined, signal),
      );
      break;
    }
    case "appearance.backgroundSuggestions":
      request.result = await generateBackgroundSuggestion(
        AppearanceBackgroundSuggestionsParamsSchema.parse(request.params),
      );
      break;
    case "appearance.backgroundImage": {
      const params = AppearanceBackgroundImageParamsSchema.parse(request.params);
      request.result = await runGeneration(request, params.generationId, (signal) =>
        generateAppearanceBackgroundImage(params, undefined, signal),
      );
      break;
    }
    case "appearance.cancelGeneration": {
      const { generationId } = AppearanceCancelGenerationParamsSchema.parse(request.params);
      const controller = activeGenerations.get(`${request.tokenHash}:${generationId}`);
      controller?.abort();
      request.result = { cancelled: Boolean(controller) };
      break;
    }
    default:
      throw new Error("Unsupported host method");
  }
}
