import { expect, it } from "vitest";
import { supportsOmpSessionCompaction } from "./ompCompaction";

it.each([undefined, "", "18.0.6", "18.2.0", "18.2.1-beta.1", "unknown"])(
  "rejects unverified session isolation in %s",
  (version) => {
    expect(supportsOmpSessionCompaction(version)).toBe(false);
  },
);

it.each(["18.2.1", "omp 18.2.2", "v18.3.0", "19.0.0"])(
  "accepts isolated compaction in %s",
  (version) => {
    expect(supportsOmpSessionCompaction(version)).toBe(true);
  },
);
