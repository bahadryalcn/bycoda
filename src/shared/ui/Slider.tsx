import { Slider as ArcSlider, type SliderProps, type SliderValue } from "./arc/slider/slider";

export type { SliderProps, SliderValue, SliderMark } from "./arc/slider/slider";

/**
 * Bounded range input (single or range value) with marks, a live `onChange` and a separate commit callback.
 * @group fields
 * @use Approximate adjustment inside a bounds (opacity, zoom, speed).
 * @avoid A precise value: NumberField. Few discrete modes: SegmentedControl.
 * @arc slider
 */
export function Slider<T extends SliderValue = number>({ className, ...props }: SliderProps<T>) {
  return (
    <ArcSlider
      {...props}
      className={["bycoda-arc bycoda-arc-slider", className].filter(Boolean).join(" ")}
    />
  );
}
