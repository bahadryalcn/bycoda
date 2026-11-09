import type { SocialActionModule } from "../core/social-actions";
import { collectAudience } from "./audience-collect";
import { deleteRule, listRules, saveRule, setRuleEnabled } from "./audience-capture-rules";
import { importAudience } from "./audience-import";
import { addMembers, deleteList, listLists, removeMembers, saveList } from "./audience-lists";
import {
  deletePerson,
  exportPeople,
  getPerson,
  listPeople,
  scorePerson,
  updatePerson,
} from "./audience-people";
import { matchSuggestions, mergePeople } from "./audience-merge";

/** People, lists, audience capture and capture rules. Contracts: target-architecture section 3. */
export const audienceActions: SocialActionModule = {
  "people.list": { readOnly: true, ownerOnly: false, tool: true, run: listPeople },
  "people.get": { readOnly: true, ownerOnly: false, tool: true, run: getPerson },
  "people.update": { readOnly: false, ownerOnly: false, tool: true, run: updatePerson },
  "people.merge": { readOnly: false, ownerOnly: false, tool: true, run: mergePeople },
  "people.matchSuggestions": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: matchSuggestions,
  },
  // Added in 4B-host-1 (not in the section 3 table): AI interest score through the decision service.
  "people.score": { readOnly: false, ownerOnly: false, tool: true, run: scorePerson },
  "people.delete": { readOnly: false, ownerOnly: true, run: deletePerson },
  "people.export": { readOnly: true, ownerOnly: true, run: exportPeople },
  "lists.list": { readOnly: true, ownerOnly: false, tool: true, run: listLists },
  "lists.save": { readOnly: false, ownerOnly: false, tool: true, run: saveList },
  "lists.delete": { readOnly: false, ownerOnly: false, tool: true, run: deleteList },
  "lists.addMembers": { readOnly: false, ownerOnly: false, tool: true, run: addMembers },
  "lists.removeMembers": { readOnly: false, ownerOnly: false, tool: true, run: removeMembers },
  "audience.collect": { readOnly: false, ownerOnly: false, tool: true, run: collectAudience },
  "audience.import": { readOnly: false, ownerOnly: true, run: importAudience },
  "captureRules.list": { readOnly: true, ownerOnly: false, tool: true, run: listRules },
  "captureRules.save": { readOnly: false, ownerOnly: false, tool: true, run: saveRule },
  "captureRules.setEnabled": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    run: setRuleEnabled,
  },
  "captureRules.delete": { readOnly: false, ownerOnly: false, tool: true, run: deleteRule },
};
