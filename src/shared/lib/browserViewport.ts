export const BROWSER_VIEWPORT_MIN = 240;
export const BROWSER_VIEWPORT_MAX_WIDTH = 3840;
export const BROWSER_VIEWPORT_MAX_HEIGHT = 2160;

export const BROWSER_VIEWPORT_PRESETS = [
  { id: "desktop", label: "Desktop", width: 1280, height: 720 },
  { id: "1k", label: "1K", width: 1024, height: 576 },
  { id: "full-hd", label: "Full HD", width: 1920, height: 1080 },
  { id: "2k", label: "2K", width: 2560, height: 1440 },
  { id: "4k", label: "4K", width: 3840, height: 2160 },
  { id: "tablet", label: "Tablet", width: 768, height: 1024 },
  { id: "phone", label: "Phone", width: 390, height: 844 },
] as const;

export const validBrowserViewportDimension = (value: unknown, maximum: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= BROWSER_VIEWPORT_MIN &&
  value <= maximum;
