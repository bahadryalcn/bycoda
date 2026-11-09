import {
  ElasticSlider as ArcElasticSlider,
  type ElasticSliderProps,
} from "./arc/elastic-slider/elastic-slider";

export type { ElasticSliderProps, ElasticSliderMark } from "./arc/elastic-slider/elastic-slider";

/**
 * Drag-to-taste slider with elastic overscroll feel; values stay clamped to the range and
 * reduced motion is respected.
 * @group fields
 * @use Approximate, visual adjustment where feel matters (an Appearance preview value).
 * @avoid Precise or dense settings: Slider. Exact typed values: NumberField.
 * @arc elastic-slider
 */
export function ElasticSlider({ className, ...props }: ElasticSliderProps) {
  return (
    <ArcElasticSlider {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />
  );
}
