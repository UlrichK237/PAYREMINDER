import type {
  AuditLogEntry,
  BillingRecord,
  Channel,
  Debt,
  Debtor,
  MessageLog,
  MessageTemplate,
  Payment,
  PaymentMethod,
  PlanId,
  Reminder,
  ReminderRule,
  Tenant,
  TenantInvite,
  TenantUser,
  Tone,
} from '../types/payreminder';

export interface ServerCapabilities {
  whatsappConfigured: boolean;
  smsConfigured: boolean;
  paymentConfigured: boolean;
  emailConfigured: boolean;
  simulationMode: boolean;
  simulationRoutes: boolean;
}

export interface CreateDebtorInput {
  name: string;
  phone: string;
  preferredChannel: Channel;
  note: string;
  consentConfirmed: boolean;
}

export interface BulkImportDebtorRow {
  name: string;
  phone: string;
  preferredChannel: Channel;
  note: string;
}

export interface DataContextValue {
  tenant: Tenant | null;
  teamUsers: TenantUser[];
  teamInvites: TenantInvite[];
  debtors: Debtor[];
  debts: Debt[];
  payments: Payment[];
  reminderRules: ReminderRule[];
  messageTemplates: MessageTemplate[];
  reminders: Reminder[];
  messageLogs: MessageLog[];
  billingHistory: BillingRecord[];
  auditLogs: AuditLogEntry[];
  capabilities: ServerCapabilities;
  phoneVerified: boolean;
  dailyUsage: { date: string; count: number };
  loadingData: boolean;

  // Débiteurs
  createDebtor: (input: CreateDebtorInput) => Promise<string>;
  updateDebtor: (
    id: string,
    patch: Partial<
      Pick<Debtor, 'name' | 'phone' | 'preferredChannel' | 'note' | 'optOut' | 'promiseDate' | 'reliabilityScore'>
    >
  ) => Promise<void>;
  deleteDebtor: (id: string) => Promise<void>;
  eraseDebtorData: (debtorId: string) => Promise<void>;
  bulkImportDebtors: (rows: BulkImportDebtorRow[], consentConfirmed: boolean) => Promise<number>;

  // Dettes
  createDebt: (input: {
    debtorId: string;
    initialAmount: number;
    dueDate: string;
    description: string;
  }) => Promise<string>;
  cancelDebt: (debtId: string) => Promise<void>;

  // Paiements
  recordPayment: (input: {
    debtId: string;
    amount: number;
    method: PaymentMethod;
    note: string;
  }) => Promise<Payment>;
  generatePaymentLink: (debt: Debt) => Promise<string>;

  // Relances & Webhooks
  sendReminderNow: (
    debtId: string,
    overrideChannel?: Channel,
    overrideTone?: Tone
  ) => Promise<{ status: string; channel: Channel; usedFallback: boolean }>;
  sendBulkOverdueReminders: (debtIds: string[]) => Promise<{ sent: number; skipped: number }>;
  simulateInboundWhatsapp: (params: {
    fromPhone: string;
    messageText: string;
  }) => Promise<{ intent: string; promiseDate: string | null }>;
  simulatePaymentWebhook: (params: {
    debtId: string;
    amount: number;
    method: 'mtn_momo' | 'orange_money';
  }) => Promise<void>;

  // Paramètres, Sécurité, Équipe & Abonnements
  updateTenantSettings: (
    patch: Partial<
      Pick<
        Tenant,
        'name' | 'sector' | 'phone' | 'email' | 'quietHoursStart' | 'quietHoursEnd' | 'autoEscalate' | 'fallbackToSms'
      >
    >
  ) => Promise<void>;
  updateMessageTemplate: (templateId: string, body: string) => Promise<void>;
  updateReminderRule: (
    ruleId: string,
    patch: Partial<
      Pick<
        ReminderRule,
        'offsetDays' | 'channel' | 'tone' | 'allowedStartHour' | 'allowedEndHour' | 'maxReminders' | 'enabled'
      >
    >
  ) => Promise<void>;
  inviteStaffMember: (params: { name: string; email: string }) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  upgradePlan: (planId: PlanId) => Promise<void>;
  startPlanCheckout: (planId: PlanId) => Promise<{
    paymentUrl?: string;
    paymentRef?: string;
    amountFcfa?: number;
    demoUpgraded?: boolean;
  }>;
  simulateSubscriptionPayment: (paymentRef: string) => Promise<void>;
  loadDemoDataset: (key: 'pagnes' | 'ecole') => Promise<void>;
  sendPhoneVerificationCode: () => Promise<{ phone: string; devCode?: string }>;
  verifyPhoneVerificationCode: (code: string) => Promise<void>;
}
