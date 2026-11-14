import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { HostTask } from "../model/hostTasks";
import { taskStatusLine } from "../model/taskStatusLine";
import { TaskStatusReason } from "./TaskStatusReason";

it("keeps repeated raw failure facts behind an initially closed disclosure", () => {
  const task = {
    status: "blocked",
    error: "Packaging failed",
    prompt: "Repair packaging",
  } as HostTask;
  const html = renderToStaticMarkup(
    createElement(TaskStatusReason, { task, status: taskStatusLine(task) }),
  );
  expect(html).toContain("Error details");
  expect(html).toContain("<details");
  expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
  expect(html).toContain("Packaging failed");
});
