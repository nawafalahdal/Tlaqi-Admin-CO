import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MkActor } from "./access";

type Db = Prisma.TransactionClient | typeof prisma;

/** ما يُسجَّل — اسمٌ ثابتٌ للحدث، والواجهةُ تترجمه (`mk.events`) */
export type MkEventAction =
  | "team.member_added"
  | "team.capabilities_changed"
  | "team.member_deactivated"
  | "team.member_reactivated"
  | "settings.changed"
  | "format.created"
  | "format.updated"
  | "campaign.created"
  | "campaign.brief_updated"
  | "campaign.status_changed"
  | "campaign.member_added"
  | "campaign.member_removed"
  | "plan.submitted"
  | "plan.approved"
  | "plan.changes_requested"
  | "plan.invalidated"
  | "deliverable.created"
  | "deliverable.format_changed"
  | "deliverable.blocked"
  | "deliverable.unblocked"
  | "content.draft_saved"
  | "content.submitted"
  | "content.approved"
  | "content.changes_requested"
  | "design.uploaded"
  | "design.submitted"
  | "design.approved"
  | "design.changes_requested"
  | "design.returned_to_writer"
  | "approvals.invalidated"
  | "quality.started"
  | "quality.passed"
  | "quality.failed"
  | "publication.recorded"
  | "publication.results_recorded"
  | "task.created"
  | "task.updated"
  | "task.assigned"
  | "task.status_changed"
  | "task.reopened"
  | "task.deleted"
  | "comment.added"
  | "file.attached"
  | "job.queued"
  | "job.succeeded"
  | "job.failed"
  | "job.cancelled"
  | "job.retried"
  | "job.adopted";

/** يُكتب في المعاملة نفسها التي تُغيّر الحالة — فلا تقع عمليةٌ بلا سجلّ ولا سجلٌّ بلا عملية */
export async function logEvent(
  db: Db,
  actor: MkActor,
  e: { action: MkEventAction; campaignId?: string | null; deliverableId?: string | null; details?: Prisma.InputJsonValue }
) {
  await db.marketingEvent.create({
    data: {
      action: e.action,
      campaignId: e.campaignId ?? null,
      deliverableId: e.deliverableId ?? null,
      actorKind: actor.kind,
      actorId: actor.principalId,
      actorName: actor.name,
      details: e.details ?? undefined,
    },
  });
}

/** حدثٌ بلا فاعلٍ بشري — نتيجةُ مهمّةٍ في الخلفية (نجاحُ توليدٍ أو فشلُه).
 *  `actorKind = "system"` والواجهةُ تسمّيه بلغتها؛ والاسمُ المخزَّن عربيٌّ كسائر السجلّ. */
export async function logSystemEvent(
  db: Db,
  e: { action: MkEventAction; campaignId?: string | null; deliverableId?: string | null; details?: Prisma.InputJsonValue }
) {
  await db.marketingEvent.create({
    data: {
      action: e.action,
      campaignId: e.campaignId ?? null,
      deliverableId: e.deliverableId ?? null,
      actorKind: "system",
      actorId: "marketing-jobs",
      actorName: "النظام",
      details: e.details ?? undefined,
    },
  });
}
