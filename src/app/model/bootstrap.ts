/** Keep failures in both startup loading and mounting on the recovery path. */
export async function bootstrap<T>(
  load: () => Promise<T>,
  mount: (value: T) => void,
  recover: (error: unknown) => void,
): Promise<void> {
  try {
    mount(await load());
  } catch (error) {
    recover(error);
  }
}
