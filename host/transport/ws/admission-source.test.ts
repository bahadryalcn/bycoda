import { describe, expect, it } from "vitest";
import { AdmissionSources } from "./admission-source";

const TOKEN_A = "A".repeat(43);
const TOKEN_B = "B".repeat(43);

describe("AdmissionSources", () => {
  it("keeps every token in the shared address bucket until it has authenticated", () => {
    const sources = new AdmissionSources();
    expect(sources.sourceFor(TOKEN_A, "127.0.0.1", true)).toBe("mobile:127.0.0.1");
    expect(sources.sourceFor(TOKEN_B, "127.0.0.1", false)).toBe("direct:127.0.0.1");
  });

  it("gives a verified token its device bucket and leaves other tokens shared", () => {
    const sources = new AdmissionSources();
    sources.remember(TOKEN_A, "device-a");
    expect(sources.sourceFor(TOKEN_A, "127.0.0.1", true)).toBe("device:device-a");
    expect(sources.sourceFor(TOKEN_A, "10.0.0.9", false)).toBe("device:device-a");
    expect(sources.sourceFor(TOKEN_B, "127.0.0.1", true)).toBe("mobile:127.0.0.1");
  });

  it("forgets the least recently used device once the memory bound is reached", () => {
    const sources = new AdmissionSources();
    const token = (index: number) => `${index}`.padStart(43, "x");
    sources.remember(token(0), "device-0");
    for (let index = 1; index <= 256; index += 1) sources.remember(token(index), `device-${index}`);
    expect(sources.sourceFor(token(0), "127.0.0.1", true)).toBe("mobile:127.0.0.1");
    expect(sources.sourceFor(token(256), "127.0.0.1", true)).toBe("device:device-256");
  });

  it("keeps a device that keeps connecting ahead of idle ones", () => {
    const sources = new AdmissionSources();
    const token = (index: number) => `${index}`.padStart(43, "x");
    sources.remember(token(0), "device-0");
    for (let index = 1; index < 256; index += 1) sources.remember(token(index), `device-${index}`);
    sources.sourceFor(token(0), "127.0.0.1", true);
    sources.remember(token(256), "device-256");
    expect(sources.sourceFor(token(0), "127.0.0.1", true)).toBe("device:device-0");
    expect(sources.sourceFor(token(1), "127.0.0.1", true)).toBe("mobile:127.0.0.1");
  });
});
