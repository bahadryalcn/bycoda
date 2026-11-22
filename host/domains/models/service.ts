import type { z } from "zod";
import {
  ModelsListParamsSchema,
  type ModelsListResultSchema,
} from "../../../src/shared/model/host-contracts/models";
import { applyDisabledModels } from "./disabled-models";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export interface ModelsPorts {
  read(projectId: unknown, progressive: boolean, refresh: boolean): Promise<object>;
  accounts(): Promise<
    Partial<
      Record<"codex" | "claude" | "grok", Array<{ id: string; label: string; color?: string }>>
    >
  >;
  providers: readonly string[];
  /** Model ids the owner turned off in the desktop; undefined when never published. */
  disabledModels?(): Promise<readonly string[] | undefined>;
}

/** Owner catalog decoration is separate from the cache used by scoped tools.
 * The account port returns safe metadata only, never credential/profile paths. */
export function createModelsService(ports: ModelsPorts) {
  return {
    async list(
      raw: Record<string, unknown>,
      context: HostDomainContext,
      options: { legacy?: boolean } = {},
    ) {
      await assertDomainAuthority(context);
      const params = options.legacy ? raw : ModelsListParamsSchema.parse(raw);
      const accounts = await ports.accounts();
      await assertDomainAuthority(context);
      const catalog = await ports.read(
        params.projectId,
        params.progressive === true,
        params.refresh === true,
      );
      // A failed settings read rejects the list: serving the catalog unfiltered would show
      // models the owner turned off as selectable. `undefined` still means "never published".
      const disabled = await ports.disabledModels?.();
      await assertDomainAuthority(context);
      const filtered = applyDisabledModels(catalog, disabled) as Partial<
        z.infer<typeof ModelsListResultSchema>
      >;
      // Discovery uses the Host default profile. Other signed-in profiles do not
      // authorize reusing a snapshot from a default account that signed out.
      const defaultCodexSignedOut =
        accounts.codex && !accounts.codex.some((account) => account.id === "default");
      return {
        ...filtered,
        ...(defaultCodexSignedOut && filtered.models?.codex
          ? { models: { ...filtered.models, codex: [] } }
          : {}),
        accounts: Object.fromEntries(
          Object.entries(accounts).filter(([provider]) => ports.providers.includes(provider)),
        ),
      };
    },
  };
}
