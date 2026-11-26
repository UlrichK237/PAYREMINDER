import crypto from 'node:crypto';
import type { FieldValueLike, FirestoreLike, TransactionLike } from '../types';

export type AuditAction =
  | 'plan_change'
  | 'subscription_payment'
  | 'manual_reminder'
  | 'debtor_erase'
  | 'phone_verified';

export interface AuditLogInput {
  tenantId: string;
  action: AuditAction;
  actorUid: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

function makeAuditId(): string {
  return `aud_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export function buildAuditPayload(
  input: AuditLogInput,
  fieldValue: FieldValueLike,
  nowMs = Date.now()
): Record<string, unknown> {
  return {
    tenantId: input.tenantId,
    action: input.action,
    actorUid: input.actorUid,
    ...(input.targetId ? { targetId: input.targetId } : {}),
    summary: input.summary.slice(0, 300),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    occurredAt: new Date(nowMs).toISOString(),
    createdAt: fieldValue.serverTimestamp(),
  };
}

export async function writeAuditLog(
  db: FirestoreLike,
  fieldValue: FieldValueLike,
  input: AuditLogInput,
  nowMs = Date.now()
): Promise<string> {
  const id = makeAuditId();
  await db
    .doc(`tenants/${input.tenantId}/auditLogs/${id}`)
    .set(buildAuditPayload(input, fieldValue, nowMs));
  return id;
}

export function writeAuditLogInTx(
  tx: TransactionLike,
  db: FirestoreLike,
  fieldValue: FieldValueLike,
  input: AuditLogInput,
  nowMs = Date.now()
): string {
  const id = makeAuditId();
  tx.set(
    db.doc(`tenants/${input.tenantId}/auditLogs/${id}`),
    buildAuditPayload(input, fieldValue, nowMs)
  );
  return id;
}
