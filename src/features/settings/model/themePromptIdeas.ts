import { t } from "../../../shared/i18n";

/**
 * Parts the dice button combines into a theme prompt: a scene, a light and a finish. Combining
 * them gives hundreds of distinct prompts instead of a short fixed list; each part is its own
 * catalog entry, and the parts are joined with commas so no locale needs sentence grammar.
 */
const scenes = () => [
  t("midnight ocean"),
  t("warm kiln at dusk"),
  t("foggy pine forest"),
  t("neon Tokyo rain"),
  t("quiet desert sunrise"),
  t("soft paper and ink"),
  t("deep space nebula"),
  t("autumn café window"),
  t("arctic glacier"),
  t("volcanic basalt"),
  t("cherry blossom garden"),
  t("abandoned observatory"),
  t("rainy library"),
  t("coral reef"),
  t("cyberpunk alley"),
  t("lavender field"),
  t("old terminal room"),
  t("mountain lake at dawn"),
  t("copper workshop"),
  t("northern lights over snow"),
  t("jungle temple"),
  t("concrete brutalist hall"),
  t("vintage film studio"),
  t("sakura night market"),
];

const lights = () => [
  t("moonlight"),
  t("golden hour"),
  t("candle glow"),
  t("blue hour"),
  t("overcast daylight"),
  t("neon glow"),
  t("starlight"),
  t("ember light"),
  t("misty haze"),
  t("bioluminescence"),
];

const finishes = () => [
  t("full black"),
  t("muted pastels"),
  t("high contrast"),
  t("low saturation"),
  t("monochrome"),
  t("rich jewel tones"),
  t("airy and light"),
  t("matte and calm"),
  t("glassy layers"),
  t("retro CRT"),
  t("minimal"),
  t("cinematic"),
];

const pick = <T>(items: readonly T[], random: () => number): T =>
  items[Math.floor(random() * items.length)] ?? items[0]!;

/**
 * A new prompt different from `current`: always a scene, usually a light, sometimes a finish.
 * `random` is injectable so the spread is testable.
 */
export function randomThemePrompt(current = "", random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const parts = [pick(scenes(), random)];
    if (random() < 0.8) parts.push(pick(lights(), random));
    if (random() < 0.5) parts.push(pick(finishes(), random));
    const prompt = parts.join(", ");
    if (prompt !== current) return prompt;
  }
  return pick(scenes(), random);
}
