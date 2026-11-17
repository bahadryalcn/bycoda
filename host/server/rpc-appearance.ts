import {
  AppearanceCreateDesignParamsSchema,
  AppearanceCancelDesignParamsSchema,
  AppearanceBackgroundImageParamsSchema,
  AppearanceBackgroundSuggestionsParamsSchema,
  AppearanceThemeSuggestionsParamsSchema,
} from "../../src/shared/model/host-contracts/appearance";
import { generateAppearanceBackgroundImage } from "../appearance/background-image";
import { generateBackgroundSuggestion } from "../appearance/background-suggestions";
import { generateThemeSuggestions } from "../appearance/theme-suggestions";
import { createAppearanceDesign, cancelAppearanceDesign } from "../appearance/create-design";
import type { OwnerRpcRequest } from "./owner-rpc-context";

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
    case "appearance.themeSuggestions":
      request.result = await generateThemeSuggestions(
        AppearanceThemeSuggestionsParamsSchema.parse(request.params),
      );
      break;
    case "appearance.backgroundSuggestions":
      request.result = await generateBackgroundSuggestion(
        AppearanceBackgroundSuggestionsParamsSchema.parse(request.params),
      );
      break;
    case "appearance.backgroundImage":
      request.result = await generateAppearanceBackgroundImage(
        AppearanceBackgroundImageParamsSchema.parse(request.params),
      );
      break;
    default:
      throw new Error("Unsupported host method");
  }
}
