import { describe, expect, it } from "vitest";
import { parseAcpRegistry, validateGenericAcpConfig } from "./genericAcp";
describe("generic ACP configuration and registry", () => {
  it("requires a pinned package and distinguishes unsupported distributions", () => {
    const entries = parseAcpRegistry({
      agents: [
        {
          id: "agent",
          name: "Agent",
          version: "1.2.3",
          distribution: { npx: { package: "@vendor/agent@1.2.3", args: ["--acp"] } },
        },
        {
          id: "unpinned",
          name: "Unpinned",
          version: "1",
          distribution: { npx: { package: "agent@latest" } },
        },
        { id: "binary", name: "Binary", version: "1", distribution: { binary: {} } },
      ],
    });
    expect(entries.map((entry) => entry.supported)).toEqual([true, false, false]);
    expect(entries[0].args).toEqual(["--acp"]);
    expect(entries[1].package).toBeUndefined();
  });
  it("rejects directory traversal ids and malformed environment before execution", () => {
    const config = {
      id: "agent",
      name: "Agent",
      command: "node",
      args: ["agent.js", "literal$(value)"],
    };
    expect(validateGenericAcpConfig(config).args[1]).toBe("literal$(value)");
    expect(() => validateGenericAcpConfig({ ...config, id: "../escape" })).toThrow();
    expect(() =>
      validateGenericAcpConfig({ ...config, env: { "INVALID=KEY": "value" } }),
    ).toThrow();
    expect(() => validateGenericAcpConfig({ ...config, command: "node\nother" })).toThrow();
  });
});
