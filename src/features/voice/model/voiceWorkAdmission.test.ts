import { describe, expect, it } from "vitest";
import { voiceCarriedWorkSpeech, voiceWorkRefusal } from "./voiceWorkAdmission";

const pacMan = "Ufak bi Pac-Man oyunu yaptır Arif.";
const createSession = (speech: string, prompt: string, previous?: string) =>
  voiceWorkRefusal(
    speech,
    "app_tool_call",
    "workspace.sessions.create",
    previous,
    { prompt, submit: true },
    "workspace",
  );

describe("voice work admission", () => {
  it.each([
    pacMan,
    "make me a small pac man game",
    "Bana bir todo uygulaması hazırlar mısın?",
    "Build a landing page for the clinic",
    "Bir mini oyun yap",
    "Can you set up a small script that renames the photos?",
  ])("treats the build request %j as work", (speech) => {
    expect(
      voiceWorkRefusal(speech, "submit_work", undefined, undefined, "A paraphrased brief"),
    ).toBe(undefined);
  });

  it.each([
    ["make me a chart of my token usage by model", "display"],
    ["Token kullanımımı modellere göre bir grafiğe döker misin?", "display"],
    ["Bu projede ne yaptın?", "ambiguous"],
    ["Did you build the game?", "ambiguous"],
    ["Uygulamayı tam ekran yap", "ambiguous"],
  ])("keeps %j out of work", (speech, intent) => {
    expect(voiceWorkRefusal(speech, "give_jobs")).toMatchObject({ accepted: false, intent });
  });

  it("keeps opening a desktop app a computer action", () => {
    expect(voiceWorkRefusal("Chrome'da uygulamayı aç", "give_jobs")).toMatchObject({
      intent: "computer_action",
    });
  });

  it("accepts a paraphrased brief for session work", () => {
    expect(
      createSession(pacMan, "Create a small Pac-Man game in the browser with a playable maze."),
    ).toBeUndefined();
    expect(
      voiceWorkRefusal(
        "make me a small pac man game",
        "app_tool_call",
        "workspace.sessions.submit",
        undefined,
        { text: "Build a minimal Pac-Man clone." },
        "workspace",
      ),
    ).toBeUndefined();
  });

  it("carries the work intent through a short answer to a pending question", () => {
    for (const answer of ["Yeni proje oluştur", "evet", "başlat", "monocode", "ikincisi"]) {
      expect(createSession(answer, "Create a small Pac-Man game.", pacMan)).toBeUndefined();
      expect(voiceCarriedWorkSpeech(answer, pacMan)).toBe(pacMan);
    }
  });

  it("admits session work after a reconnect from the carried utterance alone", () => {
    expect(createSession("", "Create a small Pac-Man game.", pacMan)).toBeUndefined();
    expect(voiceWorkRefusal("", "submit_work", undefined, pacMan, "Pac-Man brief")).toBeUndefined();
    expect(createSession("", "Create a small Pac-Man game.")).toMatchObject({
      intent: "ambiguous",
    });
  });

  it("lets a later request replace or clear the carried one", () => {
    expect(voiceCarriedWorkSpeech("Fix the login bug", pacMan)).toBe("Fix the login bug");
    expect(voiceCarriedWorkSpeech("Sadece token kullanımını göster", pacMan)).toBe("");
    expect(voiceCarriedWorkSpeech("hayır", pacMan)).toBe("");
    expect(voiceCarriedWorkSpeech("bugün hava çok güzel değil mi sence Arif", pacMan)).toBe("");
    expect(
      voiceWorkRefusal("Sadece token kullanımını göster", "submit_work", undefined, pacMan, "x"),
    ).toMatchObject({ intent: "display" });
    expect(voiceWorkRefusal("hayır", "submit_work", undefined, pacMan, "x")).toMatchObject({
      intent: "ambiguous",
    });
  });

  it("keeps exact intent for tracked work families", () => {
    for (const action of ["goals.create", "tasks.create", "automations.create", "crews.start"])
      expect(
        voiceWorkRefusal(
          "evet",
          "app_tool_call",
          action,
          pacMan,
          { title: "Pac-Man" },
          "conversation",
        ),
      ).toMatchObject({ accepted: false });
    expect(voiceWorkRefusal("evet", "give_jobs", undefined, pacMan)).toMatchObject({
      intent: "ambiguous",
    });
    expect(
      voiceWorkRefusal(
        "monocode",
        "app_tool_call",
        "tasks.create",
        "Create a task to fix the login",
        {
          title: "Fix login",
        },
      ),
    ).toBeUndefined();
  });

  it("refuses a paraphrased brief for an ambiguous request without carried work", () => {
    expect(createSession("Pac-Man lazım bana", "Build a Pac-Man game.")).toMatchObject({
      intent: "ambiguous",
    });
    expect(createSession("Pac-Man lazım bana", "Pac-Man lazım bana")).toBeUndefined();
  });

  it("points an ambiguous job to the ordinary session route", () => {
    expect(voiceWorkRefusal("Pac-Man lazım bana", "give_jobs")).toMatchObject({
      intent: "ambiguous",
      next: expect.stringContaining("workspace.sessions.create"),
    });
  });

  it("keeps a requested draft unsent when the answer only names the project", () => {
    const draft = "Bir session aç ama gönderme, oyun fikrini yaz";
    expect(createSession("monocode", "Game idea", draft)).toMatchObject({
      intent: "normal_session",
    });
  });
});
