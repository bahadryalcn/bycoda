import {
  AppearanceBackgroundImageParamsSchema,
  AppearanceBackgroundSuggestionsParamsSchema,
  AppearanceThemeSuggestionsParamsSchema,
} from "../../src/shared/model/host-contracts/appearance";
import { generateAppearanceBackgroundImage } from "../appearance/background-image";
import { generateBackgroundSuggestion } from "../appearance/background-suggestions";
import { generateThemeSuggestions } from "../appearance/theme-suggestions";
import type { OwnerRpcRequest } from "./owner-rpc-context";

export async function handleAppearanceRpc(_dependencies: unknown, request: OwnerRpcRequest) {
  switch (request.input.method) {
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
