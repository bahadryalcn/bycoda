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
  /** Host clock: when the lease ends there. Compare only with the Host's own clock, never this client's. */
  leaseExpiresAt?: number;
  /** Host-reported remaining lifetime of the lease, measured when the Host answered. */
  leaseTtlMs?: number;
  /** Local `monotonicNow()` deadline derived from `leaseTtlMs`; set when the response arrives. */
  leaseDeadline?: number;
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
