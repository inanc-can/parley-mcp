import { z } from "zod";

export const threadStatusSchema = z.enum(["open", "paused", "closed"]);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const messageStatusSchema = z.enum([
  "sent",
  "delivered",
  "read",
  "replied",
  "failed",
]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const messageKindSchema = z.enum([
  "text",
  "question",
  "proposal",
  "file_ref",
  "handoff",
  "request",
]);
export type MessageKind = z.infer<typeof messageKindSchema>;

export const agreementStatusSchema = z.enum([
  "offered",
  "accepted",
  "countered",
  "rejected",
  "vetoed",
]);
export type AgreementStatus = z.infer<typeof agreementStatusSchema>;

const nullableText = z.string().nullable();
const ms = z.number().int().nonnegative();

export const agentRowSchema = z.object({
  id: z.string().min(1),
  harness: z.string().min(1),
  folder: z.string().min(1),
  repo_root: z.string().min(1),
  native_session: nullableText,
  last_heartbeat: ms.nullable(),
  created_at: ms,
});
export type AgentRow = z.infer<typeof agentRowSchema>;

export const threadRowSchema = z.object({
  id: z.string().min(1),
  repo_root: z.string().min(1),
  title: nullableText,
  status: threadStatusSchema,
  message_cap: z.number().int().positive(),
  created_at: ms,
});
export type ThreadRow = z.infer<typeof threadRowSchema>;

export const messageRowSchema = z.object({
  id: z.string().min(1),
  thread_id: z.string().min(1),
  from_agent: z.string().min(1),
  to_agent: z.string().min(1),
  kind: messageKindSchema,
  body: z.string(),
  payload_json: nullableText,
  reply_to: nullableText,
  status: messageStatusSchema,
  error_code: nullableText,
  sent_at: ms,
  delivered_at: ms.nullable(),
  read_at: ms.nullable(),
  replied_at: ms.nullable(),
  failed_at: ms.nullable(),
  expires_at: ms,
  delivered_session: nullableText,
  idempotency_key: z.string().min(1),
  est_tokens: z.number().int().nonnegative(),
});
export type MessageRow = z.infer<typeof messageRowSchema>;

export const messageEventRowSchema = z.object({
  id: z.string().min(1),
  message_id: z.string().min(1),
  event: z.string().min(1),
  at: ms,
  detail_json: nullableText,
});
export type MessageEventRow = z.infer<typeof messageEventRowSchema>;

export const agreementRowSchema = z.object({
  id: z.string().min(1),
  thread_id: z.string().min(1),
  repo_root: z.string().min(1),
  text: z.string(),
  status: agreementStatusSchema,
  offered_by: z.string().min(1),
  answered_by: nullableText,
  parent_id: nullableText,
  created_at: ms,
  answered_at: ms.nullable(),
});
export type AgreementRow = z.infer<typeof agreementRowSchema>;

export const claimRowSchema = z.object({
  id: z.string().min(1),
  repo_root: z.string().min(1),
  agent_id: z.string().min(1),
  path_glob: z.string().min(1),
  expires_at: ms,
  released_at: ms.nullable(),
});
export type ClaimRow = z.infer<typeof claimRowSchema>;

export const editRowSchema = z.object({
  id: z.string().min(1),
  repo_root: z.string().min(1),
  agent_id: z.string().min(1),
  path: z.string().min(1),
  at: ms,
});
export type EditRow = z.infer<typeof editRowSchema>;

export const settingRowSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});
export type SettingRow = z.infer<typeof settingRowSchema>;
