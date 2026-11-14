import { expect, it } from "vitest";
import { advisorBrief, replyBrief, subagentBrief } from "./prompts";

it("lets a follow-up update the task while preserving child authority limits", () => {
  const brief = replyBrief("Create notes.txt containing the remembered code word.");
  expect(brief).toContain("overrides earlier instructions");
  expect(brief).toContain("original limits still apply");
  expect(brief).toContain("Create notes.txt containing the remembered code word.");
  expect(advisorBrief("Create a file")).toContain("Read-only: do not edit files");
  const subagent = subagentBrief("Name three colors.");
  expect(subagent).toContain("Message sibling agents");
  expect(subagent).toContain("only when the task asks");
  expect(subagent).toContain("Only for code changes");
  expect(subagent).toContain("Do not commit, push");
});
