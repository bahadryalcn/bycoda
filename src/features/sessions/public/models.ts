/** Public sessions contract; exports stay explicit to preserve load isolation. */
export {
  MODELS,
  catalogModelsFor,
  defaultModelId,
  defaultModelSettings,
  defaultSessionChoice,
  firstEnabledHarness,
  getModelSnapshot,
  hasLiveCatalog,
  isEnabledChoice,
  isModelEnabled,
  loadDefaultModels,
  loadHiddenPickerProviders,
  loadLastModelChoice,
  mergeModelSettings,
  modelEffortSetting,
  modelsFor,
  nativeModelId,
  preferredModelId,
  resolveModel,
  saveDefaultModel,
  saveLastModelChoice,
  saveModelEnabled,
  savePickerProviderVisible,
  setHarnessModels,
  subscribeModels,
  subscribePickerVisibility,
} from "../model/models";
export type { AgentModel, ModelSetting, ModelSettingChoice } from "../model/models";

export { modelBelongsToHarness } from "../model/models";
