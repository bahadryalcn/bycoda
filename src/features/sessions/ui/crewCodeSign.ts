import { themePalette } from "../../../shared/theme/palette";
import { CODE_WIDTH, SIGN_TOP, SIGN_HEIGHT } from "./crewCodeArt";
export function crewSignImage() {
  return signLogo;
}
const SIGN_LOGO_SRC = "/brand/bycoda/logo-horizontal-white.svg";
export type SignImage = {
  paint?: (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
  image?: CanvasImageSource;
  naturalWidth: number;
  naturalHeight: number;
};
let signLogo: (HTMLImageElement & SignImage) | null = null;
let signLogoLoad: Promise<void> | null = null;
/** Loads the sign's logo once; resolves (never rejects) when it can be painted or has failed. */
export function loadCrewSignLogo(): Promise<void> {
  if (signLogoLoad) return signLogoLoad;
  if (typeof Image === "undefined") return (signLogoLoad = Promise.resolve());
  const image = new Image();
  signLogoLoad = new Promise<void>((resolve) => {
    image.onload = () => {
      signLogo = image;
      resolve();
    };
    image.onerror = () => resolve();
  });
  image.src = SIGN_LOGO_SRC;
  return signLogoLoad;
}
export function drawSign(
  c: CanvasRenderingContext2D,
  time: number,
  logo: SignImage | null = signLogo,
) {
  const cx = CODE_WIDTH / 2,
    w = 236,
    h = SIGN_HEIGHT,
    top = SIGN_TOP,
    x0 = cx - w / 2;
  c.save();
  c.translate(cx, 0);
  c.rotate(Math.sin(time / 2400) * 0.012);
  c.translate(-cx, 0);
  // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
  c.strokeStyle = themePalette.hexa8a8a8;
  c.lineWidth = 1.6;
  // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
  c.fillStyle = themePalette.hexd0d0d0;
  for (const x of [x0 + 34, x0 + w - 34]) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, top + 2);
    c.stroke();
    for (let link = 0; link < 3; link++) {
      c.beginPath();
      c.ellipse(x, 3 + link * 4.5, 1.6, 2.2, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
  c.fillStyle = themePalette.hex7a7a7a;
  c.fillRect(x0, top, w, h);
  // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
  c.fillStyle = themePalette.hex565656;
  c.fillRect(x0 + 5, top + 5, w - 10, h - 10);
  // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
  c.strokeStyle = themePalette.hexcfcfcf;
  c.lineWidth = 1.2;
  c.strokeRect(x0 + 8, top + 8, w - 16, h - 16);
  // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
  c.strokeStyle = themePalette.hex9a9a9a;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x0 + 6, top + h - 3);
  c.lineTo(x0 + w - 6, top + h - 3);
  c.stroke();
  // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
  c.fillStyle = themePalette.hexeeeeee;
  for (const x of [x0 + 4, x0 + w - 4])
    for (const y of [top + 4, top + h - 4]) {
      c.beginPath();
      c.arc(x, y, 1.5, 0, Math.PI * 2);
      c.fill();
    }
  if (logo?.naturalWidth) {
    const lw = 184,
      lh = (lw * logo.naturalHeight) / logo.naturalWidth;
    if (logo.paint) logo.paint(c, cx - lw / 2, top + (h - lh) / 2, lw, lh);
    else
      c.drawImage(
        logo.image ?? (logo as HTMLImageElement),
        cx - lw / 2,
        top + (h - lh) / 2,
        lw,
        lh,
      );
  }
  c.restore();
}
