export type PlanId = 'free' | 'starter' | 'pro' | 'business';
export type UserRole = 'owner' | 'staff';
export type Channel = 'whatsapp' | 'sms';
export type Tone = 'amical' | 'ferme' | 'dernier_avis';
export type DebtStatus = 'en_cours' | 'partiellement_payee' | 'payee' | 'en_retard' | 'annulee';
export type PaymentMethod = 'especes' | 'mtn_momo' | 'orange_money' | 'autre';
export type ReminderStatus = 'planifiee' | 'envoyee' | 'delivree' | 'lue' | 'echouee' | 'annulee';
export type MessageLogStatus = 'simule' | 'envoyee' | 'delivree' | 'lue' | 'echouee' | 'recue';
export type DetectedIntent = 'opt_out' | 'promise' | 'none';

export type PlanStatus = 'active' | 'grace' | 'expired';

export interface Tenant {
  id: string;
  name: string;
  sector: string;
  phone: string;
  email: string;
  plan: PlanId;
  maxDebtors: number;
  maxRemindersPerMonth: number;
  maxRemindersPerDay?: number;
  remindersUsedThisMonth: number;
  quotaResetMonth: string; // YYYY-MM
  subscriptionDate: string;
  planExpiresAt?: string;
  planStatus?: PlanStatus;
  lastPaymentAt?: string;
  quietHoursStart: number; // ex: 20 (20h00)
  quietHoursEnd: number;   // ex: 7  (07h00)
  timezone: string;        // 'Africa/Douala'
  autoEscalate: boolean;
  fallbackToSms: boolean;
  activeDebtsCount?: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillingRecord {
  id: string;
  tenantId: string;
  planId: PlanId;
  amountFcfa: number;
  status: 'pending' | 'paid' | 'failed';
  paymentRef: string;
  paymentUrl?: string;
  receiptNumber?: string;
  transactionRef?: string;
  method?: string;
  paidAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  tenantId: string;
  role: UserRole;
  name: string;
  email: string;
  updatedAt: string;
}

export interface TenantUser {
  id: string;
  tenantId: string;
  uid: string;
  role: UserRole;
  name: string;
  email: string;
  status: 'active' | 'suspended';
  inviteId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantInvite {
  id: string;
  tenantId: string;
  tenantName: string;
  email: string;
  name: string;
  role: 'staff';
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  createdAt: string;
}

export interface Debtor {
  id: string;
  tenantId: string;
  name: string;
  phone: string; // Format +237...
  preferredChannel: Channel;
  note: string;
  optOut: boolean;
  reliabilityScore: number; // 0-100
  promiseDate?: string;
  consentConfirmedAt?: string;
  consentConfirmedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type AuditLogAction =
  | 'plan_change'
  | 'subscription_payment'
  | 'manual_reminder'
  | 'debtor_erase'
  | 'phone_verified';

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  action: AuditLogAction;
  actorUid: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Debt {
  id: string;
  tenantId: string;
  debtorId: string;
  debtorName: string;
  debtorPhone: string;
  initialAmount: number;
  remainingAmount: number;
  issuedAt: string; // YYYY-MM-DD
  dueDate: string;  // YYYY-MM-DD
  status: DebtStatus;
  description: string;
  reminderCount: number;
  lastReminderAt?: string;
  paymentLink?: string;
  appliedRuleOffsets?: number[];
  ruleReminderCounts?: Record<string, number>;
  ruleLastSentAt?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  tenantId: string;
  debtId: string;
  debtorId: string;
  debtorName: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  note: string;
  receiptNumber: string;
  createdBy: string;
  createdAt: string;
}

export interface ReminderRule {
  id: string;
  tenantId: string;
  offsetDays: number; // ex: -3, 0, 3, 7, 15
  label: string;
  channel: Channel;
  tone: Tone;
  allowedStartHour: number;
  allowedEndHour: number;
  maxReminders: number;
  enabled: boolean;
  updatedAt: string;
}

export interface MessageTemplate {
  id: string;
  tenantId: string;
  tone: Tone;
  channel: Channel;
  body: string;
  metaTemplateName?: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  tenantId: string;
  debtId: string;
  debtorId: string;
  scheduledAt: string;
  channel: Channel;
  tone: Tone;
  status: ReminderStatus;
  providerMessageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageLog {
  id: string;
  tenantId: string;
  debtId?: string;
  debtorId: string;
  debtorName: string;
  debtorPhone: string;
  reminderId?: string;
  direction: 'outbound' | 'inbound';
  channel: Channel;
  tone?: Tone | string;
  content: string;
  status: MessageLogStatus;
  providerMessageId: string;
  detectedIntent: DetectedIntent;
  promiseDate?: string;
  createdAt: string;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  audience: string;
  priceFcfa: number;
  maxDebtors: number;
  maxRemindersPerMonth: number;
  maxRemindersPerDay: number;
  whatsappEnabled: boolean;
  reportsEnabled: boolean;
  multiUserEnabled: boolean;
  highlights: string[];
}
