/** Tested routing only; machine-owned pre-job admission is mandatory separately. */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateWindowsRunnerTrust, readWindowsRunnerContext } from "./windows-runner-trust.mjs";
export const windowsSelfHostedLabels = ["self-hosted", "Windows", "X64", "bycoda-windows-isolated"];
export const windowsHeavyConcurrencyGroup = "bycoda-windows-heavy";
export function selectWindowsRunner({ enabled, scope = "ci", ...context } = {}) {
  const hosted = (reason) => ({
    selfHosted: false,
    runsOn: "windows-latest",
    concurrencyGroup: "",
    reason,
  });
  if (enabled !== "true") return hosted("opt-in-disabled");
  const trust = evaluateWindowsRunnerTrust(context, { scope });
  if (!trust.allowed) return hosted(trust.reason);
  return {
    selfHosted: true,
    runsOn: [...windowsSelfHostedLabels],
    concurrencyGroup: windowsHeavyConcurrencyGroup,
    reason: trust.reason,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    if (!["--scope", "--github-output"].includes(process.argv[index]) || !process.argv[index + 1])
      throw new Error("Expected --scope or --github-output value");
    options[process.argv[index].slice(2)] = process.argv[index + 1];
  }
  let context = {};
  if (process.env.WINDOWS_SELF_HOSTED_OPT_IN === "true") {
    try {
      context = readWindowsRunnerContext();
    } catch {
      /* Unknown routing inputs always retain hosted runners. */
    }
  }
  const route = selectWindowsRunner({
    ...context,
    enabled: process.env.WINDOWS_SELF_HOSTED_OPT_IN,
    scope: options.scope ?? "ci",
  });
  const output = options["github-output"] ?? process.env.GITHUB_OUTPUT;
  if (output)
    appendFileSync(
      output,
      `windows_runs_on=${JSON.stringify(route.runsOn)}\nwindows_self_hosted=${route.selfHosted}\nwindows_concurrency_group=${route.concurrencyGroup}\n`,
    );
  process.stdout.write(`${JSON.stringify(route)}\n`);
}
