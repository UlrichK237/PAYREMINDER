import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { analyzeInboundMessage } from '../../functions/src/services/whatsapp';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
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
import { DEFAULT_REMINDER_RULES, DEFAULT_TEMPLATES } from '../utils/defaults';
import { buildEcoleDemoDataset, buildPagnesDemoDataset } from '../utils/demoData';
import {
  computeDebtStatus,
  getCurrentDoualaHour,
  getCurrentDoualaMonth,
  getDaysOverdue,
  getTodayDoualaDate,
  pickEscalatedTone,
  renderTemplateMessage,
} from '../utils/formatters';
import { PLANS } from '../utils/plans';
import { validateDebtorInput, validateDebtInput } from '../utils/validation';
import { useAuth } from './AuthContext';

export interface ServerCapabilities {
  whatsappConfigured: boolean;
  smsConfigured: boolean;
  paymentConfigured: boolean;
  emailConfigured: boolean;
  simulationMode: boolean;
}

interface DataContextValue {
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
  capabilities: ServerCapabilities;
  loadingData: boolean;

  // Débiteurs
  createDebtor: (input: { name: string; phone: string; preferredChannel: Channel; note: string }) => Promise<string>;
  updateDebtor: (id: string, patch: Partial<Pick<Debtor, 'name' | 'phone' | 'preferredChannel' | 'note' | 'optOut' | 'promiseDate' | 'reliabilityScore'>>) => Promise<void>;
  deleteDebtor: (id: string) => Promise<void>;
  bulkImportDebtors: (rows: Array<{ name: string; phone: string; preferredChannel: Channel; note: string }>) => Promise<number>;

  // Dettes
  createDebt: (input: { debtorId: string; initialAmount: number; dueDate: string; description: string }) => Promise<string>;
  cancelDebt: (debtId: string) => Promise<void>;

  // Paiements
  recordPayment: (input: { debtId: string; amount: number; method: PaymentMethod; note: string }) => Promise<Payment>;
  generatePaymentLink: (debt: Debt) => Promise<string>;

  // Relances & Webhooks
  sendReminderNow: (debtId: string, overrideChannel?: Channel, overrideTone?: Tone) => Promise<{ status: string; channel: Channel; usedFallback: boolean }>;
  sendBulkOverdueReminders: (debtIds: string[]) => Promise<{ sent: number; skipped: number }>;
  simulateInboundWhatsapp: (params: { fromPhone: string; messageText: string }) => Promise<{ intent: string; promiseDate: string | null }>;
  simulatePaymentWebhook: (params: { debtId: string; amount: number; method: 'mtn_momo' | 'orange_money' }) => Promise<void>;

