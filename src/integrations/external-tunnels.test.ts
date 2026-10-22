import { describe, expect, it } from "vitest";
import { tunnelLocalUrl, tunnelPublicUrl } from "./external-tunnels";

describe("external tunnel targets", () => {
  it("accepts loopback HTTP/HTTPS services and numeric ports", () => {
    expect(tunnelLocalUrl("3000")).toBe("http://127.0.0.1:3000");
    expect(tunnelLocalUrl("http://localhost:5173/")).toBe("http://localhost:5173");
    expect(tunnelLocalUrl("https://[::1]:8443")).toBe("https://[::1]:8443");
  });
  it.each([
    "",
    "0",
    "65536",
    "-1",
    "https://example.com",
    "http://127.0.0.2:3000",
    "file:///etc/passwd",
    "http://localhost:3000/path",
    "http://secret@localhost:3000",
    "http://localhost:3000/?token=secret",
    "http://localhost:3000/#secret",
    "3000\n--token secret",
  ])("rejects unsafe target %s without echoing it", (value) => {
    expect(() => tunnelLocalUrl(value)).toThrow(/^invalid-target$/);
  });
  it("accepts only credential-free provider origins from process output", () => {
    expect(tunnelPublicUrl("cloudflare", "https://a-b.trycloudflare.com/")).toBe(
      "https://a-b.trycloudflare.com",
    );
    expect(tunnelPublicUrl("ngrok", "https://project.ngrok-free.app")).toBe(
      "https://project.ngrok-free.app",
    );
    for (const value of [
      "https://a.trycloudflare.com.evil.example",
      "https://secret@a.trycloudflare.com",
      "https://a.trycloudflare.com/?token=secret",
      "http://a.trycloudflare.com",
      "https://a.trycloudflare.com:444",
      "https://a.trycloudflare.com/path",
    ])
      expect(tunnelPublicUrl("cloudflare", value)).toBeUndefined();
  });
});
