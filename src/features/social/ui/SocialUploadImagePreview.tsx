import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import type { SocialClient } from "../model/socialClient";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;

function imageSource(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("Invalid image preview.");
  const { mime, base64 } = value as { mime?: unknown; base64?: unknown };
  if (
    (mime !== "image/png" && mime !== "image/jpeg") ||
    typeof base64 !== "string" ||
    !base64.length ||
    base64.length > MAX_BASE64 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    throw new Error("Invalid image preview.");
  const bytes = atob(base64);
  if (!bytes.length || bytes.length > MAX_BYTES || btoa(bytes) !== base64)
    throw new Error("Invalid image preview.");
  const expected = mime === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
  if (expected.some((byte, index) => bytes.charCodeAt(index) !== byte))
    throw new Error("Invalid image preview.");
  return `data:${mime};base64,${base64}`;
}

type Preview = {
  client: SocialClient;
  uploadId: string;
  attempt: number;
  phase: "pending" | "ready" | "error";
  source?: string;
};

/** Owner-only, bounded image read. Previewing never approves or publishes media. */
export function SocialUploadImagePreview({
  client,
  uploadId,
  alt,
  active = true,
}: {
  client: SocialClient;
  uploadId: string;
  alt?: string;
  active?: boolean;
}) {
  useLocale();
  const [preview, setPreview] = useState<Preview>();
  const [attempt, setAttempt] = useState(0);
  const version = useRef(0);
  useEffect(() => {
    const current = ++version.current;
    if (!active) {
      setPreview(undefined);
      return;
    }
    const scope = { client, uploadId, attempt };
    setPreview({ ...scope, phase: "pending" });
    void (async () => {
      try {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(uploadId)) throw new Error("Invalid image upload.");
        const result = await client.request<unknown>("programs.media-preview", { uploadId });
        if (version.current !== current) return;
        const source = imageSource(result);
        setPreview({ ...scope, phase: "ready", source });
      } catch {
        if (version.current === current) setPreview({ ...scope, phase: "error" });
      }
    })();
    return () => {
      version.current++;
    };
  }, [client, uploadId, attempt, active]);
  if (!active) return null;
  const current =
    preview?.client === client && preview.uploadId === uploadId && preview.attempt === attempt
      ? preview
      : undefined;
  if (current?.phase === "ready")
    return (
      <img
        src={current.source}
        alt={alt || t("Uploaded image preview")}
        referrerPolicy="no-referrer"
        style={{ display: "block", maxWidth: "100%", maxHeight: 320, objectFit: "contain" }}
        onError={() => {
          setPreview((value) =>
            value === current ? { ...value, phase: "error", source: undefined } : value,
          );
        }}
      />
    );
  if (current?.phase === "error")
    return (
      <div>
        <p role="alert">{t("Image preview could not be loaded.")}</p>
        <Button type="button" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          {t("Retry")}
        </Button>
      </div>
    );
  return <p role="status">{t("Loading image preview…")}</p>;
}
