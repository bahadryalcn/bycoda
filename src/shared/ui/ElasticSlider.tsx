import {
  ElasticSlider as ArcElasticSlider,
  type ElasticSliderProps,
} from "./arc/elastic-slider/elastic-slider";

export type { ElasticSliderProps, ElasticSliderMark } from "./arc/elastic-slider/elastic-slider";

/** Bounded visual adjustment; use NumberField when an exact typed value is required. */
export function ElasticSlider({ className, ...props }: ElasticSliderProps) {
  return (
    <ArcElasticSlider {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />
  );
}
