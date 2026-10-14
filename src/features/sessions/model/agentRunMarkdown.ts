import type { AgentStep, Block, ToolPreview } from "./session";
import { subagentModelName, subagentName, subagentReport } from "./transcriptActivity";

const MAX_DIFF_LINES = 40;

/**
 * The closing report a provider also mirrors as the last message step. The
 * panel shows the report once, below the trail, so the step is left out of it.
 */
export function isReportStep(step: AgentStep, report: string | undefined) {
  if (!report || step.kind !== "message") return false;
  return step.id.endsWith(":report") || step.text.trim() === report;
}

/** A code fence that no backtick run inside the text can close early. */
function fence(text: string, lang = ""): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

function diffText(preview: ToolPreview | undefined): string | undefined {
  const lines = preview?.lines?.filter((line) => line.kind !== "context");
  if (!lines?.length) return undefined;
  const shown = lines.slice(0, MAX_DIFF_LINES).map((line) => {
    const sign = line.kind === "add" ? "+" : "-";
    return `${sign}${line.text}`;
  });
  if (lines.length > shown.length) {
    shown.push(`… ${lines.length - shown.length} more changed lines`);
  }
  return shown.join("\n");
}

function toolStepMarkdown(step: AgentStep): string {
  const failed = /^(failed|error|cancel)/i.test(step.status ?? "");
  const label = step.text.replace(/\s+/g, " ").trim() || "Tool call";
  const parts = [`- \`${label.replace(/`/g, "'")}\`${failed ? " (failed)" : ""}`];
  const diff = diffText(step.preview);
  if (diff) parts.push(fence(diff, "diff"));
  const result = failed ? (step.detail ?? step.output) : step.output;
  if (result?.trim()) parts.push(fence(result.trim()));
  if (step.outputTruncated) {
    parts.push("_Output was shortened to keep this run small._");
  }
  return parts.join("\n\n");
}

/**
 * A subagent's run as Markdown: what it was asked, what it said and did in
 * order, and what it reported. Reasoning is kept as a quote so it reads as
 * thinking rather than as something the agent told anyone.
 */
export function agentRunMarkdown(block: Block, status?: string): string | undefined {
  const run = block.agentRun;
  if (!run) return undefined;
  const report = subagentReport(block);
  const meta = [status, run.agentType, subagentModelName(block)].filter(Boolean).join(" · ");
  const sections: string[] = [`# ${subagentName(block)}`];
  if (meta) sections.push(`_${meta}_`);
  if (run.prompt?.trim()) sections.push("## Prompt", run.prompt.trim());

  const trail = run.steps
    .filter((step) => !isReportStep(step, report))
    .map((step) => {
      if (step.kind === "message") return step.text.trim();
      if (step.kind === "reasoning") {
        const quoted = step.text
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        return `> **Thinking**\n>\n${quoted}`;
      }
      return toolStepMarkdown(step);
    })
    .filter(Boolean);
  if (trail.length) sections.push("## Work", ...trail);
  if (report) sections.push("## Report", report);
  return `${sections.join("\n\n")}\n`;
}
