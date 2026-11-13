import type {
  BrowserAnnotationCapture,
  BrowserElementTarget,
} from "../../../shared/lib/browserAnnotation";

/** Browser response fields retained by the view across status, input and frame reads. */
export type BrowserViewState = {
  open: boolean;
  url: string | null;
  controlling: boolean;
  leaseId?: string;
  leaseExpiresAt?: number;
  data?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  viewport?: { width: number; height: number };
  navigationId?: string;
  documentId?: string;
  frameSequence?: number;
  cursor?: string;
  annotationId?: string;
  selection?: BrowserAnnotationCapture;
  hover?: BrowserElementTarget;
  limitation?: string;
  runtime?: { installed: boolean; installing: boolean; version: string };
};
