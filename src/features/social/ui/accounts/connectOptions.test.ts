import { describe, expect, it } from "vitest";
import { connectionMethods, defaultConnectionMethod, hostConnection } from "./connectOptions";

describe("connection options", () => {
  it("defaults to the official API where the platform has one (owner D7)", () => {
    expect(defaultConnectionMethod("x")).toBe("api");
    expect(defaultConnectionMethod("youtube")).toBe("api");
  });

  it("uses a token for WhatsApp and Telegram and offers the browser after it", () => {
    expect(connectionMethods("whatsapp")).toEqual(["token", "browser"]);
    expect(defaultConnectionMethod("telegram")).toBe("token");
  });

  it("maps methods to the Host connection values", () => {
    expect(hostConnection("x", "api")).toBe("oauth");
    expect(hostConnection("x", "browser")).toBe("browser");
    expect(hostConnection("whatsapp", "token")).toBe("token");
  });
});
