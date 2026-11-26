import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { tsToIso } from '../data/helpers';
import type { DataContextValue, ServerCapabilities } from '../data/types';
import { useDebtAndPaymentActions } from '../data/useDebtAndPaymentActions';
import { useDebtorActions } from '../data/useDebtorActions';
import { useReminderActions } from '../data/useReminderActions';
import { useSettingsAndBillingActions } from '../data/useSettingsAndBillingActions';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  AuditLogEntry,
  BillingRecord,
  Debt,
  Debtor,
  MessageLog,
  MessageTemplate,
  Payment,
  Reminder,
  ReminderRule,
  Tenant,
  TenantInvite,
  TenantUser,
} from '../types/payreminder';
import { DEFAULT_REMINDER_RULES, DEFAULT_TEMPLATES } from '../utils/defaults';
import { buildEcoleDemoDataset, buildPagnesDemoDataset } from '../utils/demoData';
import { computeDebtStatus, getCurrentDoualaMonth, getTodayDoualaDate } from '../utils/formatters';
import { PLANS } from '../utils/plans';
import { useAuth } from './AuthContext';

export type { ServerCapabilities };

const DataContext = createContext<DataContextValue | null>(null);

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
  const [billingHistory, setBillingHistory] = useState<BillingRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [dailyUsage, setDailyUsage] = useState<{ date: string; count: number }>({
    date: getTodayDoualaDate(),
    count: 0,
  });
  const [loadingData, setLoadingData] = useState(false);

  const [capabilities, setCapabilities] = useState<ServerCapabilities>({
    whatsappConfigured: false,
    smsConfigured: false,
    paymentConfigured: false,
    emailConfigured: false,
    simulationMode: true,
    simulationRoutes: false,
  });

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

  const initLocalDemoState = useCallback((datasetKey: 'pagnes' | 'ecole') => {
    const uid = 'demo_owner_uid';
    const tenantId = `demo_${datasetKey}`;
    const ds = datasetKey === 'ecole' ? buildEcoleDemoDataset(uid) : buildPagnesDemoDataset(uid);
    const nowIso = new Date().toISOString();
    const planDef = PLANS.pro;
    const expiresAtDemo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    setTenant({
      id: tenantId,
      name: ds.businessName,
      sector: ds.sector,
      phone: '+237677001122',
      email: 'contact@demo-cameroun.cm',
      plan: 'pro',
      maxDebtors: planDef.maxDebtors,
      maxRemindersPerMonth: planDef.maxRemindersPerMonth,
      maxRemindersPerDay: planDef.maxRemindersPerDay,
      remindersUsedThisMonth: ds.logs.filter((l) => l.direction === 'outbound').length,
      quotaResetMonth: getCurrentDoualaMonth(),
      subscriptionDate: nowIso,
      planExpiresAt: expiresAtDemo,
      planStatus: 'active',
      lastPaymentAt: nowIso,
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
    setDebtors(
      ds.debtors.map((d) => ({
        ...d,
        tenantId,
        consentConfirmedAt: nowIso,
        consentConfirmedBy: uid,
        createdAt: nowIso,
        updatedAt: nowIso,
      }))
    );
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
    setBillingHistory([
      {
        id: 'abo_demo_01',
        tenantId,
        planId: 'pro',
        amountFcfa: PLANS.pro.priceFcfa,
        status: 'paid',
        paymentRef: 'abo_demo_01',
        receiptNumber: 'ABO-2026-DEMO01',
        method: 'mtn_momo',
        paidAt: nowIso,
        createdBy: uid,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);
    setAuditLogs([
      {
        id: 'audit_demo_01',
        tenantId,
        action: 'subscription_payment',
        actorUid: uid,
        targetId: 'abo_demo_01',
        summary: 'Abonnement Pro activé (15 000 FCFA, reçu ABO-2026-DEMO01)',
        createdAt: nowIso,
      },
    ]);
    setPhoneVerified(false);
    setDailyUsage({ date: getTodayDoualaDate(), count: 0 });
    setLoadingData(false);
  }, []);

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
      setBillingHistory([]);
      setAuditLogs([]);
      setPhoneVerified(false);
      setDailyUsage({ date: getTodayDoualaDate(), count: 0 });
      return;
    }

    const tenantId = profile.tenantId;
    setLoadingData(true);

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        doc(db, 'tenantSecurity', tenantId),
        (snap) => {
          if (snap.exists()) {
            const sec = snap.data() as {
              phoneVerified?: boolean;
              dailyUsage?: { date?: string; count?: number };
            };
            const today = getTodayDoualaDate();
            setPhoneVerified(Boolean(sec.phoneVerified));
            setDailyUsage({
              date: today,
              count: sec.dailyUsage?.date === today ? Number(sec.dailyUsage.count || 0) : 0,
            });
          } else {
            setPhoneVerified(false);
            setDailyUsage({ date: getTodayDoualaDate(), count: 0 });
          }
        },
        () => {
          // Lecture optionnelle si document inexistant
        }
      )
    );

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
              maxRemindersPerDay: d.maxRemindersPerDay,
              remindersUsedThisMonth: d.remindersUsedThisMonth,
              quotaResetMonth: d.quotaResetMonth,
              subscriptionDate: d.subscriptionDate,
              planExpiresAt: d.planExpiresAt,
              planStatus: d.planStatus,
              lastPaymentAt: d.lastPaymentAt,
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

      unsubs.push(
        onSnapshot(
          query(collection(db, 'tenants', tenantId, 'billing'), orderBy('createdAt', 'desc')),
          (snap) => {
            setBillingHistory(
              snap.docs.map((docItem) => {
                const d = docItem.data();
                return {
                  id: docItem.id,
                  tenantId: d.tenantId,
                  planId: d.planId,
                  amountFcfa: Number(d.amountFcfa),
                  status: d.status,
                  paymentRef: d.paymentRef || docItem.id,
                  paymentUrl: d.paymentUrl,
                  receiptNumber: d.receiptNumber,
                  transactionRef: d.transactionRef,
                  method: d.method,
                  paidAt: d.paidAt,
                  createdBy: d.createdBy,
                  createdAt: tsToIso(d.createdAt),
                  updatedAt: tsToIso(d.updatedAt),
                };
              })
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/billing`)
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'tenants', tenantId, 'auditLogs'), orderBy('createdAt', 'desc')),
          (snap) => {
            setAuditLogs(
              snap.docs.map((docItem) => {
                const d = docItem.data();
                return {
                  id: docItem.id,
                  tenantId: d.tenantId,
                  action: d.action,
                  actorUid: d.actorUid,
                  targetId: d.targetId,
                  summary: d.summary,
                  metadata: d.metadata,
                  createdAt: tsToIso(d.createdAt),
                };
              })
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `tenants/${tenantId}/auditLogs`)
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
                consentConfirmedAt: d.consentConfirmedAt,
                consentConfirmedBy: d.consentConfirmedBy,
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

  const debts = useMemo(
    () =>
      rawDebts.map((d) => ({
        ...d,
        status: computeDebtStatus(d),
      })),
    [rawDebts]
  );

  const actorUid = user?.uid || 'demo_owner_uid';

  const debtorActions = useDebtorActions({
    tenant,
    debtors,
    demoMode,
    actorUid,
    setDebtors,
    setRawDebts,
    setPayments,
    setReminders,
    setMessageLogs,
    setAuditLogs,
  });

  const debtAndPaymentActions = useDebtAndPaymentActions({
    tenant,
    debtors,
    debts,
    demoMode,
    actorUid,
    setRawDebts,
    setPayments,
  });

  const reminderActions = useReminderActions({
    tenant,
    debtors,
    debts,
    messageTemplates,
    demoMode,
    recordPayment: debtAndPaymentActions.recordPayment,
    setTenant,
    setDebtors,
    setRawDebts,
    setReminders,
    setMessageLogs,
  });

  const settingsAndBillingActions = useSettingsAndBillingActions({
    tenant,
    messageTemplates,
    demoMode,
    userUid: user?.uid,
    initLocalDemoState,
    setTenant,
    setMessageTemplates,
    setReminderRules,
    setTeamInvites,
    setBillingHistory,
    setPhoneVerified,
  });

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
        billingHistory,
        auditLogs,
        capabilities,
        phoneVerified,
        dailyUsage,
        loadingData,
        ...debtorActions,
        ...debtAndPaymentActions,
        ...reminderActions,
        ...settingsAndBillingActions,
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
