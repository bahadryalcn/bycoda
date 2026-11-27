import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../../shared/lib/errors";
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
import type { DeviceFrame, DevicePanelApi, DeviceStreamChunk } from "../types";

type Size = { width: number; height: number };
type LivePicture = Size & { aspect: number };

// Bound data waiting behind the decoder, including when a Host catches up in a burst.
const PUSH_QUEUE_LIMIT = 8;
const PUSH_FRAGMENT_LIMIT = 64;
const PUSH_BASE64_LIMIT =
  Math.ceil(DEVICE_STREAM_MAX_CHUNK_BYTES / 3) * 4 + PUSH_FRAGMENT_LIMIT * 4;
const RESTART_PUSH = Symbol("restart device stream");

function canFallBackToPolling(cause: unknown, setupFailed: boolean | undefined) {
  return (
    /unsupported (?:host method|remote operation)|RPC_WS_UNSUPPORTED/i.test(errorText(cause)) ||
    (setupFailed && !isFatalStreamFailure(cause))
  );
}

function decodeBase64(value: string): Uint8Array {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/**
 * Follows the device screen as video: receives the Host's H.264 stream, decodes it with
 * WebCodecs and paints the newest picture on a canvas. `picture` gives the preview geometry
 * when video is available. A decoder that falls behind drops its backlog and resumes
 * at the next key picture. A transient failure (connection, timeout, decoder fault) turns
 * `picture` off, so still captures cover the gap, and retries from a fresh key picture with a
 * short backoff and a cap; a failure no retry fixes (unsupported device, revoked authority,
 * refused credential) or an exhausted cap ends the stream until viewing restarts. Viewing
 * only: no input is sent from here.
 */
export function useDeviceLiveStream({
  stream,
  subscribeStream,
  deviceId,
  enabled,
  onFrame,
  onInterrupted,
}: {
  stream: DevicePanelApi["stream"];
  subscribeStream?: DevicePanelApi["subscribeStream"];
  deviceId: string;
  enabled: boolean;
  onFrame: (deviceId: string) => void;
  onInterrupted: (deviceId: string, lastFrame?: DeviceFrame) => void;
}) {
  const [live, setLive] = useState<{
    deviceId: string;
    stream: DevicePanelApi["stream"];
    subscribeStream: DevicePanelApi["subscribeStream"];
    picture: LivePicture;
  }>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef<VideoFrame | null>(null);
  const deviceSize = useRef<Size>({ width: 0, height: 0 });
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const onInterruptedRef = useRef(onInterrupted);
  onInterruptedRef.current = onInterrupted;

  const paint = useCallback(() => {
    const frame = latest.current;
    const node = canvas.current;
    if (!frame || !node) return;
    if (node.width !== frame.displayWidth || node.height !== frame.displayHeight) {
      node.width = frame.displayWidth;
      node.height = frame.displayHeight;
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
    if (
      !enabled ||
      (!stream && !subscribeStream) ||
      !deviceId ||
      typeof VideoDecoder === "undefined"
    )
      return;
    let cancelled = false;
    let painting: number | undefined;
    let picture: LivePicture | undefined;
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
    let push: ReturnType<typeof openPush> | undefined;
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
    function openPush(subscribe: NonNullable<DevicePanelApi["subscribeStream"]>) {
      let closed = false;
      let unsubscribe: (() => void) | undefined;
      let failure: { cause: unknown; setup: boolean } | undefined;
      let receive: (() => void) | undefined;
      const queue: DeviceStreamChunk[] = [];
      let pictures = 0;
      let queuedChars = 0;
      const fail = (cause: unknown, setup = false) => {
        if (closed || failure) return;
        failure = { cause, setup };
        queue.length = 0;
        receive?.();
      };
      Promise.resolve()
        .then(() => {
          if (closed) return;
          return subscribe(
            id,
            (value) => {
              if (closed || failure) return;
              // Several transport fragments can belong to the same encoded picture.
              pictures += Number(value.boundary !== false);
              queuedChars += value.base64.length;
              if (
                pictures > PUSH_QUEUE_LIMIT ||
                queuedChars > PUSH_BASE64_LIMIT ||
                queue.length >= PUSH_FRAGMENT_LIMIT
              )
                return fail(RESTART_PUSH);
              queue.push(value);
              receive?.();
            },
            (cause) => fail(cause),
          );
        })
        .then((cleanup) => {
          if (closed) cleanup?.();
          else unsubscribe = cleanup;
        })
        .catch((cause) => fail(cause, true));
      return {
        get failure() {
          return failure;
        },
        async read() {
          if (!queue.length && !failure && !closed) {
            await new Promise<void>((resolve) => {
              receive = () => {
                receive = undefined;
                resolve();
              };
            });
          }
          if (failure) throw failure.cause;
          const next = queue.shift();
          if (next) {
            pictures -= Number(next.boundary !== false);
            queuedChars -= next.base64.length;
          }
          return next;
        },
        interrupt() {
          receive?.();
        },
        close() {
          closed = true;
          queue.length = 0;
          receive?.();
          unsubscribe?.();
        },
      };
    }
    function discardPicture() {
      if (painting !== undefined) cancelAnimationFrame(painting);
      painting = undefined;
      latest.current?.close();
      latest.current = null;
    }
    function stop() {
      if (cancelled) return;
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wake?.();
      push?.close();
      discardPicture();
      if (decoder.state !== "closed") decoder.close();
      setLive(undefined);
    }
    function onVisibilityChange() {
      push?.interrupt();
    }
    function openDecoder(): VideoDecoder {
      const own: VideoDecoder = new VideoDecoder({
        output: (frame) => {
          if (cancelled || own !== decoder || push?.failure) return frame.close();
          latest.current?.close();
          latest.current = frame;
          healthyAt ??= monotonicNow();
          const aspect = frame.displayWidth / frame.displayHeight;
          const size = deviceSize.current;
          const rotated = aspect > 1 !== size.width > size.height;
          const width = (rotated ? size.height : size.width) || frame.displayWidth;
          const height = (rotated ? size.width : size.height) || frame.displayHeight;
          if (picture?.width !== width || picture.height !== height || picture.aspect !== aspect) {
            if (!picture) onFrameRef.current(id);
            picture = { width, height, aspect };
            setLive({ deviceId: id, stream, subscribeStream, picture });
          }
          painting ??= requestAnimationFrame(() => {
            painting = undefined;
            paint();
          });
        },
        // A decoder that reports an error is closed for good; `run` replaces it.
        error: (cause) => {
          if (own !== decoder) return;
          decoderFailure = cause ?? new Error("Video decoder failed");
          push?.interrupt();
        },
      });
      return own;
    }
    let decoder: VideoDecoder = openDecoder();
    /** Drops everything of the failed attempt; the next attempt starts from a key picture. */
    function recover(keepPicture = false) {
      if (keepPicture && latest.current) {
        let lastFrame: DeviceFrame | undefined;
        try {
          lastFrame = snapshot();
        } catch {
          // A lost canvas can still recover through the next stream or still capture.
        }
        onInterruptedRef.current(id, lastFrame);
      }
      discardPicture();
      if (decoder.state !== "closed") decoder.close();
      decoder = openDecoder();
      decoderFailure = undefined;
      units.reset();
      configured = undefined;
      awaitingKey = true;
      picture = undefined;
      healthyAt = undefined;
      // Still captures take over while the video is down; a frozen picture would pass as live.
      setLive(undefined);
    }
    /**
     * Waits while the decoder is behind. A queue that stays full is real lag, not a burst, so
     * its backlog is discarded and decoding resumes at the next key picture.
     */
    async function relieveDecoder() {
      for (let waited = 0; decoder.decodeQueueSize > DECODE_QUEUE_LIMIT; waited += DECODE_POLL_MS) {
        if (cancelled || decoderFailure || push?.failure) return;
        if (waited >= DECODE_STALL_MS) {
          if (push) throw RESTART_PUSH;
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
      let subscribe = subscribeStream;
      let splitBytes = 0;
      while (!cancelled) {
        try {
          if (document.hidden) {
            // The Host stops an unread stream; resume from a key picture.
            if (push) {
              push.close();
              push = undefined;
              recover();
            }
            cursor = undefined;
            splitBytes = 0;
            await pause(500);
            continue;
          }
          if (decoderFailure) throw decoderFailure;
          if (subscribe) push ??= openPush(subscribe);
          const value = push ? await push.read() : await stream?.(id, cursor);
          if (cancelled) return;
          if (push && document.hidden) continue;
          if (push?.failure) throw push.failure.cause;
          if (decoderFailure) throw decoderFailure;
          if (!value) continue;
          const bytes = value.base64 ? decodeBase64(value.base64) : undefined;
          if (
            push &&
            !value.reset &&
            cursor !== undefined &&
            value.cursor !== cursor + (bytes?.length ?? 0)
          ) {
            throw RESTART_PUSH;
          }
          cursor = value.cursor;
          deviceSize.current = { width: value.width, height: value.height };
          if (value.reset) {
            splitBytes = 0;
            if (push && configured) {
              recover(true);
            } else {
              units.reset();
              decoder.reset();
              configured = undefined;
              awaitingKey = true;
            }
          }
          if (!bytes) continue;
          // Old Hosts use the size cap to indicate a split recorder write.
          const boundary = value.boundary ?? bytes.length < DEVICE_STREAM_MAX_CHUNK_BYTES;
          if (push) {
            splitBytes = boundary ? 0 : splitBytes + bytes.length;
            if (splitBytes > DEVICE_STREAM_MAX_CHUNK_BYTES) throw RESTART_PUSH;
          }
          for (const unit of units.push(bytes, boundary)) {
            if (decoder.decodeQueueSize > DECODE_QUEUE_LIMIT) await relieveDecoder();
            if (cancelled) return;
            if (push?.failure) throw push.failure.cause;
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
          const usePolling = push && stream && canFallBackToPolling(cause, push.failure?.setup);
          push?.close();
          push = undefined;
          cursor = undefined;
          splitBytes = 0;
          if (usePolling) {
            subscribe = undefined;
            recover();
            continue;
          }
          if (cause !== RESTART_PUSH && isFatalStreamFailure(cause)) return stop();
          if (healthyAt !== undefined && elapsedSince(healthyAt) >= STREAM_HEALTHY_MS) failures = 0;
          const delay = STREAM_RETRY_DELAYS_MS[failures++];
          recover(true);
          if (delay === undefined) return stop();
          // A cursor gap needs a fresh key frame. Reopen once immediately, then back off.
          if (cause !== RESTART_PUSH || failures > 1) await pause(delay);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    run().catch(stop);
    return stop;
  }, [enabled, stream, subscribeStream, deviceId, paint, snapshot]);

  const canvasRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvas.current = node;
      paint();
    },
    [paint],
  );
  return {
    picture:
      enabled &&
      live?.deviceId === deviceId &&
      live.stream === stream &&
      live.subscribeStream === subscribeStream
        ? live.picture
        : undefined,
    canvasRef,
    snapshot,
  };
}
