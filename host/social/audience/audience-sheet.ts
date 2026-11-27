import { Worker } from "node:worker_threads";
import {
  AUDIENCE_IMPORT_MAX_COLUMNS,
  AUDIENCE_IMPORT_MAX_ROWS,
  AUDIENCE_IMPORT_MAX_SHEET_ROWS,
  AUDIENCE_IMPORT_MAX_UNZIPPED_BYTES,
} from "../../../src/features/social/model/socialContactImport";

const PARSE_TIMEOUT_MS = 30_000;
const WORKER_HEAP_MB = 256;
const MAX_ARCHIVE_ENTRIES = 1000;
/** Parses waiting behind the running one; more is refused so a flood cannot queue work forever. */
const MAX_WAITING = 4;

let waiting = 0;
let tail: Promise<void> = Promise.resolve();

type WorkerReply = { rows?: string[][]; error?: string; limit?: boolean };

/**
 * First worksheet of an .xlsx file as rows of text, parsed off the Host event loop in a worker
 * thread. One parse runs at a time, with a heap cap and a deadline; the worker is always
 * terminated. A file over a limit fails with the limit's own message, anything else with a
 * generic one.
 */
export async function readAudienceWorkbook(bytes: Uint8Array): Promise<string[][]> {
  if (waiting >= MAX_WAITING) throw new Error("Another import is still being read. Retry shortly.");
  waiting++;
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    const worker = new Worker(new URL("./audience-sheet-worker.mjs", import.meta.url), {
      workerData: {
        bytes,
        limits: {
          maxRows: AUDIENCE_IMPORT_MAX_ROWS,
          maxSheetRows: AUDIENCE_IMPORT_MAX_SHEET_ROWS,
          maxColumns: AUDIENCE_IMPORT_MAX_COLUMNS,
          maxUnzippedBytes: AUDIENCE_IMPORT_MAX_UNZIPPED_BYTES,
          maxEntries: MAX_ARCHIVE_ENTRIES,
        },
      },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
    try {
      return await new Promise<string[][]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Reading the spreadsheet took too long. Split the file.")),
          PARSE_TIMEOUT_MS,
        );
        const fail = (error: Error) => {
          clearTimeout(timer);
          reject(error);
        };
        worker.once("message", (reply: WorkerReply) => {
          clearTimeout(timer);
          if (reply.rows) resolve(reply.rows);
          else reject(new Error(reply.error ?? "The spreadsheet could not be read."));
        });
        // A heap-limit stop or crash surfaces as an error or an exit without a message.
        worker.once("error", () => fail(new Error("The spreadsheet is too large to read.")));
        worker.once("exit", () => fail(new Error("The spreadsheet could not be read.")));
      });
    } finally {
      await worker.terminate();
    }
  } finally {
    waiting--;
    release();
  }
}
