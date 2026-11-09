import { expect, it } from "vitest";
import { execFileAsync, runGitText } from "../src/shared/lib/processExecution.node";

it("passes argv and environment without shell interpretation and preserves text and binary options", async () => {
  const argument = "literal $HOME & | ;";
  const result = await execFileAsync(
    process.execPath,
    ["-e", "process.stdout.write(process.argv[1]+process.env.AUDIT_VALUE)", argument],
    {
      encoding: "utf8",
      env: { ...process.env, AUDIT_VALUE: " env" },
      windowsHide: true,
    },
  );
  expect(result.stdout).toBe(argument + " env");
  const binary = await execFileAsync(
    process.execPath,
    ["-e", "process.stdout.write(Buffer.from([0,255]))"],
    { encoding: "buffer", windowsHide: true },
  );
  expect(binary.stdout).toEqual(Buffer.from([0, 255]));
});

it("does not trim the git result and preserves the caller's maxBuffer limit", async () => {
  expect(await runGitText(["--version"], { windowsHide: true })).toMatch(/^git version .+\n$/);
  await expect(
    runGitText(["--version"], { windowsHide: true, maxBuffer: 1 }),
  ).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
});
