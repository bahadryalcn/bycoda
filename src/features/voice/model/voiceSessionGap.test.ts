import { expect, it } from "vitest";
import { voiceSessionGap, withVoiceSessionBoundary } from "./voiceSessionGap";

const at = (hour: number, minute = 0, day = 9) => new Date(2026, 10, day, hour, minute).getTime();
const turns = [{ role: "user" as const, text: "Sesim geliyor mu?" }];

it("continues after a short pause or an automatic reconnect", () => {
  expect(voiceSessionGap(at(14, 0), new Date(at(14, 9)))).toBe("continue");
  expect(voiceSessionGap(undefined, new Date(at(14)))).toBe("continue");
  expect(withVoiceSessionBoundary(turns, [{ createdAt: at(14) }], new Date(at(14, 5)))).toEqual(
    turns,
  );
});

it("starts a new conversation after ten minutes on the same day", () => {
  expect(voiceSessionGap(at(14, 0), new Date(at(14, 10)))).toBe("new-conversation");
  const seeded = withVoiceSessionBoundary(
    turns,
    [{ createdAt: at(13, 0) }, { createdAt: at(14, 2) }],
    new Date(at(15, 7)),
  );
  expect(seeded).toHaveLength(2);
  expect(seeded[1]).toMatchObject({ role: "assistant" });
  expect(seeded[1]!.text).toContain("new conversation");
  expect(seeded[1]!.text).toContain("1h 05m");
  expect(seeded[1]!.text).not.toContain("new day");
});

it("starts a new day after six hours or past midnight", () => {
  expect(voiceSessionGap(at(8), new Date(at(14)))).toBe("new-day");
  expect(voiceSessionGap(at(23, 50, 8), new Date(at(0, 20, 9)))).toBe("new-day");
  const seeded = withVoiceSessionBoundary(turns, [{ createdAt: at(18, 0, 8) }], new Date(at(9)));
  expect(seeded.at(-1)!.text).toContain("It is a new day");
});

it("ignores a future or invalid timestamp", () => {
  expect(voiceSessionGap(at(15), new Date(at(14)))).toBe("continue");
  expect(withVoiceSessionBoundary(turns, [{ createdAt: Number.NaN }], new Date(at(14)))).toEqual(
    turns,
  );
});
