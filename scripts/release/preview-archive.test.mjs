import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
test("unsigned preview ZIP validator rejects real unsafe archive fixtures", () => {
  execFileSync(
    process.platform === "win32" ? "python" : "python3",
    ["-B", fileURLToPath(new URL("./preview_archive_test.py", import.meta.url))],
    { windowsHide: true, stdio: "pipe" },
  );
});
