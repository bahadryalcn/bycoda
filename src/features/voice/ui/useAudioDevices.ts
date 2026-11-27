import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n";

export type AudioDeviceKind = "audioinput" | "audiooutput";

export type AudioDeviceChoice = { value: string; label: string; disabled?: boolean };

/**
 * Lists audio devices of one kind and follows plug and unplug without requesting capture.
 * Browsers hide ids until microphone permission is granted, so `unidentified` tells an unknown
 * list apart from an unplugged device.
 */
export function useAudioDevices(kind: AudioDeviceKind) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [unidentified, setUnidentified] = useState(false);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the devicechange listener attached only while a device picker is mounted, without requesting capture.
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void navigator.mediaDevices
        ?.enumerateDevices?.()
        .then((all) => {
          if (!live) return;
          const matching = all.filter((device) => device.kind === kind);
          setDevices(matching.filter((device) => device.deviceId));
          setUnidentified(matching.some((device) => !device.deviceId));
        })
        .catch(() => {
          if (live) setDevices([]);
        });
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      live = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [kind]);
  return { devices, unidentified };
}

/** "System default", every listed device and, when the saved one is gone, a disabled entry for it. */
export function audioDeviceChoices(
  kind: AudioDeviceKind,
  devices: MediaDeviceInfo[],
  unidentified: boolean,
  selected: string | undefined,
): AudioDeviceChoice[] {
  const missing =
    !!selected && !unidentified && !devices.some((device) => device.deviceId === selected);
  return [
    { value: "", label: t("System default") },
    ...devices.map((device, index) => ({
      value: device.deviceId,
      label:
        device.label ||
        (kind === "audioinput"
          ? t("Microphone {p1}", { p1: String(index + 1) })
          : t("Audio output {p1}", { p1: String(index + 1) })),
    })),
    ...(missing
      ? [
          {
            value: selected,
            label:
              kind === "audioinput"
                ? t("Selected microphone unavailable")
                : t("Selected audio output unavailable"),
            disabled: true,
          },
        ]
      : []),
  ];
}
