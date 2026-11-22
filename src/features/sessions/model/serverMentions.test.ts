import { describe, expect, it } from "vitest";
import {
  findServerMentionIds,
  serverMentionRows,
  withServerMentionContext,
} from "./serverMentions";

describe("server mentions", () => {
  const servers = [
    {
      id: "saved-one",
      name: "Production",
      kind: "ssh",
      sshEndpoint: { host: "secret-host", identityFile: "secret-file" },
    },
    { id: "saved-two", name: "Production", kind: "ssh" },
    { id: "saved-host", name: "Production Host", kind: "host" },
  ];

  it("offers both prefixes and picks by stable ID with duplicate labels", () => {
    expect(serverMentionRows("se", servers)[0]?.relative).toBe("server:");
    expect(serverMentionRows("sr", servers)[0]?.relative).toBe("srv:");
    expect(serverMentionRows("server:prod", servers).map(({ relative }) => relative)).toEqual([
      "server:saved-one",
      "server:saved-two",
    ]);
  });

  it("deduplicates IDs and ignores code, quotes, and malformed tokens", () => {
    expect(
      findServerMentionIds(
        "@srv:saved-one; @SERVER:saved-one `@srv:other` email@srv:other\n> @srv:quote\n~~~\n@srv:code\n~~~\n@server:saved-two @srv:invalid/part",
      ),
    ).toEqual(["saved-one", "saved-two"]);
  });

  it("adds only confirmed SSH IDs to provider context", () => {
    const input = "Check @srv:saved-one @server:saved-host @srv:unknown";
    const result = withServerMentionContext(input, findServerMentionIds(input), servers);
    expect(result).toContain("servers.get");
    expect(result.slice(input.length)).toContain("saved-one");
    expect(result.slice(input.length)).not.toMatch(/saved-host|unknown|Production|secret-/);
  });
});
