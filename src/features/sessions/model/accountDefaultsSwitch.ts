import { accountSessionDefaults } from "./accountSessionDefaults";
import {
  loadLastModelSettings,
  preferredModelId,
  preferredModelSettings,
  resolveModel,
} from "./models";
import { loadProjectProviderSettings } from "./projectProviders";
import {
  applySessionDefaults,
  loadGlobalSessionDefaults,
  productSessionDefaults,
  providerSessionDefaults,
} from "./providerSessionDefaults";
import {
  AUTOMATIC_SUBAGENTS,
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  decodeAdvisor,
  decodeSubagents,
} from "../../../shared/model/host-contracts/delegation";
import { runtimeModeForNewSession, type Session } from "./session";

/**
 * A conversation with nothing sent yet that moves to another account adopts that
 * account's own defaults and product delegation follows the selected account.
 */
export function withAccountDefaults(
  session: Session,
  accountId: string,
  sourceAccountId?: string,
): Session {
  if (session.blocks.some((block) => block.role === "user") || session.providerSessionId)
    return session;
  const own = accountSessionDefaults(session.harness, accountId);
  const project = loadProjectProviderSettings(session.cwd);
  if (!Object.keys(own).length) {
    const product = productSessionDefaults(session.harness, accountId).extras;
    const explicit = {
      ...loadLastModelSettings(),
      ...loadGlobalSessionDefaults()[session.harness]?.extras,
      ...(sourceAccountId
        ? accountSessionDefaults(session.harness, sourceAccountId).extras
        : undefined),
      ...project.defaults?.[session.harness]?.extras,
    };
    const settings = { ...session.modelSettings };
    for (const key of [CROSS_SUBAGENTS_KEY, CROSS_ADVISOR_KEY]) {
      if (explicit[key] != null || !product?.[key]) continue;
      // Automatic resolves the new account at use time; never rewrite its sentinel.
      if (
        key === CROSS_SUBAGENTS_KEY &&
        (settings[key] === AUTOMATIC_SUBAGENTS || product[key] === AUTOMATIC_SUBAGENTS)
      )
        continue;
      const current =
        key === CROSS_ADVISOR_KEY ? [decodeAdvisor(settings[key])] : decodeSubagents(settings[key]);
      const target =
        key === CROSS_ADVISOR_KEY ? [decodeAdvisor(product[key])] : decodeSubagents(product[key]);
      if (current.length !== 1 || !current[0] || !target[0]) continue;
      if (sourceAccountId && current[0].providerAccountId !== sourceAccountId) continue;
      if (current[0].harness === target[0].harness && current[0].model === target[0].model)
        settings[key] = product[key];
    }
    return JSON.stringify(settings) === JSON.stringify(session.modelSettings)
      ? session
      : { ...session, modelSettings: settings };
  }
  const projectModel =
    project.models?.[session.harness] ??
    (project.defaultHarness === session.harness ? project.defaultModel : undefined);
  const model = resolveModel(
    session.harness,
    projectModel ?? preferredModelId(session.harness, accountId),
  );
  const defaults = providerSessionDefaults(session.harness, session.cwd, accountId);
  return {
    ...session,
    model: model.id,
    modelSettings: applySessionDefaults(model, preferredModelSettings(model), defaults),
    runtimeMode: defaults.runtimeMode
      ? runtimeModeForNewSession(session.harness, defaults.runtimeMode)
      : session.runtimeMode,
  };
}
