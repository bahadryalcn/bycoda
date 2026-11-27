import { describe, expect, it } from "vitest";
import { parseVoiceChoice, spokenVoiceChoice, validVoiceChoiceReply } from "./voiceChoices";
const choice = () =>
  parseVoiceChoice({
    question: "Which project?",
    options: [
      { id: "one", label: "upstream" },
      { id: "two", label: "clinic" },
    ],
  });
it("matches spoken ordinals and labels but leaves ambiguous speech to the model", () => {
  expect(spokenVoiceChoice(choice(), "the second one")).toEqual({
    kind: "answered",
    answers: { choice: ["two"] },
  });
  expect(spokenVoiceChoice(choice(), "Upstream")).toEqual({
    kind: "answered",
    answers: { choice: ["one"] },
  });
  expect(spokenVoiceChoice(choice(), "maybe both later")).toBeUndefined();
});
it("rejects duplicate options and replies that do not belong to the active card", () => {
  expect(() =>
    parseVoiceChoice({
      question: "Question",
      options: [
        { id: "a", label: "A" },
        { id: "a", label: "Again" },
      ],
    }),
  ).toThrow();
  expect(
    validVoiceChoiceReply(choice(), { kind: "answered", answers: { choice: ["other-project"] } }),
  ).toBe(false);
  expect(
    validVoiceChoiceReply(choice(), { kind: "answered", answers: { choice: ["one", "two"] } }),
  ).toBe(false);
  expect(validVoiceChoiceReply(choice(), { kind: "skipped" })).toBe(true);
});

describe("spokenVoiceChoice on a project card", () => {
  const projects = () =>
    parseVoiceChoice({
      question: "Pac-Man oyunu hangi projeye açılsın?",
      options: [
        { id: "mono", label: "sample-project (bycoda)" },
        { id: "p-1", label: "pac-man" },
        { id: "p-2", label: "pac-man-ui" },
        { id: "new", label: "Yeni proje oluştur" },
        { id: "other", label: "Other" },
      ],
    });
  const pick = (text: string) => {
    const reply = spokenVoiceChoice(projects(), text);
    return reply?.kind === "answered" ? reply.answers.choice?.[0] : reply?.kind;
  };
  it("matches ordinals and digits for every option in Turkish and English", () => {
    for (const [text, id] of [
      ["dördüncü", "new"],
      ["Dördüncüsü.", "new"],
      ["ikinciyi", "p-1"],
      ["üçüncü olan", "p-2"],
      ["beşinci", "other"],
      ["the fourth one", "new"],
      ["fifth", "other"],
      ["number 3", "p-2"],
      ["4", "new"],
      ["bir", "mono"],
      ["üç", "p-2"],
      ["sonuncu", "other"],
      ["the last one", "other"],
      ["son", "other"],
    ] as const)
      expect(pick(text), text).toBe(id);
    expect(pick("altıncı")).toBeUndefined();
    expect(pick("10")).toBeUndefined();
  });
  it("matches a phrase naming one option, preferring the whole label", () => {
    expect(pick("pac-man'e aç")).toBe("p-1");
    expect(pick("Pac-Man projesine")).toBe("p-1");
    expect(pick("pac-man-ui")).toBe("p-2");
    expect(pick("pac-man ui projesine aç")).toBe("p-2");
    expect(pick("sample-project")).toBe("mono");
    expect(pick("yeni proje")).toBe("new");
    expect(pick("open sample-project bycoda please")).toBe("mono");
  });
  it("returns nothing when the phrase fits several options or none", () => {
    expect(pick("pac")).toBeUndefined();
    expect(pick("proje")).toBeUndefined();
    expect(pick("hangisi olursa")).toBeUndefined();
  });
  it("keeps exact labels and ids", () => {
    expect(pick("Other")).toBe("other");
    expect(pick("mono")).toBe("mono");
    expect(pick("PAC-MAN")).toBe("p-1");
  });
  it("never maps a refusal to an option", () => {
    for (const text of [
      "hayır",
      "istemiyorum",
      "vazgeç",
      "cancel",
      "none of them",
      "hiçbiri",
      "no pac-man",
      "pac-man istemiyorum",
      "don't open the first one",
    ])
      expect(pick(text), text).toBeUndefined();
  });
  it("maps only a bare skip phrase to a skipped reply", () => {
    expect(pick("skip")).toBe("skipped");
    expect(pick("geç")).toBe("skipped");
    expect(pick("geç pac-man")).toBeUndefined();
  });
  it("ignores long sentences and new requests that mention an option", () => {
    expect(pick("pac-man oyununu yarın sabah için yeni bir klasörde baştan yaz")).toBeUndefined();
    expect(pick("pac-man projesindeki testleri çalıştır")).toBeUndefined();
    expect(pick("please fix the bug in pac-man")).toBeUndefined();
    expect(pick("ikinci sırada hangi proje var söyler misin lütfen şimdi")).toBeUndefined();
  });
  it("keeps yes and no for confirm cards", () => {
    const confirm = parseVoiceChoice({
      question: "Send it?",
      kind: "confirm",
      options: [
        { id: "confirm", label: "Send" },
        { id: "cancel", label: "Cancel" },
      ],
    });
    expect(spokenVoiceChoice(confirm, "evet")).toEqual({
      kind: "answered",
      answers: { choice: ["confirm"] },
    });
    expect(spokenVoiceChoice(confirm, "iptal")).toEqual({
      kind: "answered",
      answers: { choice: ["cancel"] },
    });
  });
});
