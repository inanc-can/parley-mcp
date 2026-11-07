import { randomUUID } from "node:crypto";
import { z } from "zod";
import { claimsOverlap } from "../../core/overlap.js";
import { activeClaims, claimExpiresAt } from "../../core/claims.js";
import { nextAgreementStatus } from "../../core/agreements.js";
import type { ToolContext } from "../context.js";
import { heartbeatCaller } from "../identity.js";
import { refused, success, type ToolOutcome } from "../response.js";
import {
  agreementsRepo,
  claimsRepo,
  messagesRepo,
  threadsRepo,
  type AgreementRow,
  type ClaimRow,
  type Db,
  type MessageRow,
} from "../../store/index.js";

export const agreeArgsShape = {
  action: z.enum(["offer", "accept", "counter", "reject", "claim", "renew", "release"]),
  thread_id: z.string().min(1).optional(),
  agreement_id: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  path_glob: z.string().min(1).optional(),
} as const;

export type AgreeArgs = z.output<z.ZodObject<typeof agreeArgsShape>>;

export function handleAgree(
  ctx: ToolContext,
  args: AgreeArgs,
  now: number = Date.now(),
): ToolOutcome {
  const { db, agentId } = ctx;
  heartbeatCaller(db, agentId, ctx.nativeSession, now);
  switch (args.action) {
    case "offer":
      return offerAgreement(ctx, args, now);
    case "accept":
      return answer(ctx, args, now, "accept");
    case "reject":
      return answer(ctx, args, now, "reject");
    case "counter":
      return answer(ctx, args, now, "counter");
    case "claim":
    case "renew":
    case "release":
      return changeClaim(ctx, args, now);
  }
}

function offerAgreement(
  ctx: ToolContext,
  args: AgreeArgs,
  now: number,
): ToolOutcome {
  if (args.thread_id === undefined) {
    return refused(
      "offer_needs_thread",
      "An offer needs thread_id: offer it inside an existing conversation.",
    );
  }
  if (args.text === undefined) {
    return refused(
      "offer_needs_text",
      "An offer needs its written text.",
    );
  }
  const thread = threadsRepo.findThread(ctx.db, args.thread_id);
  if (thread?.repo_root !== ctx.repoRoot) {
    return refused(
      "thread_not_found",
      `No thread ${args.thread_id} in this repo.`,
    );
  }
  const recipient = latestDirectRecipient(ctx, args.thread_id);
  if (recipient === null) {
    return refused(
      "offer_needs_recipient",
      "No recipient yet: send the agent a message in this thread first, then offer.",
    );
  }
  const inserted = agreementsRepo.insertAgreement(ctx.db, {
    id: randomUUID(),
    threadId: args.thread_id,
    repoRoot: ctx.repoRoot,
    text: args.text,
    status: "offered",
    offeredBy: ctx.agentId,
    offeredTo: recipient,
    answeredBy: null,
    parentId: null,
    createdAt: now,
    answeredAt: null,
  });
  return success(
    { agreement: serializeAgreement(inserted) },
    `Agreement offered to ${recipient}: "${summarizeText(args.text)}". ` +
      `Only they may accept, counter or reject it; the human can veto accepted agreements.`,
  );
}

function latestDirectRecipient(ctx: ToolContext, threadId: string): string | null {
  const mine = messagesRepo.listThreadMessages(ctx.db, threadId).filter(
    (message: MessageRow) =>
      message.from_agent === ctx.agentId && message.to_agent !== "everyone",
  );
  const last = mine[mine.length - 1];
  return last?.to_agent ?? null;
}

