type CommitEffect = () => void | Promise<void>;

export function dispatchCommittedEffect(effect: CommitEffect): void {
  try {
    void Promise.resolve(effect()).catch((error) =>
      console.error("Committed command dispatch failed:", error),
    );
  } catch (error) {
    console.error("Committed command dispatch failed:", error);
  }
}

/** Effects belong to the outer SQL transaction, including all nested work. */
export class TransactionEffects {
  commit: CommitEffect[] = [];
  private rollback: Array<() => void> = [];

  afterRollback(effect: () => void): void {
    this.rollback.push(effect);
  }

  committed(): CommitEffect[] {
    this.rollback = [];
    return this.commit.splice(0);
  }

  rolledBack(): void {
    this.commit = [];
    for (const effect of this.rollback.splice(0).reverse()) {
      try {
        effect();
      } catch (error) {
        console.error("Could not restore rolled-back Host observation:", error);
      }
    }
  }
}
