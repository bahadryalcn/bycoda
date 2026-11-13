import { resolveHelperModel } from "../../model-routing/public/helpers";
import {
  titleGenerationChoice,
  type TitleGenerationChoice,
} from "../../sessions/public/titlePreferences";
export type SkillGroupingModel = TitleGenerationChoice;
export async function resolveSkillGroupingModel() {
  return (await resolveHelperModel("text.skillGrouping")) ?? titleGenerationChoice();
}