  // Paramètres, Équipe & Abonnements
  updateTenantSettings: (patch: Partial<Pick<Tenant, 'name' | 'sector' | 'phone' | 'email' | 'quietHoursStart' | 'quietHoursEnd' | 'autoEscalate' | 'fallbackToSms'>>) => Promise<void>;
  updateMessageTemplate: (templateId: string, body: string) => Promise<void>;
  updateReminderRule: (ruleId: string, patch: Partial<Pick<ReminderRule, 'offsetDays' | 'channel' | 'tone' | 'allowedStartHour' | 'allowedEndHour' | 'maxReminders' | 'enabled'>>) => Promise<void>;
  inviteStaffMember: (params: { name: string; email: string }) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  upgradePlan: (planId: PlanId) => Promise<void>;
  loadDemoDataset: (key: 'pagnes' | 'ecole') => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

function tsToIso(val: unknown): string {
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  return typeof val === 'string' ? val : new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Session expirée. Veuillez vous reconnecter.');
  }
  const token = await currentUser.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, demoMode, demoDatasetKey } = useAuth();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [teamUsers, setTeamUsers] = useState<TenantUser[]>([]);
  const [teamInvites, setTeamInvites] = useState<TenantInvite[]>([]);
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [rawDebts, setRawDebts] = useState<Debt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reminderRules, setReminderRules] = useState<ReminderRule[]>([]);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [capabilities, setCapabilities] = useState<ServerCapabilities>({
    whatsappConfigured: false,
    smsConfigured: false,
    paymentConfigured: false,
    emailConfigured: false,
    simulationMode: true,
  });

  // Récupération des capacités serveur (sans clés)
  useEffect(() => {
    fetch('/api/config/capabilities')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setCapabilities(data as ServerCapabilities);
      })
      .catch(() => {
        // Fallback simulation mode silently
      });
  }, []);

  // Chargement du mode Démo local
  const initLocalDemoState = useCallback((datasetKey: 'pagnes' | 'ecole') => {
    const uid = 'demo_owner_uid';
    const tenantId = `demo_${datasetKey}`;
    const ds = datasetKey === 'ecole' ? buildEcoleDemoDataset(uid) : buildPagnesDemoDataset(uid);
    const nowIso = new Date().toISOString();
    const planDef = PLANS.pro; // Plan Pro pour démontrer WhatsApp + Rapports en mode démo

    setTenant({
      id: tenantId,
      name: ds.businessName,
      sector: ds.sector,
      phone: '+237677001122',
      email: 'contact@demo-cameroun.cm',
      plan: 'pro',
      maxDebtors: planDef.maxDebtors,
      maxRemindersPerMonth: planDef.maxRemindersPerMonth,
      remindersUsedThisMonth: ds.logs.filter((l) => l.direction === 'outbound').length,
      quotaResetMonth: getCurrentDoualaMonth(),
      subscriptionDate: nowIso,
      quietHoursStart: 20,
      quietHoursEnd: 7,
      timezone: 'Africa/Douala',
      autoEscalate: true,
      fallbackToSms: true,
      ownerId: uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    setTeamUsers([
      {
        id: uid,
        tenantId,
        uid,
        role: 'owner',
        name: datasetKey === 'ecole' ? 'M. Économe Nguema' : 'Mama Clarisse',
        email: 'contact@demo-cameroun.cm',
        status: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);
    setTeamInvites([]);
    setDebtors(ds.debtors.map((d) => ({ ...d, tenantId, createdAt: nowIso, updatedAt: nowIso })));
    setRawDebts(ds.debts.map((d) => ({ ...d, tenantId, createdAt: nowIso, updatedAt: nowIso })));
    setPayments(ds.payments.map((p) => ({ ...p, tenantId, createdAt: p.paidAt })));
    setReminderRules(
      DEFAULT_REMINDER_RULES.map((r, i) => ({ ...r, id: `rule_${i + 1}`, tenantId, updatedAt: nowIso }))
    );
    setMessageTemplates(
      DEFAULT_TEMPLATES.map((t, i) => ({ ...t, id: `tpl_${i + 1}`, tenantId, updatedAt: nowIso }))
    );
    setReminders([]);
    setMessageLogs(ds.logs.map((l) => ({ ...l, tenantId, createdAt: nowIso })));
    setLoadingData(false);
  }, []);

  // Écoute Firestore temps réel si authentifié et vérifié
  useEffect(() => {
    if (demoMode) {
      initLocalDemoState(demoDatasetKey);
      return;
    }

    if (!user || !user.emailVerified || !profile?.tenantId) {
      setTenant(null);
      setDebtors([]);
      setRawDebts([]);
      setPayments([]);
      setReminderRules([]);
      setMessageTemplates([]);
      setReminders([]);
      setMessageLogs([]);
      return;
    }

    const tenantId = profile.tenantId;
    setLoadingData(true);

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        doc(db, 'tenants', tenantId),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data();
            setTenant({
              id: snap.id,
              name: d.name,
              sector: d.sector,
              phone: d.phone,
              email: d.email,
              plan: d.plan,
              maxDebtors: d.maxDebtors,
              maxRemindersPerMonth: d.maxRemindersPerMonth,
              remindersUsedThisMonth: d.remindersUsedThisMonth,
              quotaResetMonth: d.quotaResetMonth,
              subscriptionDate: d.subscriptionDate,
              quietHoursStart: d.quietHoursStart,
              quietHoursEnd: d.quietHoursEnd,
              timezone: d.timezone,
              autoEscalate: d.autoEscalate,
              fallbackToSms: d.fallbackToSms,
              ownerId: d.ownerId,
              createdAt: tsToIso(d.createdAt),
              updatedAt: tsToIso(d.updatedAt),
            });
          }
          setLoadingData(false);
        },
        (err) => handleFirestoreError(err, OperationType.GET, `tenants/${tenantId}`)
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'tenants', tenantId, 'users'),
        (snap) => {
          setTeamUsers(
            snap.docs.map((docItem) => {
              const d = docItem.data();
              return {
                id: docItem.id,
                tenantId: d.tenantId,
                uid: d.uid,
                role: d.role,
                name: d.name,
                email: d.email,
                status: d.status,
                inviteId: d.inviteId,
                createdAt: tsToIso(d.createdAt),
                updatedAt: tsToIso(d.updatedAt),
              };
            })
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/users`)
      )
    );

    if (profile.role === 'owner') {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'tenantInvites'), where('invitedBy', '==', user.uid)),
          (snap) => {
            setTeamInvites(
              snap.docs.map((docItem) => {
                const d = docItem.data();
                return {
                  id: docItem.id,
                  tenantId: d.tenantId,
                  tenantName: d.tenantName,
                  email: d.email,
                  name: d.name,
                  role: 'staff',
                  status: d.status,
                  invitedBy: d.invitedBy,
                  createdAt: tsToIso(d.createdAt),
                };
              })
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'tenantInvites')
        )
      );
    }

    unsubs.push(
      onSnapshot(
        query(collection(db, 'tenants', tenantId, 'debtors'), orderBy('createdAt', 'desc')),
        (snap) => {
          setDebtors(
            snap.docs.map((docItem) => {
              const d = docItem.data();
              return {
                id: docItem.id,
                tenantId: d.tenantId,
                name: d.name,
                phone: d.phone,
                preferredChannel: d.preferredChannel,
                note: d.note,
                optOut: Boolean(d.optOut),
                reliabilityScore: Number(d.reliabilityScore ?? 80),
                promiseDate: d.promiseDate,
                createdAt: tsToIso(d.createdAt),
                updatedAt: tsToIso(d.updatedAt),
              };
            })
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/debtors`)
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'tenants', tenantId, 'debts'), orderBy('createdAt', 'desc')),
        (snap) => {
          setRawDebts(
            snap.docs.map((docItem) => {
              const d = docItem.data();
              return {
                id: docItem.id,
                tenantId: d.tenantId,
                debtorId: d.debtorId,
                debtorName: d.debtorName,
                debtorPhone: d.debtorPhone,
                initialAmount: Number(d.initialAmount),
                remainingAmount: Number(d.remainingAmount),
                issuedAt: d.issuedAt,
                dueDate: d.dueDate,
                status: d.status,
                description: d.description,
                reminderCount: Number(d.reminderCount ?? 0),
                lastReminderAt: d.lastReminderAt,
                paymentLink: d.paymentLink,
                createdAt: tsToIso(d.createdAt),
                updatedAt: tsToIso(d.updatedAt),
              };
            })
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/debts`)
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'tenants', tenantId, 'payments'), orderBy('createdAt', 'desc')),
        (snap) => {
          setPayments(
            snap.docs.map((docItem) => {
              const d = docItem.data();
              return {
                id: docItem.id,
                tenantId: d.tenantId,
                debtId: d.debtId,
                debtorId: d.debtorId,
                debtorName: d.debtorName,
                amount: Number(d.amount),
                paidAt: d.paidAt,
                method: d.method,
                note: d.note,
                receiptNumber: d.receiptNumber,
                createdBy: d.createdBy,
                createdAt: tsToIso(d.createdAt),
              };
            })
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/payments`)
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'tenants', tenantId, 'reminderRules'),
        (snap) => {
          setReminderRules(
            snap.docs
              .map((docItem) => {
                const d = docItem.data();
                return {
                  id: docItem.id,
                  tenantId: d.tenantId,
                  offsetDays: Number(d.offsetDays),
                  label: d.label,
                  channel: d.channel,
                  tone: d.tone,
                  allowedStartHour: Number(d.allowedStartHour),
                  allowedEndHour: Number(d.allowedEndHour),
                  maxReminders: Number(d.maxReminders),
                  enabled: Boolean(d.enabled),
                  updatedAt: tsToIso(d.updatedAt),
                };
              })
              .sort((a, b) => a.offsetDays - b.offsetDays)
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/reminderRules`)
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'tenants', tenantId, 'messageTemplates'),
        (snap) => {
          setMessageTemplates(
            snap.docs.map((docItem) => {
              const d = docItem.data();
              return {
                id: docItem.id,
                tenantId: d.tenantId,
                tone: d.tone,
                channel: d.channel,
                body: d.body,
                metaTemplateName: d.metaTemplateName,
                updatedAt: tsToIso(d.updatedAt),
              };
            })
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/messageTemplates`)
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'tenants', tenantId, 'reminders'), orderBy('createdAt', 'desc')),
        (snap) => {
          setReminders(
            snap.docs.map((docItem) => {
              const d = docItem.data();
              return {
                id: docItem.id,
                tenantId: d.tenantId,
                debtId: d.debtId,
                debtorId: d.debtorId,
                scheduledAt: d.scheduledAt,
                channel: d.channel,
                tone: d.tone,
                status: d.status,
                providerMessageId: d.providerMessageId,
                createdAt: tsToIso(d.createdAt),
                updatedAt: tsToIso(d.updatedAt),
              };
            })
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/reminders`)
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'tenants', tenantId, 'messageLogs'), orderBy('createdAt', 'desc')),
        (snap) => {
          setMessageLogs(
            snap.docs.map((docItem) => {
              const d = docItem.data();
              return {
                id: docItem.id,
                tenantId: d.tenantId,
                debtId: d.debtId,
                debtorId: d.debtorId,
                debtorName: d.debtorName,
                debtorPhone: d.debtorPhone,
                reminderId: d.reminderId,
                direction: d.direction,
                channel: d.channel,
                tone: d.tone,
                content: d.content,
                status: d.status,
                providerMessageId: d.providerMessageId,
                detectedIntent: d.detectedIntent,
                promiseDate: d.promiseDate,
                createdAt: tsToIso(d.createdAt),
              };
            })
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/messageLogs`)
      )
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [demoMode, demoDatasetKey, initLocalDemoState, profile?.tenantId, profile?.role, user]);

  // Recalcul dynamique du statut de retard selon la date Africa/Douala
  const debts = useMemo(
    () =>
      rawDebts.map((d) => ({
        ...d,
        status: computeDebtStatus(d),
      })),
    [rawDebts]
  );

  // ===========================================================================
  // ACTIONS DÉBITEURS
  // ===========================================================================
  const createDebtor: DataContextValue['createDebtor'] = async (input) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    if (debtors.length >= tenant.maxDebtors) {
      throw new Error(
        `Limite atteinte : votre forfait ${PLANS[tenant.plan].name} autorise ${tenant.maxDebtors} débiteurs maximum. Passez au forfait supérieur.`
      );
    }

    const check = validateDebtorInput(input);
    if (!check.ok) throw new Error(check.error);

    const id = makeId('deb');
    const nowIso = new Date().toISOString();
    const newDebtor: Debtor = {
      id,
      tenantId: tenant.id,
      name: input.name.trim(),
      phone: check.normalizedPhone,
      preferredChannel: PLANS[tenant.plan].whatsappEnabled ? input.preferredChannel : 'sms',
      note: input.note.trim(),
      optOut: false,
      reliabilityScore: 80,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (demoMode) {
      setDebtors((prev) => [newDebtor, ...prev]);
      return id;
    }

    try {
      await setDoc(doc(db, 'tenants', tenant.id, 'debtors', id), {
        tenantId: tenant.id,
        name: newDebtor.name,
        phone: newDebtor.phone,
        preferredChannel: newDebtor.preferredChannel,
        note: newDebtor.note,
        optOut: false,
        reliabilityScore: 80,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `tenants/${tenant.id}/debtors/${id}`);
    }
  };

  const updateDebtor: DataContextValue['updateDebtor'] = async (id, patch) => {
    if (!tenant) return;
    if (demoMode) {
      setDebtors((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d))
      );
      return;
    }

    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.name !== undefined) payload.name = patch.name.trim().slice(0, 120);
    if (patch.phone !== undefined) payload.phone = patch.phone.trim();
    if (patch.preferredChannel !== undefined) payload.preferredChannel = patch.preferredChannel;
    if (patch.note !== undefined) payload.note = patch.note.trim().slice(0, 500);
    if (patch.optOut !== undefined) payload.optOut = patch.optOut;
    if (patch.reliabilityScore !== undefined) payload.reliabilityScore = patch.reliabilityScore;
    if (patch.promiseDate !== undefined && patch.promiseDate !== '') payload.promiseDate = patch.promiseDate;

    try {
      await updateDoc(doc(db, 'tenants', tenant.id, 'debtors', id), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tenants/${tenant.id}/debtors/${id}`);
    }
  };

  const deleteDebtor: DataContextValue['deleteDebtor'] = async (id) => {
    if (!tenant) return;
    if (demoMode) {
      setDebtors((prev) => prev.filter((d) => d.id !== id));
      return;
    }
    try {
      await deleteDoc(doc(db, 'tenants', tenant.id, 'debtors', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tenants/${tenant.id}/debtors/${id}`);
    }
  };

  const bulkImportDebtors: DataContextValue['bulkImportDebtors'] = async (rows) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    const availableSlots = Math.max(0, tenant.maxDebtors - debtors.length);
    if (rows.length > availableSlots) {
      throw new Error(
        `Import bloqué : il vous reste ${availableSlots} place(s) sur votre forfait ${PLANS[tenant.plan].name}.`
      );
    }

    const nowIso = new Date().toISOString();
    const created: Debtor[] = [];
    const batch = demoMode ? null : writeBatch(db);

    for (const r of rows) {
      const check = validateDebtorInput(r);
      if (!check.ok) continue;
      const id = makeId('deb');
      const item: Debtor = {
        id,
        tenantId: tenant.id,
        name: r.name.trim(),
        phone: check.normalizedPhone,
        preferredChannel: PLANS[tenant.plan].whatsappEnabled ? r.preferredChannel : 'sms',
        note: r.note.trim(),
        optOut: false,
        reliabilityScore: 80,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      created.push(item);
      if (batch) {
        batch.set(doc(db, 'tenants', tenant.id, 'debtors', id), {
          tenantId: tenant.id,
          name: item.name,
          phone: item.phone,
          preferredChannel: item.preferredChannel,
          note: item.note,
          optOut: false,
          reliabilityScore: 80,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (demoMode) {
      setDebtors((prev) => [...created, ...prev]);
      return created.length;
    }

    if (batch && created.length > 0) {
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `tenants/${tenant.id}/debtors`);
      }
    }
    return created.length;
  };

  // ===========================================================================
  // ACTIONS DETTES
  // ===========================================================================
  const createDebt: DataContextValue['createDebt'] = async (input) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    const check = validateDebtInput(input);
    if (!check.ok) throw new Error(check.error);

    const debtor = debtors.find((d) => d.id === input.debtorId);
    if (!debtor) throw new Error('Débiteur sélectionné introuvable.');

    const id = makeId('det');
    const issuedAt = getTodayDoualaDate();
    const status = computeDebtStatus({
      initialAmount: input.initialAmount,
      remainingAmount: input.initialAmount,
      dueDate: input.dueDate,
      status: 'en_cours',
    });
    const nowIso = new Date().toISOString();

    const newDebt: Debt = {
      id,
      tenantId: tenant.id,
      debtorId: debtor.id,
      debtorName: debtor.name,
      debtorPhone: debtor.phone,
      initialAmount: Math.round(input.initialAmount),
      remainingAmount: Math.round(input.initialAmount),
      issuedAt,
      dueDate: input.dueDate,
      status,
      description: input.description.trim() || 'Créance client',
      reminderCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (demoMode) {
      setRawDebts((prev) => [newDebt, ...prev]);
      return id;
    }

    try {
      await setDoc(doc(db, 'tenants', tenant.id, 'debts', id), {
        tenantId: tenant.id,
        debtorId: newDebt.debtorId,
        debtorName: newDebt.debtorName,
        debtorPhone: newDebt.debtorPhone,
        initialAmount: newDebt.initialAmount,
        remainingAmount: newDebt.remainingAmount,
        issuedAt: newDebt.issuedAt,
        dueDate: newDebt.dueDate,
        status: newDebt.status,
        description: newDebt.description,
        reminderCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `tenants/${tenant.id}/debts/${id}`);
    }
  };

  const cancelDebt: DataContextValue['cancelDebt'] = async (debtId) => {
    if (!tenant) return;
    if (demoMode) {
      setRawDebts((prev) =>
        prev.map((d) => (d.id === debtId ? { ...d, status: 'annulee', updatedAt: new Date().toISOString() } : d))
      );
      return;
    }
    try {
      await updateDoc(doc(db, 'tenants', tenant.id, 'debts', debtId), {
        status: 'annulee',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tenants/${tenant.id}/debts/${debtId}`);
    }
  };

  // ===========================================================================
  // ACTIONS PAIEMENTS
  // ===========================================================================
  const recordPayment: DataContextValue['recordPayment'] = async (input) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    const debt = debts.find((d) => d.id === input.debtId);
    if (!debt) throw new Error('Dette introuvable.');
    if (debt.status === 'payee' || debt.status === 'annulee') {
      throw new Error('Cette dette est déjà soldée ou annulée.');
    }

    const amount = Math.round(input.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Montant du paiement invalide.');
    }
    if (amount > debt.remainingAmount) {
      throw new Error('Le montant saisi dépasse le solde restant dû.');
    }

    const newRemaining = debt.remainingAmount - amount;
    const newStatus = newRemaining === 0 ? 'payee' : computeDebtStatus({
      initialAmount: debt.initialAmount,
      remainingAmount: newRemaining,
      dueDate: debt.dueDate,
      status: 'partiellement_payee',
    });

    const payId = makeId('pay');
    const nowIso = new Date().toISOString();
    const receiptNumber = `REC-${nowIso.slice(0, 4)}-${Math.floor(1000 + Math.random() * 8999)}`;

    const payment: Payment = {
      id: payId,
      tenantId: tenant.id,
      debtId: debt.id,
      debtorId: debt.debtorId,
      debtorName: debt.debtorName,
      amount,
      paidAt: nowIso,
      method: input.method,
      note: input.note.trim(),
      receiptNumber,
      createdBy: user?.uid || 'demo_owner_uid',
      createdAt: nowIso,
    };

    if (demoMode) {
      setPayments((prev) => [payment, ...prev]);
      setRawDebts((prev) =>
        prev.map((d) =>
          d.id === debt.id ? { ...d, remainingAmount: newRemaining, status: newStatus, updatedAt: nowIso } : d
        )
      );
      return payment;
    }

    const batch = writeBatch(db);
    batch.set(doc(db, 'tenants', tenant.id, 'payments', payId), {
      tenantId: tenant.id,
      debtId: payment.debtId,
      debtorId: payment.debtorId,
      debtorName: payment.debtorName,
      amount: payment.amount,
      paidAt: payment.paidAt,
      method: payment.method,
      note: payment.note,
      receiptNumber: payment.receiptNumber,
      createdBy: payment.createdBy,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'tenants', tenant.id, 'debts', debt.id), {
      remainingAmount: newRemaining,
      status: newStatus,
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return payment;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tenants/${tenant.id}/payments/${payId}`);
    }
  };

  const generatePaymentLink: DataContextValue['generatePaymentLink'] = async (debt) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    if (demoMode) {
      const ref = `DEMO-${debt.id.slice(-4).toUpperCase()}-${Date.now().toString().slice(-4)}`;
      const demoUrl = `${window.location.origin}/dettes?payer=${encodeURIComponent(debt.id)}&ref=${encodeURIComponent(ref)}&montant=${debt.remainingAmount}`;
      setRawDebts((prev) => prev.map((d) => (d.id === debt.id ? { ...d, paymentLink: demoUrl } : d)));
      return demoUrl;
    }

    const headers = await getAuthHeaders();
    const resp = await fetch('/api/payments/create-link', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: tenant.id,
        debtId: debt.id,
      }),
    });
    const data = (await resp.json()) as { paymentUrl?: string; error?: string };
    if (!resp.ok || !data.paymentUrl) {
      throw new Error(data.error || 'Impossible de générer le lien Mobile Money.');
    }
    return data.paymentUrl;
  };

  // ===========================================================================
  // MOTEUR DE RELANCES & INTEGRATIONS WHATSAPP / SMS
  // ===========================================================================
  const sendReminderNow: DataContextValue['sendReminderNow'] = async (debtId, overrideChannel, overrideTone) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    const debt = debts.find((d) => d.id === debtId);
    if (!debt) throw new Error('Dette introuvable.');
    if (debt.status === 'payee' || debt.status === 'annulee' || debt.remainingAmount <= 0) {
      throw new Error('Relance impossible : cette dette est déjà soldée ou annulée.');
    }

    const debtor = debtors.find((d) => d.id === debt.debtorId);
    if (!debtor) throw new Error('Débiteur introuvable.');
    if (debtor.optOut) {
      throw new Error(`${debtor.name} a demandé l’arrêt des messages (Opt-out actif).`);
    }

    if (tenant.remindersUsedThisMonth >= tenant.maxRemindersPerMonth) {
      throw new Error(
        `Quota mensuel atteint (${tenant.remindersUsedThisMonth}/${tenant.maxRemindersPerMonth}). Passez au forfait supérieur pour continuer.`
      );
    }

    const hour = getCurrentDoualaHour();
    const isQuiet =
      tenant.quietHoursStart > tenant.quietHoursEnd
        ? hour >= tenant.quietHoursStart || hour < tenant.quietHoursEnd
        : hour >= tenant.quietHoursStart && hour < tenant.quietHoursEnd;
    if (isQuiet) {
      throw new Error(
        `Envoi bloqué par les heures de tranquillité (${tenant.quietHoursStart}h–${tenant.quietHoursEnd}h à Douala). Réessayez en journée.`
      );
    }

    if (demoMode) {
      const daysOverdue = getDaysOverdue(debt.dueDate);
      const tone: Tone = overrideTone || pickEscalatedTone(daysOverdue, tenant.autoEscalate);
      const whatsappAllowed = PLANS[tenant.plan].whatsappEnabled;
      const requestedChannel: Channel =
        whatsappAllowed ? overrideChannel || debtor.preferredChannel : 'sms';

      const template =
        messageTemplates.find((t) => t.tone === tone && t.channel === requestedChannel) ||
        messageTemplates.find((t) => t.tone === tone) ||
        messageTemplates[0];

      const bodyText = renderTemplateMessage(template?.body || '', {
        nom: debtor.name,
        montant_restant: debt.remainingAmount,
        echeance: debt.dueDate,
        entreprise: tenant.name,
      });

      const remId = makeId('rem');
      const logId = makeId('log');
      const nowIso = new Date().toISOString();
      const simId = `sim_${requestedChannel}_${Date.now()}`;

      setReminders((prev) => [
        {
          id: remId,
          tenantId: tenant.id,
          debtId: debt.id,
          debtorId: debtor.id,
          scheduledAt: nowIso,
          channel: requestedChannel,
          tone,
          status: 'envoyee',
          providerMessageId: simId,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        ...prev,
      ]);
      setMessageLogs((prev) => [
        {
          id: logId,
          tenantId: tenant.id,
          debtId: debt.id,
          debtorId: debtor.id,
          debtorName: debtor.name,
          debtorPhone: debtor.phone,
          reminderId: remId,
          direction: 'outbound',
          channel: requestedChannel,
          tone,
          content: bodyText,
          status: 'simule',
          providerMessageId: simId,
          detectedIntent: 'none',
          createdAt: nowIso,
        },
        ...prev,
      ]);
      setRawDebts((prev) =>
        prev.map((d) =>
          d.id === debt.id
            ? { ...d, reminderCount: d.reminderCount + 1, lastReminderAt: nowIso, updatedAt: nowIso }
            : d
        )
      );
      setTenant((prev) =>
        prev ? { ...prev, remindersUsedThisMonth: prev.remindersUsedThisMonth + 1 } : prev
      );
      return { status: 'simule', channel: requestedChannel, usedFallback: false };
    }

    const headers = await getAuthHeaders();
    const resp = await fetch('/api/reminders/dispatch', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: tenant.id,
        debtId: debt.id,
        ...(overrideChannel ? { channel: overrideChannel } : {}),
        ...(overrideTone ? { tone: overrideTone } : {}),
      }),
    });

    const dispatchRes = (await resp.json()) as {
      ok?: boolean;
      channel?: Channel;
      usedFallback?: boolean;
      status?: 'simule' | 'envoyee' | 'echouee';
      error?: string;
      errorMessage?: string;
    };

    if (!resp.ok) {
      throw new Error(dispatchRes.error || dispatchRes.errorMessage || 'Échec de l’envoi de la relance.');
    }

    return {
      status: dispatchRes.status || 'envoyee',
      channel: dispatchRes.channel || 'sms',
      usedFallback: Boolean(dispatchRes.usedFallback),
    };
  };

  const sendBulkOverdueReminders: DataContextValue['sendBulkOverdueReminders'] = async (debtIds) => {
    let sent = 0;
    let skipped = 0;
    for (const id of debtIds) {
      try {
        await sendReminderNow(id);
        sent += 1;
      } catch {
        skipped += 1;
      }
    }
    return { sent, skipped };
  };

  const simulateInboundWhatsapp: DataContextValue['simulateInboundWhatsapp'] = async ({
    fromPhone,
    messageText,
  }) => {
    if (!tenant) throw new Error('Entreprise introuvable.');

    const matchedDebtor = debtors.find((d) => d.phone === fromPhone) || debtors[0];
    if (!matchedDebtor) throw new Error('Aucun débiteur correspondant.');

    if (demoMode) {
      const res = analyzeInboundMessage(messageText);
      const logId = makeId('log_in');
      const nowIso = new Date().toISOString();
      const newNote =
        res.intent === 'promise' && res.promiseDate
          ? `${matchedDebtor.note ? `${matchedDebtor.note} | ` : ''}Promesse (${res.promiseDate}) : ${messageText}`.slice(0, 500)
          : matchedDebtor.note;

      setDebtors((prev) =>
        prev.map((d) =>
          d.id === matchedDebtor.id
            ? {
                ...d,
                optOut: res.intent === 'opt_out' ? true : d.optOut,
                promiseDate: res.promiseDate || d.promiseDate,
                note: newNote,
                updatedAt: nowIso,
              }
            : d
        )
      );
      setMessageLogs((prev) => [
        {
          id: logId,
          tenantId: tenant.id,
          debtorId: matchedDebtor.id,
          debtorName: matchedDebtor.name,
          debtorPhone: matchedDebtor.phone,
          direction: 'inbound',
          channel: 'whatsapp',
          content: messageText,
          status: 'recue',
          providerMessageId: `in_sim_${Date.now()}`,
          detectedIntent: res.intent,
          promiseDate: res.promiseDate || undefined,
          createdAt: nowIso,
        },
        ...prev,
      ]);
      return { intent: res.intent, promiseDate: res.promiseDate || null };
    }

    const resp = await fetch('/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromPhone, messageText }),
    });
    const res = (await resp.json()) as {
      intent?: 'opt_out' | 'promise' | 'none';
      promiseDate?: string | null;
      error?: string;
    };
    if (!resp.ok || !res.intent) {
      throw new Error(res.error || 'Webhook WhatsApp refusé par le serveur.');
    }

    const logId = makeId('log_in');
    const newNote =
      res.intent === 'promise' && res.promiseDate
        ? `${matchedDebtor.note ? `${matchedDebtor.note} | ` : ''}Promesse (${res.promiseDate}) : ${messageText}`.slice(0, 500)
        : matchedDebtor.note;

    const batch = writeBatch(db);
    batch.set(doc(db, 'tenants', tenant.id, 'messageLogs', logId), {
      tenantId: tenant.id,
      debtorId: matchedDebtor.id,
      debtorName: matchedDebtor.name,
      debtorPhone: matchedDebtor.phone,
      direction: 'inbound',
      channel: 'whatsapp',
      content: messageText.slice(0, 1500),
      status: 'recue',
      providerMessageId: `in_sim_${Date.now()}`,
      detectedIntent: res.intent,
      ...(res.promiseDate ? { promiseDate: res.promiseDate } : {}),
      createdAt: serverTimestamp(),
    });

    if (res.intent === 'opt_out') {
      batch.update(doc(db, 'tenants', tenant.id, 'debtors', matchedDebtor.id), {
        optOut: true,
        updatedAt: serverTimestamp(),
      });
    } else if (res.intent === 'promise' && res.promiseDate) {
      batch.update(doc(db, 'tenants', tenant.id, 'debtors', matchedDebtor.id), {
        promiseDate: res.promiseDate,
        note: newNote,
        updatedAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
      return { intent: res.intent, promiseDate: res.promiseDate || null };
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tenants/${tenant.id}/messageLogs/${logId}`);
    }
  };

  const simulatePaymentWebhook: DataContextValue['simulatePaymentWebhook'] = async ({
    debtId,
    amount,
    method,
  }) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    if (demoMode) {
      await recordPayment({
        debtId,
        amount,
        method,
        note: 'Paiement confirmé via webhook Mobile Money',
      });
      return;
    }

    const transactionRef = `SIM-${debtId.slice(-6).toUpperCase()}-${Date.now()}`;
    const resp = await fetch('/api/webhooks/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: tenant.id,
        debtId,
        amount,
        method,
        transactionRef,
      }),
    });
    const data = (await resp.json()) as { ok?: boolean; error?: string };
    if (!resp.ok) {
      throw new Error(data.error || 'Erreur webhook Mobile Money.');
    }
  };

  // ===========================================================================
  // PARAMÈTRES, ÉQUIPE & ABONNEMENT
  // ===========================================================================
  const updateTenantSettings: DataContextValue['updateTenantSettings'] = async (patch) => {
    if (!tenant) return;
    if (demoMode) {
      setTenant((prev) => (prev ? { ...prev, ...patch, updatedAt: new Date().toISOString() } : prev));
      return;
    }
    try {
      await updateDoc(doc(db, 'tenants', tenant.id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tenants/${tenant.id}`);
    }
  };

  const updateMessageTemplate: DataContextValue['updateMessageTemplate'] = async (templateId, body) => {
    if (!tenant) return;
    if (body.trim().length < 10) {
      throw new Error('Le modèle de message doit contenir au moins 10 caractères.');
    }
    if (demoMode) {
      setMessageTemplates((prev) =>
        prev.map((t) => (t.id === templateId ? { ...t, body, updatedAt: new Date().toISOString() } : t))
      );
      return;
    }
    try {
      await updateDoc(doc(db, 'tenants', tenant.id, 'messageTemplates', templateId), {
        body: body.trim().slice(0, 1000),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tenants/${tenant.id}/messageTemplates/${templateId}`);
    }
  };

  const updateReminderRule: DataContextValue['updateReminderRule'] = async (ruleId, patch) => {
    if (!tenant) return;
    if (demoMode) {
      setReminderRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r))
      );
      return;
    }
    try {
      await updateDoc(doc(db, 'tenants', tenant.id, 'reminderRules', ruleId), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tenants/${tenant.id}/reminderRules/${ruleId}`);
    }
  };

  const inviteStaffMember: DataContextValue['inviteStaffMember'] = async ({ name, email }) => {
    if (!tenant || !user) return;
    if (!PLANS[tenant.plan].multiUserEnabled) {
      throw new Error('La gestion multi-utilisateurs est réservée au forfait Business.');
    }
    const inviteId = makeId('inv');
    const nowIso = new Date().toISOString();
    const cleanEmail = email.trim().toLowerCase();

    if (demoMode) {
      setTeamInvites((prev) => [
        {
          id: inviteId,
          tenantId: tenant.id,
          tenantName: tenant.name,
          email: cleanEmail,
          name: name.trim(),
          role: 'staff',
          status: 'pending',
          invitedBy: user?.uid || 'demo_owner_uid',
          createdAt: nowIso,
        },
        ...prev,
      ]);
      return;
    }

    try {
      await setDoc(doc(db, 'tenantInvites', inviteId), {
        tenantId: tenant.id,
        tenantName: tenant.name,
        email: cleanEmail,
        name: name.trim().slice(0, 120),
        role: 'staff',
        status: 'pending',
        invitedBy: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `tenantInvites/${inviteId}`);
    }
  };

  const revokeInvite: DataContextValue['revokeInvite'] = async (inviteId) => {
    if (demoMode) {
      setTeamInvites((prev) => prev.map((i) => (i.id === inviteId ? { ...i, status: 'revoked' } : i)));
      return;
    }
    try {
      await updateDoc(doc(db, 'tenantInvites', inviteId), { status: 'revoked' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tenantInvites/${inviteId}`);
    }
  };

  const upgradePlan: DataContextValue['upgradePlan'] = async (planId) => {
    if (!tenant) return;
    const target = PLANS[planId];
    const nowIso = new Date().toISOString();
    if (demoMode) {
      setTenant((prev) =>
        prev
          ? {
              ...prev,
              plan: planId,
              maxDebtors: target.maxDebtors,
              maxRemindersPerMonth: target.maxRemindersPerMonth,
              subscriptionDate: nowIso,
            }
          : prev
      );
      return;
    }

    const headers = await getAuthHeaders();
    const resp = await fetch('/api/billing/change-plan', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: tenant.id,
        planId,
      }),
    });
    const data = (await resp.json()) as { ok?: boolean; error?: string };
    if (!resp.ok) {
      throw new Error(data.error || 'Changement de forfait refusé.');
    }
  };

  const loadDemoDataset: DataContextValue['loadDemoDataset'] = async (key) => {
    if (demoMode) {
      initLocalDemoState(key);
      return;
    }
    if (!tenant || !user) return;
    const ds = key === 'ecole' ? buildEcoleDemoDataset(user.uid) : buildPagnesDemoDataset(user.uid);

    const batch = writeBatch(db);

    for (const d of ds.debtors) {
      batch.set(doc(db, 'tenants', tenant.id, 'debtors', d.id), {
        tenantId: tenant.id,
        name: d.name,
        phone: d.phone,
        preferredChannel: d.preferredChannel,
        note: d.note,
        optOut: d.optOut,
        reliabilityScore: d.reliabilityScore,
        ...(d.promiseDate ? { promiseDate: d.promiseDate } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const dt of ds.debts) {
      batch.set(doc(db, 'tenants', tenant.id, 'debts', dt.id), {
        tenantId: tenant.id,
        debtorId: dt.debtorId,
        debtorName: dt.debtorName,
        debtorPhone: dt.debtorPhone,
        initialAmount: dt.initialAmount,
        remainingAmount: dt.remainingAmount,
        issuedAt: dt.issuedAt,
        dueDate: dt.dueDate,
        status: dt.status,
        description: dt.description,
        reminderCount: dt.reminderCount,
        ...(dt.lastReminderAt ? { lastReminderAt: dt.lastReminderAt } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const p of ds.payments) {
      batch.set(doc(db, 'tenants', tenant.id, 'payments', p.id), {
        tenantId: tenant.id,
        debtId: p.debtId,
        debtorId: p.debtorId,
        debtorName: p.debtorName,
        amount: p.amount,
        paidAt: p.paidAt,
        method: p.method,
        note: p.note,
        receiptNumber: p.receiptNumber,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    }

    for (const l of ds.logs) {
      batch.set(doc(db, 'tenants', tenant.id, 'messageLogs', l.id), {
        tenantId: tenant.id,
        ...(l.debtId ? { debtId: l.debtId } : {}),
        debtorId: l.debtorId,
        debtorName: l.debtorName,
        debtorPhone: l.debtorPhone,
        direction: l.direction,
        channel: l.channel,
        ...(l.tone ? { tone: l.tone } : {}),
        content: l.content,
        status: l.status,
        providerMessageId: l.providerMessageId,
        detectedIntent: l.detectedIntent,
        ...(l.promiseDate ? { promiseDate: l.promiseDate } : {}),
        createdAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tenants/${tenant.id}/demoSeed`);
    }
  };

  return (
    <DataContext.Provider
      value={{
        tenant,
        teamUsers,
        teamInvites,
        debtors,
        debts,
        payments,
        reminderRules,
        messageTemplates,
        reminders,
        messageLogs,
        capabilities,
        loadingData,
        createDebtor,
        updateDebtor,
        deleteDebtor,
        bulkImportDebtors,
        createDebt,
        cancelDebt,
        recordPayment,
        generatePaymentLink,
        sendReminderNow,
        sendBulkOverdueReminders,
        simulateInboundWhatsapp,
        simulatePaymentWebhook,
        updateTenantSettings,
        updateMessageTemplate,
        updateReminderRule,
        inviteStaffMember,
        revokeInvite,
        upgradePlan,
        loadDemoDataset,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData doit être utilisé dans un DataProvider.');
  return ctx;
}
