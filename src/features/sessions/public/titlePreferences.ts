/** Public sessions contract; exports stay explicit to preserve load isolation. */
export {
  defaultTitleChoice,
  saveDefaultTitleChoice,
  useDefaultTitleChoice,
} from "../model/titlePreferences";
export type { TitleGenerationChoice } from "../model/titlePreferences";
