import { useCallback, useEffect, useRef, useState } from "react";
import { DEVICE_STREAM_MAX_CHUNK_BYTES } from "../../../shared/model/host-contracts/native-devices";
import { H264AccessUnits } from "../model/h264";
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
 * turns true with the first picture; any failure ends the stream until viewing restarts,
 * so the caller falls back to still captures. Viewing only: no input is sent from here.
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

  useEffect(() => {
    if (!enabled || !stream || !deviceId || typeof VideoDecoder === "undefined") return;
    let cancelled = false;
    let painting = 0;
    let started = false;
    const id = deviceId;
    let configured: string | undefined;
    let awaitingKey = true;
    let timestamp = 0;
    const units = new H264AccessUnits();
    function stop() {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(painting);
      latest.current?.close();
      latest.current = null;
      if (decoder.state !== "closed") decoder.close();
      setActive(false);
    }
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (cancelled) return frame.close();
        latest.current?.close();
        latest.current = frame;
        if (!started) {
          started = true;
          const first = snapshot();
          if (first) onFrameRef.current(first, id);
          setActive(true);
        }
        cancelAnimationFrame(painting);
        painting = requestAnimationFrame(paint);
      },
      error: stop,
    });
    const run = async () => {
      let cursor: number | undefined;
      while (!cancelled) {
        if (document.hidden) {
          // The Host stops an unread stream; resume from a key picture.
          cursor = undefined;
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        const value = await stream(deviceId, cursor);
        if (cancelled) return;
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
