import { expect, it } from "vitest";
import { advisorBrief, replyBrief } from "./prompts";

it("lets a follow-up update the task while preserving child authority limits", () => {
  const brief = replyBrief("Create notes.txt containing the remembered code word.");
  expect(brief).toContain("updates earlier task instructions");
  expect(brief).toContain("Keep the subagent or advisor authority limits");
  expect(brief).toContain("Create notes.txt containing the remembered code word.");
  expect(advisorBrief("Create a file")).toContain("Read-only: do not edit files");
});
