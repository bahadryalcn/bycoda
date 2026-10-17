import { Slider as ArcSlider, type SliderProps, type SliderValue } from "./arc/slider/slider";

export type { SliderProps, SliderValue, SliderMark } from "./arc/slider/slider";

/** Bounded adjustment with separate live-change and commit callbacks. */
export function Slider<T extends SliderValue = number>({ className, ...props }: SliderProps<T>) {
  return (
    <ArcSlider
      {...props}
      className={["bycoda-arc bycoda-arc-slider", className].filter(Boolean).join(" ")}
    />
  );
}
