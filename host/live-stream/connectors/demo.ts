import type { LiveEvent, LiveViewer } from "../../../src/features/live-stream/model/liveEvents";

const names = [
  "Deniz",
  "Ece",
  "Barış",
  "Aslı",
  "İpek",
  "Cem",
  "Zeynep",
  "Can",
  "Elif",
  "Mert",
  "Ceren",
  "Ozan",
  "Selin",
  "Bora",
  "Yağmur",
  "Kerem",
  "Duru",
  "Emre",
  "Aylin",
  "Eren",
  "Nil",
  "Berk",
  "Seda",
  "Umut",
  "Melis",
  "Yiğit",
  "Ada",
  "Arda",
  "Eylül",
  "Defne",
];

const comments = ["Hello!", "Great stream", "Greetings from here", "Love it", "Let's go"];

export function connectDemo(emit: (event: LiveEvent) => void) {
  let sequence = 0;
  const viewer = (index: number): LiveViewer => ({
    id: `demo-${index}`,
    handle: `demo_${index}`,
    name: names[index % names.length],
  });
  function tick() {
    const index = sequence++;
    const base = { id: `demo:${index}`, at: Date.now() };
    if (index < 24 || index % 7 === 0) {
      emit({
        ...base,
        kind: "comment",
        viewer: viewer(index % 120),
        text: comments[index % comments.length],
      });
    } else if (index % 4 === 0) {
      const gift = Math.floor(index / 4) % 4;
      emit({
        ...base,
        kind: "gift",
        viewer: viewer(index % 24),
        giftId: gift,
        giftName: ["Gül", "Nazar Boncuğu", "Türk Bayrağı", "Aslan"][gift],
        diamonds: [1, 5, 30, 299][gift],
        count: 1,
      });
    } else if (index % 6 === 0) {
      emit({ ...base, kind: "viewers", count: 40 + (index % 150) });
    } else {
      emit({ ...base, kind: "like", viewer: viewer(index % 24), count: 12 + (index % 64) });
    }
  }
  for (let index = 0; index < 24; index++) tick();
  const timer = setInterval(tick, 700);
  timer.unref();
  return () => clearInterval(timer);
}
