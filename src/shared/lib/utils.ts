/**
 * Joins truthy class names. `components.json` maps the shadcn `utils` alias here so
 * registry components added with `shadcn add` resolve their `cn` import.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
