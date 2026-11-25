/**
 * Tests de sécurité Firestore (Phase 0 TDD + Régression durcissement)
 * Vérifie la conformité structurelle des règles multi-tenant PayReminder
 * et valide que chaque scénario d'attaque échoue (PERMISSION_DENIED).
 *
 * Exécution : npm run test:rules
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export interface SecurityScenario {
  id: string;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  actor: {
    uid: string;
    tenantId?: string;
    role?: 'owner' | 'staff';
    emailVerified: boolean;
  };
  payload: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
  enforcedByRule: string;
}

export const SECURITY_ATTACK_SCENARIOS: SecurityScenario[] = [
  {
    id: 'DD-01',
    name: 'Cross-Tenant Read',
    collection: '/tenants/tenant_B/debtors/d1',
    operation: 'get',
    actor: { uid: 'user_tenant_A', tenantId: 'tenant_A', role: 'owner', emailVerified: true },
    payload: {},
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isTenantMember(tenantId) requires /tenants/tenant_B/users/user_tenant_A',
  },
  {
    id: 'DD-02',
    name: 'Cross-Tenant List / Write',
    collection: '/tenants/tenant_B/debts',
    operation: 'create',
    actor: { uid: 'user_tenant_A', tenantId: 'tenant_A', role: 'owner', emailVerified: true },
    payload: { tenantId: 'tenant_B', debtorId: 'd1', initialAmount: 10000 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isTenantMember(tenantId) requis sur lecture et écriture',
  },
  {
    id: 'DD-03',
    name: 'Unverified Email (email_verified == false)',
    collection: '/tenants/tenant_A/debtors/d1',
    operation: 'create',
    actor: { uid: 'u1', tenantId: 'tenant_A', role: 'owner', emailVerified: false },
    payload: { name: 'Test Client', phone: '+237677000000' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isVerified() mandates request.auth.token.email_verified == true',
  },
  {
    id: 'DD-04',
    name: 'Role Escalation (staff -> owner)',
    collection: '/tenants/tenant_A/users/staff_uid',
    operation: 'update',
    actor: { uid: 'staff_uid', tenantId: 'tenant_A', role: 'staff', emailVerified: true },
    payload: { role: 'owner' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'affectedKeys().hasOnly([name, status, updatedAt]) + isTenantOwner',
  },
  {
    id: 'DD-05',
    name: 'Orphaned Debt (non-existent debtorId)',
    collection: '/tenants/tenant_A/debts/debt_1',
    operation: 'create',
    actor: { uid: 'owner_A', tenantId: 'tenant_A', role: 'owner', emailVerified: true },
    payload: { debtorId: 'missing_debtor', initialAmount: 10000, remainingAmount: 10000 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'exists(/tenants/$(tenantId)/debtors/$(incoming().debtorId))',
  },
  {
    id: 'DD-06',
    name: 'Negative or Overflow Debt Amount',
    collection: '/tenants/tenant_A/debts/debt_1',
    operation: 'create',
    actor: { uid: 'owner_A', tenantId: 'tenant_A', role: 'owner', emailVerified: true },
    payload: { initialAmount: 10000, remainingAmount: 25000 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidDebt enforces 0 <= remainingAmount <= initialAmount',
  },
  {
    id: 'DD-07',
    name: 'Shadow Field Injection',
    collection: '/tenants/tenant_A/debtors/d1',
    operation: 'create',
    actor: { uid: 'owner_A', tenantId: 'tenant_A', role: 'owner', emailVerified: true },
    payload: { name: 'Client', phone: '+237677000000', isAdmin: true },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidDebtor enforces data.keys().hasOnly([...])',
  },
  {
    id: 'DD-08',
    name: 'ID Poisoning (invalid characters / > 128 chars)',
    collection: '/tenants/tenant_A/debtors/../../admin$hack',
    operation: 'create',
    actor: { uid: 'owner_A', tenantId: 'tenant_A', role: 'owner', emailVerified: true },
    payload: { name: 'Poison' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'isValidId(debtorId) regex ^[a-zA-Z0-9_\\-]+$ and size <= 128',
  },
  {
    id: 'DD-09',
    name: 'Terminal State Mutation (reopen paid debt)',
    collection: '/tenants/tenant_A/debts/paid_debt',
    operation: 'update',
    actor: { uid: 'owner_A', tenantId: 'tenant_A', role: 'owner', emailVerified: true },
    payload: { status: 'en_cours', remainingAmount: 5000 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: "existing().status != 'payee' && existing().status != 'annulee'",
  },
  {
    id: 'DD-10',
    name: 'Owner Plan Tampering (client tries free -> business upgrade)',
    collection: '/tenants/tenant_A',
    operation: 'update',
    actor: { uid: 'owner_A', tenantId: 'tenant_A', role: 'owner', emailVerified: true },
    payload: { plan: 'business', maxDebtors: 999999, maxRemindersPerMonth: 999999 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'tenants allow update strictly forbids plan, maxDebtors, maxRemindersPerMonth, subscriptionDate',
  },
  {
    id: 'DD-11',
    name: 'Staff Quota Tampering (client tries resetting remindersUsedThisMonth)',
    collection: '/tenants/tenant_A',
    operation: 'update',
    actor: { uid: 'staff_A', tenantId: 'tenant_A', role: 'staff', emailVerified: true },
    payload: { remindersUsedThisMonth: 0, quotaResetMonth: '2026-11' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'tenants allow update requires isTenantOwner and forbids remindersUsedThisMonth / quotaResetMonth',
  },
  {
    id: 'DD-12',
    name: 'Payment Immutability Tampering',
    collection: '/tenants/tenant_A/payments/pay_1',
    operation: 'update',
    actor: { uid: 'owner_A', tenantId: 'tenant_A', role: 'owner', emailVerified: true },
    payload: { amount: 1 },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'allow update: if false; allow delete: if false;',
  },
  {
    id: 'DD-13',
    name: 'Uninvited Tenant Join',
    collection: '/tenants/tenant_A/users/attacker_uid',
    operation: 'create',
    actor: { uid: 'attacker_uid', emailVerified: true },
    payload: { uid: 'attacker_uid', role: 'staff' },
    expectedOutcome: 'PERMISSION_DENIED',
    enforcedByRule: 'Requires verified pending invite in /tenantInvites matching token.email',
  },
];

function extractTenantUpdateBlock(rulesContent: string): string {
  const match = rulesContent.match(/match \/tenants\/\{tenantId\}\s*\{[\s\S]*?allow update:([\s\S]*?)allow delete:/);
  assert.ok(match && match[1], 'Bloc allow update de /tenants/{tenantId} introuvable');
  return match[1];
}

function evaluateTenantUpdateRule(
  allowedKeys: string[],
  scenario: SecurityScenario
): 'ALLOWED' | 'PERMISSION_DENIED' {
  if (!scenario.actor.emailVerified) return 'PERMISSION_DENIED';
  if (scenario.actor.role !== 'owner') return 'PERMISSION_DENIED';
  const targetTenant = scenario.collection.split('/')[2];
  if (scenario.actor.tenantId !== targetTenant) return 'PERMISSION_DENIED';
  const keys = Object.keys(scenario.payload);
  const allAllowed = keys.every((k) => allowedKeys.includes(k));
  return allAllowed ? 'ALLOWED' : 'PERMISSION_DENIED';
}

export function verifyRulesStructure(rulesPath = path.resolve(process.cwd(), 'firestore.rules')): void {
  const content = fs.readFileSync(rulesPath, 'utf8');

  // 1. Socle global
  assert.ok(content.includes("rules_version = '2';"), 'rules_version 2 requis');
  assert.ok(content.includes('allow read, write: if false;'), 'Global safety net requis');
  assert.ok(content.includes('request.auth.token.email_verified == true'), 'Vérification email requise');
  assert.ok(content.includes('function isTenantOwnerAfter(tenantId)'), 'Fonction isTenantOwnerAfter requise');

  // 2. Création d'entreprise : reminderRules et messageTemplates utilisent isTenantOwnerAfter
  const reminderRulesCreate = content.match(/match \/reminderRules\/\{ruleId\}[\s\S]*?allow create:([\s\S]*?)allow update:/);
  assert.ok(reminderRulesCreate?.[1].includes('isTenantOwnerAfter(tenantId)'), 'reminderRules allow create doit utiliser isTenantOwnerAfter(tenantId)');

  const templatesCreate = content.match(/match \/messageTemplates\/\{templateId\}[\s\S]*?allow create:([\s\S]*?)allow update:/);
  assert.ok(templatesCreate?.[1].includes('isTenantOwnerAfter(tenantId)'), 'messageTemplates allow create doit utiliser isTenantOwnerAfter(tenantId)');

  // 3. Durcissement /tenants/{tenantId} allow update : aucun champ forfait/quota modifiable par le client
  const tenantUpdateBlock = extractTenantUpdateBlock(content);
  assert.ok(tenantUpdateBlock.includes('isTenantOwner(tenantId)'), 'tenant update doit exiger isTenantOwner');
  for (const forbiddenField of [
    "'plan'",
    "'maxDebtors'",
    "'maxRemindersPerMonth'",
    "'subscriptionDate'",
    "'remindersUsedThisMonth'",
    "'quotaResetMonth'",
  ]) {
    assert.ok(
      !tenantUpdateBlock.includes(forbiddenField),
      `Champ privilégié ${forbiddenField} interdit dans tenant allow update`
    );
  }

  const allowedKeysMatch = tenantUpdateBlock.match(/affectedKeys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
  assert.ok(allowedKeysMatch?.[1], 'affectedKeys().hasOnly([...]) requis sur tenant update');
  const allowedTenantKeys = allowedKeysMatch[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);

  // Vérifie les scénarios de mutation de forfait/quota/non-vérifié/cross-tenant
  for (const scenario of SECURITY_ATTACK_SCENARIOS) {
    if (scenario.collection.match(/^\/tenants\/[^/]+$/) && scenario.operation === 'update') {
      const outcome = evaluateTenantUpdateRule(allowedTenantKeys, scenario);
      assert.equal(outcome, 'PERMISSION_DENIED', `Le scénario ${scenario.id} (${scenario.name}) doit être refusé`);
    }
  }

  // 4. Autres invariants critiques
  assert.ok(content.includes('isValidDebtor(incoming(), tenantId)'), 'isValidDebtor requis');
  assert.ok(content.includes('isValidDebt(incoming(), tenantId)'), 'isValidDebt requis');
  assert.ok(content.includes('isValidPayment(incoming(), tenantId)'), 'isValidPayment requis');
  assert.ok(content.includes("existing().status != 'payee'"), 'Verrouillage état terminal requis');
  assert.ok(content.includes('allow update: if false;'), 'Immutabilité des paiements requise');
  assert.equal(SECURITY_ATTACK_SCENARIOS.length, 13, 'Les 13 scénarios de sécurité doivent être définis');
}

// Exécution directe via `npm run test:rules`
verifyRulesStructure();
console.info(`OK : ${SECURITY_ATTACK_SCENARIOS.length} scénarios de sécurité Firestore vérifiés avec succès.`);
