import type { HalayCue, HalaySnapshot } from "../../../src/features/live-games/model/halayGame";
import { numberFormat } from "../../../src/shared/i18n/numberFormat";
import { elapsedSince, monotonicNow } from "../../../src/shared/lib/time/timestamps";
import { drawBackdrop } from "./backdrop";
import { Dancers } from "./dancers";
import { Davul } from "./davul";
import { Effects } from "./effects";

const strings = {
  tr: {
    image: "Halay sahnesi",
    score: "Hediye sıralaması",
    gift: "Son hediye",
    waiting: "Sahne hazır, oyun bekleniyor",
    reconnecting: "Sahne yeniden bağlanıyor…",
    dancers: "oyuncu",
    viewers: "izleyici",
    diamonds: "elmas",
    mute: "Davulu sustur",
    unmute: "Davulu aç",
  },
  en: {
    image: "Halay dance floor",
    score: "Top gifters",
    gift: "Latest gift",
    waiting: "Waiting for the game to start",
    reconnecting: "Reconnecting to the game…",
    dancers: "dancers",
    viewers: "viewers",
    diamonds: "diamonds",
    mute: "Mute drum",
    unmute: "Enable drum",
  },
};

function main(): void {
  const stage = document.querySelector<HTMLElement>("#stage")!;
  const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
  const details = document.querySelector<HTMLElement>("#details")!;
  const score = document.querySelector<HTMLElement>("#score")!;
  const leaders = document.querySelector<HTMLOListElement>("#leaders")!;
  const ticker = document.querySelector<HTMLElement>("#ticker")!;
  const lastGift = document.querySelector<HTMLElement>("#gift")!;
  const sound = document.querySelector<HTMLButtonElement>("#sound")!;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;

  const params = new URLSearchParams(location.search);
  const wide = params.get("aspect") === "16:9";
  const clean = params.has("clean");
  const language = params.get("lang") === "en" ? "en" : "tr";
  const copy = strings[language];
  const format = numberFormat(language);
  let muted = params.has("mute");
  let connected = false;
  let active: boolean | undefined;
  let latest: HalaySnapshot | undefined;
  let roster = "";
  let scoreKey = "";
  let giftId = "";
  let giftStartedAt = 0;

  stage.toggleAttribute("data-wide", wide);
  stage.toggleAttribute("data-clean", clean);
  document.documentElement.lang = language;
  canvas.setAttribute("aria-label", copy.image);
  document.querySelector("#score-title")!.textContent = copy.score;
  document.querySelector("#gift-title")!.textContent = copy.gift;
  canvas.width = wide ? 1600 : 900;
  canvas.height = wide ? 900 : 1600;
  const backdrop = document.createElement("canvas");
  backdrop.width = canvas.width;
  backdrop.height = canvas.height;
  drawBackdrop(backdrop.getContext("2d")!, canvas.width, canvas.height);
  const dancers = new Dancers(canvas.width, canvas.height);
  const effects = new Effects(canvas.width, canvas.height);
  const davul = new Davul();

  function reflectSound(): void {
    sound.textContent = !muted && davul.running ? copy.mute : copy.unmute;
  }

  function enableSound(): void {
    davul.resume().then(reflectSound, reflectSound);
    davul.setMuted(false);
  }

  reflectSound();
  if (!muted) enableSound();
  sound.addEventListener("click", () => {
    muted = !muted && davul.running;
    davul.setMuted(muted);
    if (!muted) enableSound();
    reflectSound();
  });
  if (clean && !muted) stage.addEventListener("pointerdown", enableSound, { once: true });

  function reflectDetails(): void {
    const content = !connected
      ? copy.reconnecting
      : !latest || active === false
        ? copy.waiting
        : `${format.format(latest.dancers.length)} ${copy.dancers} · ${format.format(latest.viewers)} ${copy.viewers}`;
    if (details.textContent !== content) details.textContent = content;
  }

  function renderSnapshot(snapshot: HalaySnapshot): void {
    latest = snapshot;
    const key = JSON.stringify(snapshot.dancers.map(({ id, name, role, avatarUrl }) => [id, name, role, avatarUrl]));
    if (roster !== key) {
      roster = key;
      dancers.update(snapshot.dancers);
    }
    const nextScoreKey = JSON.stringify(snapshot.topGifters.map(({ id, name, diamonds }) => [id, name, diamonds]));
    if (scoreKey !== nextScoreKey) {
      scoreKey = nextScoreKey;
      leaders.replaceChildren(...snapshot.topGifters.map(({ name, diamonds }) => {
        const line = document.createElement("li");
        const value = document.createElement("span");
        value.textContent = format.format(diamonds);
        value.setAttribute("aria-label", `${value.textContent} ${copy.diamonds}`);
        line.append(value, name);
        return line;
      }));
      score.hidden = snapshot.topGifters.length === 0;
    }
    const recent = snapshot.feed[snapshot.feed.length - 1];
    if ((recent?.id ?? "") !== giftId) {
      giftId = recent?.id ?? "";
      giftStartedAt = monotonicNow();
    }
    ticker.hidden = !recent;
    reflectDetails();
  }

  reflectDetails();
  const stream = new EventSource("events");
  stream.addEventListener("open", () => {
    connected = true;
    reflectDetails();
  });
  stream.addEventListener("error", () => {
    connected = false;
    reflectDetails();
  });
  stream.addEventListener("active", (event: MessageEvent<string>) => {
    active = event.data === "true";
    reflectDetails();
  });
  stream.addEventListener("snapshot", (event: MessageEvent<string>) => {
    renderSnapshot(JSON.parse(event.data) as HalaySnapshot);
  });
  stream.addEventListener("cue", (event: MessageEvent<string>) => {
    const cues = JSON.parse(event.data) as HalayCue[];
    const now = monotonicNow();
    for (const cue of cues) {
      effects.add(cue, now);
      if (!muted && cue.effect === "drum") davul.accent();
    }
  });

  let phase = 0;
  let previous = monotonicNow();
  let tempo = 1;
  const paint = context;
  function draw(now: number): void {
    const elapsed = Math.min(55, elapsedSince(previous, now));
    previous = now;
    const target = Math.max(1, Math.min(3, latest?.tempo ?? 1));
    tempo += (target - tempo) * Math.min(1, elapsed / 150);
    const playing = connected && (active ?? Boolean(latest?.dancers.length));
    if (playing) phase = (phase + elapsed * tempo * 0.009) % (Math.PI * 2);
    paint.drawImage(backdrop, 0, 0);
    dancers.draw(paint, phase);
    effects.draw(paint, now);
    if (!muted && playing) davul.schedule(tempo);
    const feed = latest?.feed;
    if (!clean && feed?.length) {
      const offset = Math.floor(elapsedSince(giftStartedAt, now) / 4250) % Math.min(3, feed.length);
      const gift = feed[feed.length - 1 - offset].text;
      if (lastGift.textContent !== gift) lastGift.textContent = gift;
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

main();