function answer(
  ctx: ToolContext,
  args: AgreeArgs,
  now: number,
  action: "accept" | "counter" | "reject",
): ToolOutcome {
  if (args.agreement_id === undefined) {
    return refused("no_agreement_id", `${title(action)} needs agreement_id.`);
  }
  const original = agreementsRepo.findAgreement(ctx.db, args.agreement_id);
  if (original === undefined) {
    return refused(
      "agreement_not_found",
      `No agreement ${args.agreement_id} in this hub.`,
    );
  }

  const isCounter = action === "counter";
  // Validate the counter text before touching the store: a textless counter
  // must not mark the original `countered` and leave it orphaned.
  if (isCounter && args.text === undefined) {
    return refused("counter_needs_text", "A counter-proposal needs its written text.");
  }

  // Both the status change and the counter insert happen in one transaction.
  const database: Db = ctx.db;
  const run = database.transaction(() => {
    const updated = agreementsRepo.updateAgreementStatus(
      ctx.db,
      original.id,
      nextAgreementStatus(action),
      ctx.agentId,
      now,
    );
    if (!updated) {
      return { settled: false };
    }
    if (isCounter) {
      const text = args.text;
      if (text === undefined) {
        // Unreachable: textless counters are refused above before any write.
        return { settled: false };
      }
      agreementsRepo.insertAgreement(ctx.db, {
        id: randomUUID(),
        threadId: original.thread_id,
        repoRoot: ctx.repoRoot,
        text,
        status: "offered",
        offeredBy: ctx.agentId,
        offeredTo: original.offered_by,
        answeredBy: null,
        parentId: original.id,
        createdAt: now,
        answeredAt: null,
      });
    }
    return { settled: true };
  });
  const { settled } = run();
  if (!settled) {
    return refused(
      "not_answerable",
      "Only the agreement's recipient may answer, only while it is still offered. Offering it again would be a new offer.",
    );
  }

  const answered = agreementsRepo.getAgreement(ctx.db, original.id);
  if (isCounter) {
    return success(
      { agreement: serializeAgreement(answered) },
      `Countered: the offer is marked countered and a new offer is on the table for ${original.offered_by}.`,
    );
  }
  return success(
    { agreement: serializeAgreement(answered) },
    `${title(action)} recorded. The human can veto accepted agreements in the viewer.`,
  );
}

function changeClaim(
  ctx: ToolContext,
  args: AgreeArgs,
  now: number,
): ToolOutcome {
  if (args.path_glob === undefined) {
    return refused("claim_needs_glob", `${title(args.action)} needs path_glob.`);
  }
  if (args.action === "claim") {
    return makeClaim(ctx, args, now);
  }
  const mine = activeClaims(claimsRepo.listActiveClaims(ctx.db, ctx.repoRoot, now), now).find(
    (claim: ClaimRow) => claim.agent_id === ctx.agentId && claim.path_glob === args.path_glob,
  );
  if (mine === undefined) {
    return refused(
      "no_active_claim",
      `You have no active claim matching ${args.path_glob}.`,
    );
  }
  if (args.action === "renew") {
    claimsRepo.renewClaim(ctx.db, mine.id, claimExpiresAt(now));
    return success(
      { claim: serializeClaim(claimsRepo.getClaim(ctx.db, mine.id)) },
      `Claim on ${mine.path_glob} renewed for another 2 hours.`,
    );
  }
  claimsRepo.releaseClaim(ctx.db, mine.id, now);
  return success(
    { claim: serializeClaim(claimsRepo.getClaim(ctx.db, mine.id)) },
    `Claim on ${mine.path_glob} released.`,
  );
}

function makeClaim(ctx: ToolContext, args: AgreeArgs, now: number): ToolOutcome {
  const requested = args.path_glob ?? "";
  const conflicts = activeClaims(
    claimsRepo.listActiveClaims(ctx.db, ctx.repoRoot, now),
    now,
  )
    .map((claim) => ({ claim, overlap: claimsOverlap(claim.path_glob, requested) }))
    .filter((entry) => entry.overlap)
    .map((entry) => ({
      kind: "claim" as const,
      agentId: entry.claim.agent_id,
      detail: `overlapping active claim ${entry.claim.path_glob}`,
    }));
  const created = claimsRepo.insertClaim(ctx.db, {
    id: randomUUID(),
    repoRoot: ctx.repoRoot,
    agentId: ctx.agentId,
    pathGlob: requested,
    expiresAt: claimExpiresAt(now),
  });
  const conflictText =
    conflicts.length === 0
      ? "No active claims of other agents overlap."
      : `Conflicts (warning, never blocked): ${conflicts
          .map((conflict) => `${conflict.agentId} (${conflict.detail})`)
          .join("; ")}.`;
  return success(
    { claim: serializeClaim(created), conflicts },
    `Claimed ${requested} for 2 hours. ${conflictText}`,
  );
}

function serializeAgreement(agreement: AgreementRow): Record<string, unknown> {
  return {
    agreement_id: agreement.id,
    thread_id: agreement.thread_id,
    status: agreement.status,
    text: agreement.text,
    offered_by: agreement.offered_by,
    offered_to: agreement.offered_to,
    answered_by: agreement.answered_by,
    parent_id: agreement.parent_id,
    created_at: agreement.created_at,
    answered_at: agreement.answered_at,
  };
}

function serializeClaim(claim: ClaimRow): Record<string, unknown> {
  return {
    claim_id: claim.id,
    path_glob: claim.path_glob,
    agent_id: claim.agent_id,
    expires_at: claim.expires_at,
    released_at: claim.released_at,
  };
}

function title(action: string): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function summarizeText(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}
