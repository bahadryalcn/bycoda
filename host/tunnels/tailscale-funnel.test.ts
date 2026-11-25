import { describe, expect, it } from "vitest";
import { tailscaleApprovalUrl, tunnelPublicUrl } from "../../src/integrations/external-tunnels";
import { availableFunnelPort } from "./tailscale-funnel";
import { tunnelCommand, tunnelOutput, type TunnelEvent } from "./tunnel-providers";

function parse(...chunks: string[]) {
  const events: TunnelEvent[] = [];
  const parser = tunnelOutput("tailscale", (event) => events.push(event));
  const stream = parser.stream();
  for (const chunk of chunks) stream.write(Buffer.from(chunk));
  stream.end();
  return events;
}

describe("Tailscale Funnel command", () => {
  it("runs in the foreground against the tunnel ingress port, never with --bg", () => {
    const command = tunnelCommand(
      "tailscale",
      "/bin/tailscale",
      "http://127.0.0.1:41234",
      "/unused.yml",
      undefined,
      8443,
    );
    expect(command.args).toEqual(["funnel", "--https=8443", "http://127.0.0.1:41234"]);
    expect(command.args).not.toContain("--bg");
    expect(() => tunnelCommand("tailscale", "/bin/tailscale", "http://127.0.0.1:1", "x")).toThrow();
  });
});

describe("Funnel port choice", () => {
  it("takes the first allowed port the Serve/Funnel configuration leaves free", () => {
    expect(availableFunnelPort({})).toBe(443);
    expect(availableFunnelPort(null)).toBe(443);
    expect(availableFunnelPort({ TCP: { "443": { HTTPS: true } } })).toBe(8443);
    expect(
      availableFunnelPort({
        TCP: { "443": { HTTPS: true } },
        Web: { "bab.tail.ts.net:8443": {} },
      }),
    ).toBe(10000);
    expect(
      availableFunnelPort({
        TCP: { "443": {} },
        Web: { "bab.tail.ts.net:8443": {} },
        AllowFunnel: { "bab.tail.ts.net:10000": true },
      }),
    ).toBeUndefined();
  });
});

describe("Funnel output", () => {
  it("is ready when the public ts.net URL is printed", () => {
    expect(
      parse(
        "\nAvailable on the internet:\n\nhttps://bab.tail7449a4.ts.net/\n|-- / proxy http://127.0.0.1:41234\n\nPress Ctrl+C to exit.\n",
      ),
    ).toEqual([{ type: "ready", publicUrl: "https://bab.tail7449a4.ts.net" }]);
    expect(parse("Available on the internet:\nhttps://bab.tail7449a4.ts.net:8443/\n")).toEqual([
      { type: "ready", publicUrl: "https://bab.tail7449a4.ts.net:8443" },
    ]);
  });

  it("reports approval-required with a validated Tailscale admin URL", () => {
    const events = parse(
      "Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/funnel?node=nABC123\n",
    );
    expect(events).toEqual([
      {
        type: "error",
        issue: "approval-required",
        approvalUrl: "https://login.tailscale.com/f/funnel?node=nABC123",
      },
    ]);
  });

  it("never turns an untrusted link into a ready URL or an approval page", () => {
    expect(parse("visit https://evil.example/f/funnel to enable\n")).toEqual([]);
    expect(parse("https://login.tailscale.com.evil.example/f/funnel\n")).toEqual([]);
    expect(parse("https://user:pw@login.tailscale.com:8080/x\n")).toEqual([]);
    expect(parse("https://evil.example.ts.net.evil.com/\n")).toEqual([]);
  });
});

describe("Funnel URL validation", () => {
  it("accepts only credential-free ts.net origins on Funnel ports", () => {
    expect(tunnelPublicUrl("tailscale", "https://bab.tail7449a4.ts.net/")).toBe(
      "https://bab.tail7449a4.ts.net",
    );
    expect(tunnelPublicUrl("tailscale", "https://bab.tail7449a4.ts.net:10000")).toBe(
      "https://bab.tail7449a4.ts.net:10000",
    );
    for (const value of [
      "http://bab.tail.ts.net",
      "https://bab.tail.ts.net:8080",
      "https://bab.tail.ts.net/path",
      "https://bab.tail.ts.net/?token=x",
      "https://user@bab.tail.ts.net",
      "https://bab.ts.net.evil.com",
      "https://login.tailscale.com/",
      "https://a.trycloudflare.com",
    ])
      expect(tunnelPublicUrl("tailscale", value)).toBeUndefined();
    // A ts.net address is not a Cloudflare or ngrok URL.
    expect(tunnelPublicUrl("cloudflare", "https://bab.tail.ts.net")).toBeUndefined();
    expect(tunnelPublicUrl("ngrok", "https://bab.tail.ts.net")).toBeUndefined();
  });

  it("accepts approval links only on login.tailscale.com", () => {
    expect(tailscaleApprovalUrl("go https://login.tailscale.com/f/funnel?node=n1 now")).toBe(
      "https://login.tailscale.com/f/funnel?node=n1",
    );
    expect(tailscaleApprovalUrl("https://tailscale.com/x https://evil.example/")).toBeUndefined();
    expect(tailscaleApprovalUrl("https://login.tailscale.com:444/x")).toBeUndefined();
    expect(tailscaleApprovalUrl("https://u:p@login.tailscale.com/x")).toBeUndefined();
  });
});
