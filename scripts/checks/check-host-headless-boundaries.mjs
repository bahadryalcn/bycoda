import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Inspect the actual production graph, including dynamic imports. No application
// build output is written or installed by this development check.
const result = await build({
  absWorkingDir: root,
  entryPoints: ["host/cli.ts", "host/mcp-entry.ts"],
  outdir: "temp/local/host-headless-check-not-written",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  loader: { ".ps1": "text", ".md": "text" },
  define: { "import.meta.hot": "undefined" },
  write: false,
  metafile: true,
  logLevel: "silent",
});
const inputs = Object.keys(result.metafile.inputs);
const findings = inputs.filter((path) =>
  /(?:^|\/)src\/.*(?:\/ui\/|\.tsx$)|\.css$|\/node_modules\/(?:react|react-dom)(?:\/|$)/.test(path),
);
if (findings.length) {
  console.error(`Headless Host includes ${findings.length} UI dependencies:`);
  for (const path of findings.slice(0, 20)) console.error(`- ${path}`);
  if (findings.length > 20) console.error(`- ${findings.length - 20} more`);
  process.exitCode = 1;
} else {
  console.log(
    `Headless Host boundaries: ${inputs.length} bundled inputs, zero UI/React/CSS dependencies.`,
  );
}
