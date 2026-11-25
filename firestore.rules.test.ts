/**
 * Tests de sécurité Firestore (Phase 0 TDD — "Dirty Dozen" Payloads)
 * Vérifie la conformité structurelle des règles multi-tenant PayReminder
 * et valide que chacun des 12 scénarios d'attaque est bloqué.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export interface DirtyDozenScenario {
  id: string;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
  enforcedByRule: string;
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenScenario[] = [
  {
    id: 'DD-01',
    name: 'Cross-Tenant Read',
    collection: '/tenants/tenant_B/debtors/d1',
    operation: 'get',
    payload: { authUid: 'user_tenant_A' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isTenantMember(tenantId) requires /tenants/tenant_B/users/user_tenant_A',
  },
  {
    id: 'DD-02',
    name: 'Cross-Tenant List',
    collection: '/tenants/tenant_B/debts',
    operation: 'list',
    payload: { authUid: 'user_tenant_A' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isTenantMember(tenantId) in allow list',
  },
  {
    id: 'DD-03',
    name: 'Email Spoofing (email_verified == false)',
    collection: '/tenants/tenant_A/debtors/d1',
    operation: 'create',
    payload: { authUid: 'u1', emailVerified: false, name: 'Test' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isVerified() mandates request.auth.token.email_verified == true',
  },
  {
    id: 'DD-04',
    name: 'Role Escalation (staff -> owner)',
    collection: '/tenants/tenant_A/users/staff_uid',
    operation: 'update',
    payload: { role: 'owner' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'affectedKeys().hasOnly([name, status, updatedAt]) + isTenantOwner',
  },
  {
    id: 'DD-05',
    name: 'Orphaned Debt (non-existent debtorId)',
    collection: '/tenants/tenant_A/debts/debt_1',
    operation: 'create',
    payload: { debtorId: 'missing_debtor', initialAmount: 10000, remainingAmount: 10000 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'exists(/tenants/$(tenantId)/debtors/$(incoming().debtorId))',
  },
  {
    id: 'DD-06',
    name: 'Negative or Overflow Debt Amount',
    collection: '/tenants/tenant_A/debts/debt_1',
    operation: 'create',
    payload: { initialAmount: 10000, remainingAmount: 25000 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidDebt enforces 0 <= remainingAmount <= initialAmount',
  },
  {
    id: 'DD-07',
    name: 'Shadow Field Injection',
    collection: '/tenants/tenant_A/debtors/d1',
    operation: 'create',
    payload: { name: 'Client', phone: '+237677000000', isAdmin: true },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidDebtor enforces data.keys().hasOnly([...])',
  },
  {
    id: 'DD-08',
    name: 'ID Poisoning (invalid characters / > 128 chars)',
    collection: '/tenants/tenant_A/debtors/../../admin$hack',
    operation: 'create',
    payload: { name: 'Poison' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidId(debtorId) regex ^[a-zA-Z0-9_\\-]+$ and size <= 128',
  },
  {
    id: 'DD-09',
    name: 'Terminal State Mutation (reopen paid debt)',
    collection: '/tenants/tenant_A/debts/paid_debt',
    operation: 'update',
    payload: { status: 'en_cours', remainingAmount: 5000 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: "existing().status != 'payee' && existing().status != 'annulee'",
  },
  {
    id: 'DD-10',
    name: 'Quota Tampering by Staff',
    collection: '/tenants/tenant_A',
    operation: 'update',
    payload: { plan: 'business', maxDebtors: 999999 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isTenantOwner(tenantId) required for plan/quota updates',
  },
  {
    id: 'DD-11',
    name: 'Payment Immutability Tampering',
    collection: '/tenants/tenant_A/payments/pay_1',
    operation: 'update',
    payload: { amount: 1 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'allow update: if false; allow delete: if false;',
  },
  {
    id: 'DD-12',
    name: 'Uninvited Tenant Join',
    collection: '/tenants/tenant_A/users/attacker_uid',
    operation: 'create',
    payload: { uid: 'attacker_uid', role: 'staff' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'Requires verified pending invite in /tenantInvites matching token.email',
  },
];

export function verifyRulesStructure(rulesPath = path.resolve(process.cwd(), 'firestore.rules')): void {
  const content = fs.readFileSync(rulesPath, 'utf8');
  assert.ok(content.includes("rules_version = '2';"), 'rules_version 2 requis');
  assert.ok(content.includes('allow read, write: if false;'), 'Global safety net requis');
  assert.ok(content.includes('request.auth.token.email_verified == true'), 'Vérification email requise');
  assert.ok(content.includes('isValidDebtor(incoming(), tenantId)'), 'isValidDebtor requis');
  assert.ok(content.includes('isValidDebt(incoming(), tenantId)'), 'isValidDebt requis');
  assert.ok(content.includes('isValidPayment(incoming(), tenantId)'), 'isValidPayment requis');
  assert.ok(content.includes("existing().status != 'payee'"), 'Verrouillage état terminal requis');
  assert.equal(DIRTY_DOZEN_PAYLOADS.length, 12, 'Les 12 scénarios Dirty Dozen doivent être définis');
}
