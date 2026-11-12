import { applyFileMentionsToTurn } from "../../files/public/fileMentions";
import { applyNotesToTurn } from "../../notes";
import { applyWorkItemMentionsToTurn } from "../../inbox/public/workItemMentions";
import {
  applySkillsToTurn,
  warmNativeSkills,
  isNativeCommandPrompt,
  type SkillCatalogContext,
} from "../../skills/model/skills";
import { nativeCommandPrompt } from "../../../integrations/harness/core/nativeCommands";
import { delegateCrewMentions, type DelegationContext } from "./crewDelegation";
import {
  extractChatCitations,
  projectChatCitationsForProvider,
  withChatCitations,
} from "./chatCitation";

/**
 * `delegation` is set by sends that may hand work to `@member` and `@crew` mentions; the
 * message is delegated once its request key is known, so a repeated send repeats the same Host
 * requests. Without it a mention stays plain text.
 */
export async function preparePrompt(
  text: string,
  context: SkillCatalogContext & { delegation?: Omit<DelegationContext, "cwd" | "sessionId"> },
): Promise<string> {
  const cited = extractChatCitations(text);
  warmNativeSkills(context);
  if (!cited.citations.length && isNativeCommandPrompt(text, context.harness))
    return nativeCommandPrompt(context.harness, text);
  const withFiles = await applyFileMentionsToTurn(cited.text, context.cwd);
  const withNotes = await applyNotesToTurn(withFiles);
  let withWorkItems = withNotes;
  try {
    withWorkItems = await applyWorkItemMentionsToTurn(withNotes, context.cwd);
  } catch {
    // Optional tracker context must never prevent sending the original message.
  }
  const withSkills = await applySkillsToTurn(withWorkItems, context);
  const notes =
    context.delegation && context.sessionId
      ? await delegateCrewMentions(cited.text, {
          ...context.delegation,
          cwd: context.cwd,
          sessionId: context.sessionId,
        })
      : [];
  const delegated = notes.length ? [withSkills, "", "---", ...notes].join("\n") : withSkills;
  return projectChatCitationsForProvider(withChatCitations(delegated, cited.citations));
}
