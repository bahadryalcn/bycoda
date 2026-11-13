import { resolveHelperModel } from "../../model-routing/public/helpers";
import type { TranslationContext } from "./translation";
import { defaultSessionChoice, preferredModelSettings, resolveModel } from "./models";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";

export type TranslationChoice = Required<Pick<TranslationContext, "harness" | "model">> &
  Pick<TranslationContext, "modelSettings" | "providerAccountId">;

/** The same global default shown in Settings, independent of the calling conversation. */
export function defaultTextActionChoice(): TranslationChoice {
  const choice = defaultSessionChoice();
  return {
    ...choice,
    modelSettings: preferredModelSettings(resolveModel(choice.harness, choice.model)),
    providerAccountId: supportsProviderAccounts(choice.harness)
      ? defaultProviderAccountId(choice.harness)
      : undefined,
  };
}

/** Keep execution on the calling session's machine and project. */
export function translationContextWithDefault(context: TranslationContext): TranslationContext {
  const choice = defaultTextActionChoice();
  return {
    ...context,
    ...choice,
    // A conversation account is a separate pin; an unpinned action uses the provider default.
    providerAccountId: supportsProviderAccounts(choice.harness)
      ? (choice.providerAccountId ?? defaultProviderAccountId(choice.harness))
      : undefined,
  };
}

/** Resolve once before a helper request; preserve project and machine context. */
export async function resolveTranslationContext(
  context: TranslationContext,
  action: "translation" | "reprompt" = "translation",
) {
  const target = await resolveHelperModel(`text.${action}`, {
    cwd: context.cwd,
  });
  return target ? { ...context, ...target } : translationContextWithDefault(context);
}

/** Resolve routing in the query callback, outside render. */
export function queryTranslationContext({
  queryKey: [, context, action],
}: {
  queryKey: readonly [string, TranslationContext, "translation" | "reprompt"];
}) {
  return resolveTranslationContext(context, action);
}
