import type React from 'react';
import type {
  Channel,
  Debt,
  Debtor,
  MessageLog,
  MessageTemplate,
  Payment,
  Reminder,
  Tenant,
  Tone,
} from '../types/payreminder';
import {
  getCurrentDoualaHour,
  getDaysOverdue,
  pickEscalatedTone,
  renderTemplateMessage,
} from '../utils/formatters';
import { analyzeInboundMessage } from '../utils/inboundAnalysis';
import { PLANS } from '../utils/plans';
import { getAuthHeaders, makeId } from './helpers';
import type { DataContextValue } from './types';

interface UseReminderActionsDeps {
  tenant: Tenant | null;
  debtors: Debtor[];
  debts: Debt[];
  messageTemplates: MessageTemplate[];
  demoMode: boolean;
  recordPayment: DataContextValue['recordPayment'];
  setTenant: React.Dispatch<React.SetStateAction<Tenant | null>>;
  setDebtors: React.Dispatch<React.SetStateAction<Debtor[]>>;
  setRawDebts: React.Dispatch<React.SetStateAction<Debt[]>>;
  setReminders: React.Dispatch<React.SetStateAction<Reminder[]>>;
  setMessageLogs: React.Dispatch<React.SetStateAction<MessageLog[]>>;
}

export function useReminderActions(deps: UseReminderActionsDeps) {
  const {
    tenant,
    debtors,
    debts,
    messageTemplates,
    demoMode,
    recordPayment,
    setTenant,
    setDebtors,
    setRawDebts,
    setReminders,
    setMessageLogs,
  } = deps;

  const sendReminderNow: DataContextValue['sendReminderNow'] = async (
    debtId,
    overrideChannel,
    overrideTone
  ) => {
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
      const requestedChannel: Channel = whatsappAllowed ? overrideChannel || debtor.preferredChannel : 'sms';

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
          d.id === debt.id ? { ...d, reminderCount: d.reminderCount + 1, lastReminderAt: nowIso, updatedAt: nowIso } : d
        )
      );
      setTenant((prev) => (prev ? { ...prev, remindersUsedThisMonth: prev.remindersUsedThisMonth + 1 } : prev));
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
          ? `${matchedDebtor.note ? `${matchedDebtor.note} | ` : ''}Promesse (${res.promiseDate}) : ${messageText}`.slice(
              0,
              500
            )
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

    const headers = await getAuthHeaders();
    const resp = await fetch('/api/simulate/whatsapp-inbound', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tenantId: tenant.id, fromPhone, messageText }),
    });
    const res = (await resp.json()) as {
      intent?: 'opt_out' | 'promise' | 'none';
      promiseDate?: string | null;
      error?: string;
    };
    if (!resp.ok || !res.intent) {
      throw new Error(res.error || 'Simulation WhatsApp refusée par le serveur.');
    }

    return { intent: res.intent, promiseDate: res.promiseDate || null };
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

    const headers = await getAuthHeaders();
    const transactionRef = `SIM-${debtId.slice(-6).toUpperCase()}-${Date.now()}`;
    const resp = await fetch('/api/simulate/payment', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: tenant.id,
        debtId,
        amount,
        method,
        transactionRef,
      }),
    });
    const data = (await resp.json()) as { ok?: boolean; error?: string; reason?: string };
    if (!resp.ok || data.ok === false) {
      throw new Error(data.error || data.reason || 'Erreur simulation paiement Mobile Money.');
    }
  };

  return {
    sendReminderNow,
    sendBulkOverdueReminders,
    simulateInboundWhatsapp,
    simulatePaymentWebhook,
  };
}
