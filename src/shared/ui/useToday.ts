/**
 * The viewer's local date, turning over at midnight. Feature code reads "today" here instead of
 * calling the clock during render, which keeps the component compiled.
 */
export { useToday } from "./arc/lib/use-today";
