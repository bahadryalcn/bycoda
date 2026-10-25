import { AsyncLocalStorage } from "node:async_hooks";

/** Orders events and command persistence without holding unrelated sessions. */
export class EngineOperations {
  private readonly owners = new AsyncLocalStorage<{ key: string; active: boolean }>();
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, work: () => T | Promise<T>): Promise<T> {
    const owner = this.owners.getStore();
    if (owner?.active && owner.key === key) {
      try {
        return Promise.resolve(work());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return this.enqueue(key, work);
  }

  enqueue<T>(key: string, work: () => T | Promise<T>): Promise<T> {
    const owner = { key, active: true };
    const previous = this.tails.get(key);
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<T>((done, failed) => {
      resolve = done;
      reject = failed;
    });
    const tail = result.then(
      () => {},
      () => {},
    );
    this.tails.set(key, tail);
    const execute = () => {
      this.owners
        .run(owner, async () => {
          try {
            return await work();
          } finally {
            owner.active = false;
          }
        })
        .then(resolve, reject);
    };
    if (previous) void previous.then(execute);
    else execute();
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  async drain(key?: string): Promise<void> {
    if (key !== undefined) {
      await this.tails.get(key);
    } else {
      await Promise.all(this.tails.values());
    }
  }
}
