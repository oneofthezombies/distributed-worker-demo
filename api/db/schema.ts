import { pgTable, pgEnum, integer, timestamp, text } from "drizzle-orm/pg-core";

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "in_progress",
  "succeeded",
  "failed",
]);

export const tasksTable = pgTable("tasks", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /**
   * Shell command to be executed by a worker.
   *
   * ⚠️ For demo use only.
   * In production:
   * - Run commands in a secure, isolated environment (e.g., container)
   * - Validate or whitelist commands to prevent abuse
   */
  command: text().notNull(),
  status: taskStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
