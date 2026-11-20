import type { HarnessId } from "./harnessIdentity";

export type ModelSettingChoice = {
  value: string;
  label: string;
};

export type ModelSetting = {
  id: string;
  label: string;
  kind: "select" | "toggle";
  value: string;
  options: ModelSettingChoice[];
  description?: string;
};

export type AgentModel = {
  id: string;
  harness: HarnessId;
  name: string;
  nativeId?: string;
  /** Concrete native model launched by a moving provider alias. */
  aliasTarget?: string;
  /** Upstream provider inside a multi-provider harness such as OpenCode. */
  provider?: {
    id: string;
    name: string;
  };
  settings?: ModelSetting[];
  /** A CLI speed variant represented by this model's Fast setting. */
  fastVariant?: { id: string; nativeId: string };
  /** Context window, when the harness catalog reports one. */
  contextWindow?: number;
  /** The provider catalog explicitly reports zero token prices. */
  free?: boolean;
};
