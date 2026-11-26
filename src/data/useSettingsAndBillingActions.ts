import type React from 'react';
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  BillingRecord,
  Channel,
  MessageTemplate,
  ReminderRule,
  Tenant,
  TenantInvite,
} from '../types/payreminder';
import { buildEcoleDemoDataset, buildPagnesDemoDataset } from '../utils/demoData';
import { PLANS } from '../utils/plans';
import { validateTemplateBody } from '../utils/templateValidation';
import { getAuthHeaders, makeId } from './helpers';
import type { DataContextValue } from './types';

interface UseSettingsAndBillingActionsDeps {
  tenant: Tenant | null;
  messageTemplates: MessageTemplate[];
  demoMode: boolean;
  userUid?: string;
  initLocalDemoState: (key: 'pagnes' | 'ecole') => void;
  setTenant: React.Dispatch<React.SetStateAction<Tenant | null>>;
  setMessageTemplates: React.Dispatch<React.SetStateAction<MessageTemplate[]>>;
  setReminderRules: React.Dispatch<React.SetStateAction<ReminderRule[]>>;
  setTeamInvites: React.Dispatch<React.SetStateAction<TenantInvite[]>>;
  setBillingHistory: React.Dispatch<React.SetStateAction<BillingRecord[]>>;
  setPhoneVerified: React.Dispatch<React.SetStateAction<boolean>>;
  setPhoneVerifiedNumber?: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useSettingsAndBillingActions(deps: UseSettingsAndBillingActionsDeps) {
  const {
    tenant,
    messageTemplates,
    demoMode,
    userUid,
    initLocalDemoState,
    setTenant,
    setMessageTemplates,
    setReminderRules,
    setTeamInvites,
    setBillingHistory,
    setPhoneVerified,
    setPhoneVerifiedNumber,
  } = deps;

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
    const targetTpl = messageTemplates.find((t) => t.id === templateId);
    const channel: Channel = targetTpl?.channel || 'sms';
    const check = validateTemplateBody(body, channel);
    if (!check.ok) {
      throw new Error(check.error || 'Modèle de message invalide.');
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
    if (!tenant || !userUid) return;
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
          invitedBy: userUid || 'demo_owner_uid',
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
        invitedBy: userUid,
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
              maxRemindersPerDay: target.maxRemindersPerDay,
              subscriptionDate: nowIso,
              planStatus: 'active',
              lastPaymentAt: nowIso,
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

  const startPlanCheckout: DataContextValue['startPlanCheckout'] = async (planId) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    if (demoMode) {
      await upgradePlan(planId);
      const nowIso = new Date().toISOString();
      if (planId !== 'free') {
        const ref = makeId('abo_demo');
        setBillingHistory((prev) => [
          {
            id: ref,
            tenantId: tenant.id,
            planId,
            amountFcfa: PLANS[planId].priceFcfa,
            status: 'paid',
            paymentRef: ref,
            receiptNumber: `ABO-DEMO-${Date.now().toString().slice(-4)}`,
            method: 'mtn_momo',
            paidAt: nowIso,
            createdBy: userUid || 'demo_owner_uid',
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          ...prev,
        ]);
      }
      return { demoUpgraded: true };
    }

    const headers = await getAuthHeaders();
    const resp = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: tenant.id,
        planId,
      }),
    });
    const data = (await resp.json()) as {
      ok?: boolean;
      paymentUrl?: string;
      paymentRef?: string;
      amountFcfa?: number;
      error?: string;
    };
    if (!resp.ok || !data.paymentUrl || !data.paymentRef) {
      throw new Error(data.error || 'Impossible de lancer le paiement de l’abonnement.');
    }
    return {
      paymentUrl: data.paymentUrl,
      paymentRef: data.paymentRef,
      amountFcfa: data.amountFcfa,
    };
  };

  const simulateSubscriptionPayment: DataContextValue['simulateSubscriptionPayment'] = async (
    paymentRef
  ) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    const headers = await getAuthHeaders();
    const resp = await fetch('/api/simulate/subscription-payment', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: tenant.id,
        paymentRef,
      }),
    });
    const data = (await resp.json()) as { ok?: boolean; error?: string; reason?: string };
    if (!resp.ok || data.ok === false) {
      throw new Error(data.error || data.reason || 'Échec de la simulation du paiement abonnement.');
    }
  };

  const loadDemoDataset: DataContextValue['loadDemoDataset'] = async (key) => {
    if (demoMode) {
      initLocalDemoState(key);
      return;
    }
    if (!tenant || !userUid) return;
    const ds = key === 'ecole' ? buildEcoleDemoDataset(userUid) : buildPagnesDemoDataset(userUid);

    const batch = writeBatch(db);
    const consentNow = new Date().toISOString();

    for (const d of ds.debtors) {
      batch.set(doc(db, 'tenants', tenant.id, 'debtors', d.id), {
        tenantId: tenant.id,
        name: d.name,
        phone: d.phone,
        preferredChannel: d.preferredChannel,
        note: d.note,
        optOut: d.optOut,
        reliabilityScore: d.reliabilityScore,
        consentConfirmedAt: consentNow,
        consentConfirmedBy: userUid,
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
        createdBy: userUid,
        createdAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tenants/${tenant.id}/demoSeed`);
    }
  };

  const sendPhoneVerificationCode: DataContextValue['sendPhoneVerificationCode'] = async () => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    if (demoMode) {
      return { phone: tenant.phone, devCode: '123456' };
    }
    const headers = await getAuthHeaders();
    const resp = await fetch('/api/security/send-phone-code', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tenantId: tenant.id }),
    });
    const data = (await resp.json()) as {
      ok?: boolean;
      phone?: string;
      devCode?: string;
      error?: string;
    };
    if (!resp.ok) {
      throw new Error(data.error || 'Impossible d’envoyer le code SMS.');
    }
    return { phone: data.phone || tenant.phone, devCode: data.devCode };
  };

  const verifyPhoneVerificationCode: DataContextValue['verifyPhoneVerificationCode'] = async (code) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    if (demoMode) {
      if (code.trim() !== '123456') {
        throw new Error('Code démo invalide (utilisez 123456).');
      }
      setPhoneVerified(true);
      setPhoneVerifiedNumber?.(tenant.phone);
      return;
    }
    const headers = await getAuthHeaders();
    const resp = await fetch('/api/security/verify-phone-code', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tenantId: tenant.id, code: code.trim() }),
    });
    const data = (await resp.json()) as {
      ok?: boolean;
      phoneVerified?: boolean;
      phoneVerifiedNumber?: string;
      error?: string;
    };
    if (!resp.ok || !data.phoneVerified) {
      throw new Error(data.error || 'Code de vérification invalide.');
    }
    setPhoneVerified(true);
    setPhoneVerifiedNumber?.(data.phoneVerifiedNumber || tenant.phone);
  };

  return {
    updateTenantSettings,
    updateMessageTemplate,
    updateReminderRule,
    inviteStaffMember,
    revokeInvite,
    upgradePlan,
    startPlanCheckout,
    simulateSubscriptionPayment,
    loadDemoDataset,
    sendPhoneVerificationCode,
    verifyPhoneVerificationCode,
  };
}
