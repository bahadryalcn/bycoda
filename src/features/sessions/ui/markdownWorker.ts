/** Keep worker creation shared by the UI and the production-bundle regression test. */
export function createMarkdownWorker(): Worker {
  return new Worker(new URL("./streamingMarkdown.worker.ts", import.meta.url), {
    type: "module",
    name: "markdown-parser",
  });
}
