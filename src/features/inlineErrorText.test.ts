import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it("features convert caught values through errorText instead of inline instanceof Error", () => {
  const inline = /instanceof Error \? \w+\.message : String\(/;
  const offenders = sources("src/features").filter((file) =>
    inline.test(readFileSync(file, "utf8")),
  );
  expect(offenders).toEqual([]);
});
