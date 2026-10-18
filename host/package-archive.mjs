import { execFileSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";

/** GNU tar treats drive-letter archives as remote hosts; MSYS builds can also
 * reject native absolute -C paths. Let Node open the archive and use standard
 * streams with the working directory as cwd. This supports GNU/BSD tar and
 * caches on a different Windows drive without platform-specific path rewriting. */
export function extractTarMembers(archive, destination, members, run = execFileSync) {
  const input = openSync(archive, "r");
  try {
    run("tar", ["-xzf", "-", "--strip-components=1", ...members], {
      cwd: destination,
      windowsHide: true,
      stdio: [input, "pipe", "pipe"],
    });
  } finally {
    closeSync(input);
  }
}

export function createTarArchive(archive, source, run = execFileSync) {
  const output = openSync(archive, "w");
  try {
    run("tar", ["-czf", "-", "."], {
      cwd: source,
      windowsHide: true,
      stdio: ["ignore", output, "pipe"],
    });
  } finally {
    closeSync(output);
  }
}
