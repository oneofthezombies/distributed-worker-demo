import { z } from "zod";

export const ResultTaskStatus = ["succeeded", "failed"] as const;
export type ResultTaskStatus = (typeof ResultTaskStatus)[number];

export const TaskStatus = [
  "pending",
  "in_progress",
  "succeeded",
  "failed",
] as const;
export type TaskStatus = (typeof TaskStatus)[number];

export const TaskLogKind = ["stdout", "stderr"] as const;
export type TaskLogKind = (typeof TaskLogKind)[number];

export const TaskLog = z.object({
  kind: z.enum(TaskLogKind),
  index: z.number(),
  content: z.string(),
});
export type TaskLog = z.infer<typeof TaskLog>;
