import { applyFileMentionsToTurn } from "../../files/public/fileMentions";
import { applyNotesToTurn } from "../../notes";
import {
  applySkillsToTurn,
  warmNativeSkills,
  isNativeCommandPrompt,
  type SkillCatalogContext,
} from "../../skills/model/skills";
import { nativeCommandPrompt } from "../../../integrations/harness/core/nativeCommands";
import {
  extractChatCitations,
  projectChatCitationsForProvider,
  withChatCitations,
} from "./chatCitation";

export async function preparePrompt(text: string, context: SkillCatalogContext): Promise<string> {
  const cited = extractChatCitations(text);
  warmNativeSkills(context);
  if (!cited.citations.length && isNativeCommandPrompt(text, context.harness))
    return nativeCommandPrompt(context.harness, text);
  const withFiles = await applyFileMentionsToTurn(cited.text, context.cwd);
  const withNotes = await applyNotesToTurn(withFiles);
  const withSkills = await applySkillsToTurn(withNotes, context);
  return projectChatCitationsForProvider(withChatCitations(withSkills, cited.citations));
}
