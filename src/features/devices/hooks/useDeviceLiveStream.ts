import { useCallback, useEffect, useRef, useState } from "react";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { DEVICE_STREAM_MAX_CHUNK_BYTES } from "../../../shared/model/host-contracts/native-devices";
import { H264AccessUnits } from "../model/h264";
import {
  DECODE_POLL_MS,
  DECODE_QUEUE_LIMIT,
  DECODE_STALL_MS,
  isFatalStreamFailure,
  STREAM_HEALTHY_MS,
  STREAM_RETRY_DELAYS_MS,
} from "../model/liveStreamRecovery";
import type { DeviceFrame, DevicePanelApi } from "../types";

type Size = { width: number; height: number };

function decodeBase64(value: string): Uint8Array {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/**
 * Follows the device screen as video: long-polls the Host's H.264 stream, decodes it with
 * WebCodecs and paints the newest picture on a canvas laid over the still frame. `active`
 * turns true with the first picture. A decoder that falls behind drops its backlog and resumes
 * at the next key picture. A transient failure (connection, timeout, decoder fault) turns
 * `active` off, so still captures cover the gap, and retries from a fresh key picture with a
 * short backoff and a cap; a failure no retry fixes (unsupported device, revoked authority,
 * refused credential) or an exhausted cap ends the stream until viewing restarts. Viewing
 * only: no input is sent from here.
 */
export function useDeviceLiveStream({
  stream,
  deviceId,
  enabled,
  onFrame,
}: {
  stream: DevicePanelApi["stream"];
  deviceId: string;
  enabled: boolean;
  /** A still of the first picture, so the caller has a frame to lay the video over. */
  onFrame: (frame: DeviceFrame, deviceId: string) => void;
}) {
  const [active, setActive] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef<VideoFrame | null>(null);
  const deviceSize = useRef<Size>({ width: 0, height: 0 });
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const paint = useCallback(() => {
    const frame = latest.current;
    const node = canvas.current;
    if (!frame || !node) return;
    if (node.width !== frame.displayWidth || node.height !== frame.displayHeight) {
      node.width = frame.displayWidth;
      node.height = frame.displayHeight;
      node.style.setProperty("--device-aspect", String(frame.displayWidth / frame.displayHeight));
    }
    node.getContext("2d")?.drawImage(frame, 0, 0);
  }, []);

  /** The picture on screen now, at the device's own pixel size. */
  const snapshot = useCallback((): DeviceFrame | undefined => {
    const frame = latest.current;
    if (!frame) return undefined;
    const size = deviceSize.current;
    const rotated = frame.displayWidth > frame.displayHeight !== size.width > size.height;
    const still = document.createElement("canvas");
    still.width = (rotated ? size.height : size.width) || frame.displayWidth;
    still.height = (rotated ? size.width : size.height) || frame.displayHeight;
    const context = still.getContext("2d");
    if (!context) return undefined;
    context.drawImage(frame, 0, 0, still.width, still.height);
    const base64 = still.toDataURL("image/jpeg", 0.92).split(",")[1];
    return base64
      ? { mime: "image/jpeg", base64, capturedAt: new Date().toISOString() }
      : undefined;
  }, []);

  // Runs one stream session per device while viewing is on; the cleanup (`stop`) ends it, and
  // every callback below checks `cancelled`, so nothing from a replaced session reaches the UI.
  useEffect(() => {
    if (!enabled || !stream || !deviceId || typeof VideoDecoder === "undefined") return;
    let cancelled = false;
    let painting = 0;
    let started = false;
    // The device and the stream reader never change inside one session: a retry re-reads the
    // same device through the same authorized reader, and a changed device starts a new session.
    const id = deviceId;
    let configured: string | undefined;
    let awaitingKey = true;
    let timestamp = 0;
    let failures = 0;
    let healthyAt: number | undefined;
    let decoderFailure: Error | undefined;
    let wake: (() => void) | undefined;
    const units = new H264AccessUnits();
    /** Resolves after `ms`, or at once when the session ends. */
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        };
        const timer = setTimeout(done, ms);
        wake = done;
      });
    function discardPicture() {
      cancelAnimationFrame(painting);
      latest.current?.close();
      latest.current = null;
    }
    function stop() {
      if (cancelled) return;
      cancelled = true;
      wake?.();
      discardPicture();
      if (decoder.state !== "closed") decoder.close();
      setActive(false);
    }
    function openDecoder(): VideoDecoder {
      const own: VideoDecoder = new VideoDecoder({
        output: (frame) => {
          if (cancelled || own !== decoder) return frame.close();
          latest.current?.close();
          latest.current = frame;
          healthyAt ??= monotonicNow();
          if (!started) {
            started = true;
            const first = snapshot();
            if (first) onFrameRef.current(first, id);
            setActive(true);
          }
          cancelAnimationFrame(painting);
          painting = requestAnimationFrame(paint);
        },
        // A decoder that reports an error is closed for good; `run` replaces it.
        error: (cause) => {
          if (own === decoder) decoderFailure = cause ?? new Error("Video decoder failed");
        },
      });
      return own;
    }
    let decoder: VideoDecoder = openDecoder();
    /** Drops everything of the failed attempt; the next attempt starts from a key picture. */
    function recover() {
      discardPicture();
      if (decoder.state !== "closed") decoder.close();
      decoder = openDecoder();
      decoderFailure = undefined;
      units.reset();
      configured = undefined;
      awaitingKey = true;
      started = false;
      healthyAt = undefined;
      // Still captures take over while the video is down; a frozen picture would pass as live.
      setActive(false);
    }
    /**
     * Waits while the decoder is behind. A queue that stays full is real lag, not a burst, so
     * its backlog is discarded and decoding resumes at the next key picture.
     */
    async function relieveDecoder() {
      for (let waited = 0; decoder.decodeQueueSize > DECODE_QUEUE_LIMIT; waited += DECODE_POLL_MS) {
        if (cancelled || decoderFailure) return;
        if (waited >= DECODE_STALL_MS) {
          decoder.reset();
          configured = undefined;
          awaitingKey = true;
          return;
        }
        await pause(DECODE_POLL_MS);
      }
    }
    const run = async () => {
      let cursor: number | undefined;
      while (!cancelled) {
        try {
          if (document.hidden) {
            // The Host stops an unread stream; resume from a key picture.
            cursor = undefined;
            await pause(500);
            continue;
          }
          if (decoderFailure) throw decoderFailure;
          const value = await stream(id, cursor);
          if (cancelled) return;
          if (decoderFailure) throw decoderFailure;
          cursor = value.cursor;
          deviceSize.current = { width: value.width, height: value.height };
          if (value.reset) {
            units.reset();
            decoder.reset();
            configured = undefined;
            awaitingKey = true;
          }
          if (!value.base64) continue;
          const bytes = decodeBase64(value.base64);
          // A response ends on a recorder write unless the size cap cut it.
          for (const unit of units.push(bytes, bytes.length < DEVICE_STREAM_MAX_CHUNK_BYTES)) {
            if (decoder.decodeQueueSize > DECODE_QUEUE_LIMIT) await relieveDecoder();
            if (cancelled) return;
            if (decoderFailure) throw decoderFailure;
            if (unit.key && unit.codec && unit.codec !== configured) {
              decoder.configure({ codec: unit.codec, optimizeForLatency: true });
              configured = unit.codec;
            }
            if (!configured || (awaitingKey && !unit.key)) continue;
            awaitingKey = false;
            decoder.decode(
              new EncodedVideoChunk({
                type: unit.key ? "key" : "delta",
                timestamp: timestamp++,
                data: unit.data,
              }),
            );
          }
        } catch (cause) {
          if (cancelled) return;
          if (isFatalStreamFailure(cause)) return stop();
          if (healthyAt !== undefined && elapsedSince(healthyAt) >= STREAM_HEALTHY_MS) failures = 0;
          const delay = STREAM_RETRY_DELAYS_MS[failures++];
          if (delay === undefined) return stop();
          recover();
          cursor = undefined;
          await pause(delay);
        }
      }
    };
    run().catch(stop);
    return stop;
  }, [enabled, stream, deviceId, paint, snapshot]);

  const canvasRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvas.current = node;
      paint();
    },
    [paint],
  );
  return { active, canvasRef, snapshot };
}
