export type Criterion = { id: string; pass: boolean; detail: string };
export type Grade = { pass: boolean; criteria: Criterion[] };
export type WorkItem = { kind: "issue" | "pr"; number: number } | null;
export type TitleCase = {
  id: string;
  suite: "titles";
  message: string;
  subject: string[];
  workItem: WorkItem;
  forbidden?: string[];
};
export type DecisionCase = {
  id: string;
  suite: "tool-routing" | "permission" | "recovery";
  message: string;
  expected: Record<string, unknown>;
};
export type EvalCase = TitleCase | DecisionCase;
