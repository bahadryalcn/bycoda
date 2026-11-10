import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Select } from "../../../shared/ui/Select";
import { Switch } from "../../../shared/ui/Switch";
import {
  AVATAR_ACCESSORY,
  AVATAR_FACE,
  AVATAR_HEADWEAR,
  AVATAR_OUTFIT,
  AVATAR_PALETTE_COUNT,
  type MemberAvatarChoice,
  type MemberAvatarTraits,
} from "../model/memberAvatarTraits";
import { MemberAvatar } from "./MemberAvatar";

function headwearLabel(value: MemberAvatarTraits["headwear"]) {
  return {
    "flat-cap": t("Flat cap"),
    takke: t("Takke"),
    beret: t("Beret"),
    bald: t("Bald"),
    "grey-hair": t("Grey hair"),
  }[value];
}
function faceLabel(value: MemberAvatarTraits["face"]) {
  return {
    walrus: t("Walrus mustache"),
    bushy: t("Bushy mustache"),
    "short-beard": t("Short beard"),
    "white-beard": t("White beard"),
    shaven: t("Clean-shaven"),
  }[value];
}
function outfitLabel(value: MemberAvatarTraits["outfit"]) {
  return { cardigan: t("Cardigan"), vest: t("Vest"), jacket: t("Jacket") }[value];
}
function accessoryLabel(value: MemberAvatarTraits["accessory"]) {
  return {
    none: t("None"),
    tespih: t("Prayer beads"),
    magnifier: t("Magnifier"),
    brush: t("Brush"),
    notebook: t("Notebook"),
    key: t("Key"),
    wrench: t("Wrench"),
    pen: t("Pen"),
  }[value];
}

const pickOne = <T,>(options: readonly T[]): T =>
  options[Math.floor(Math.random() * options.length)]!;

/** A random complete look. */
export function shuffledAvatar(): MemberAvatarChoice {
  return {
    headwear: pickOne(AVATAR_HEADWEAR),
    face: pickOne(AVATAR_FACE),
    glasses: Math.random() < 0.3,
    outfit: pickOne(AVATAR_OUTFIT),
    palette: Math.floor(Math.random() * AVATAR_PALETTE_COUNT),
    accessory: pickOne(AVATAR_ACCESSORY),
  };
}

/**
 * Appearance of one member: a large preview, one selector per part and the outfit colors as
 * tiny faces. Every change saves the full resolved look so it stays stable; Reset drops the
 * choice and returns to the look drawn from the member's seed.
 */
export function MemberAppearancePicker({
  traits,
  chosen,
  onChange,
  disabled,
}: {
  /** The look drawn now (choice over default over seed). */
  traits: MemberAvatarTraits;
  /** Whether the owner has saved a choice. */
  chosen: boolean;
  onChange: (avatar: MemberAvatarChoice | undefined) => void;
  disabled?: boolean;
}) {
  useLocale();
  const set = (patch: Partial<MemberAvatarTraits>) => onChange({ ...traits, ...patch });
  return (
    <fieldset
      disabled={disabled}
      className="flex min-w-0 flex-col gap-2 border-0 p-0"
      aria-label={t("Appearance")}
    >
      <span className="text-ui-body font-medium">{t("Appearance")}</span>
      <div className="flex min-w-0 flex-wrap items-start gap-4">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <MemberAvatar traits={traits} size={96} label={t("Member appearance preview")} />
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={() => onChange(shuffledAvatar())}>
              {t("Shuffle")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!chosen}
              onClick={() => onChange(undefined)}
            >
              {t("Reset")}
            </Button>
          </div>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-3 gap-y-2">
          <Select
            label={t("Headwear")}
            fieldVariant="compact"
            value={traits.headwear}
            options={AVATAR_HEADWEAR.map((value) => ({ value, label: headwearLabel(value) }))}
            onValueChange={(value) => set({ headwear: value as MemberAvatarTraits["headwear"] })}
          />
          <Select
            label={t("Face")}
            fieldVariant="compact"
            value={traits.face}
            options={AVATAR_FACE.map((value) => ({ value, label: faceLabel(value) }))}
            onValueChange={(value) => set({ face: value as MemberAvatarTraits["face"] })}
          />
          <Select
            label={t("Outfit")}
            fieldVariant="compact"
            value={traits.outfit}
            options={AVATAR_OUTFIT.map((value) => ({ value, label: outfitLabel(value) }))}
            onValueChange={(value) => set({ outfit: value as MemberAvatarTraits["outfit"] })}
          />
          <Select
            label={t("Accessory")}
            fieldVariant="compact"
            value={traits.accessory}
            options={AVATAR_ACCESSORY.map((value) => ({ value, label: accessoryLabel(value) }))}
            onValueChange={(value) => set({ accessory: value as MemberAvatarTraits["accessory"] })}
          />
          <Switch
            label={t("Glasses")}
            labelPosition="start"
            checked={traits.glasses}
            onCheckedChange={(on) => set({ glasses: on })}
            className="justify-between self-end"
          />
          <div
            role="group"
            aria-label={t("Colors")}
            className="col-span-full flex flex-wrap items-center gap-1"
          >
            <span className="me-1 text-ui-body">{t("Colors")}</span>
            {Array.from({ length: AVATAR_PALETTE_COUNT }, (_, palette) => (
              <Button
                key={palette}
                iconOnly
                size="sm"
                variant="ghost"
                label={t("Color set {p0}", { p0: palette + 1 })}
                pressed={traits.palette === palette}
                onClick={() => set({ palette })}
              >
                <MemberAvatar traits={{ ...traits, palette }} size={20} />
              </Button>
            ))}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
