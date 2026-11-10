import { ModelsListParamsSchema } from "../../../src/shared/model/host-contracts/models";
import { applyDisabledModels } from "./disabled-models";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export interface ModelsPorts {
  read(projectId: unknown, progressive: boolean, refresh: boolean): Promise<object>;
  accounts(): Promise<
    Partial<Record<"codex" | "claude", Array<{ id: string; label: string; color?: string }>>>
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
      const disabled = await ports.disabledModels?.().catch(() => undefined);
      await assertDomainAuthority(context);
      return {
        ...applyDisabledModels(catalog, disabled),
        accounts: Object.fromEntries(
          Object.entries(accounts).filter(([provider]) => ports.providers.includes(provider)),
        ),
      };
    },
  };
}
