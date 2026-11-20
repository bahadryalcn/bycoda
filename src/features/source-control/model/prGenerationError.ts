/** Pull request text generation failed; `cause` keeps the provider's own text out of the UI. */
export class PrGenerationError extends Error {
  constructor(cause: unknown) {
    super("Could not generate a pull request description.", { cause });
    this.name = "PrGenerationError";
  }
}
