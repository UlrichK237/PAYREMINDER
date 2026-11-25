import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { loadSecretsConfig } from '../config/env';
import { createSmsProvider } from '../services/sms';
import { sendWhatsAppTemplateMessage } from '../services/whatsapp';
import { createPaymentProvider } from '../services/payment';

function getDoualaNow() {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Douala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const hourStr =
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Douala',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .find((p) => p.type === 'hour')?.value ?? '12';
  return { ymd, month: ymd.slice(0, 7), hour: parseInt(hourStr, 10) % 24 };
}

function diffDays(dueDateYmd: string, todayYmd: string): number {
  const due = new Date(`${dueDateYmd}T00:00:00Z`).getTime();
  const ref = new Date(`${todayYmd}T00:00:00Z`).getTime();
  return Math.floor((ref - due) / (1000 * 60 * 60 * 24));
}

function formatFcfaServer(amount: number): string {
  return `${Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')}\u00A0FCFA`;
}

/**
 * Moteur de relances automatiques planifié toutes les 15 minutes (Cloud Scheduler).
 * Respecte : heures autorisées Africa/Douala, opt-out, dettes soldées/annulées,
 * escalade de ton, repli WhatsApp -> SMS et quotas serveur.
 */
export const scheduledReminderEngine = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'Africa/Douala',
    region: 'europe-west1',
  },
  async () => {
    const db = getFirestore();
    const secrets = loadSecretsConfig();
    const smsProvider = createSmsProvider(secrets);
    const paymentProvider = createPaymentProvider(secrets);
    const { ymd, month, hour } = getDoualaNow();

    const tenantsSnap = await db.collection('tenants').get();

    for (const tenantDoc of tenantsSnap.docs) {
      const tenant = tenantDoc.data();
      const tenantId = tenantDoc.id;

      // 1. Respect des heures de silence (jamais la nuit)
      const quietStart = Number(tenant.quietHoursStart ?? 20);
      const quietEnd = Number(tenant.quietHoursEnd ?? 7);
      const isQuietTime =
        quietStart > quietEnd
          ? hour >= quietStart || hour < quietEnd
          : hour >= quietStart && hour < quietEnd;
      if (isQuietTime) continue;

      // 2. Réinitialisation mensuelle éventuelle du compteur de relances
      let usedThisMonth = Number(tenant.remindersUsedThisMonth ?? 0);
      if (tenant.quotaResetMonth !== month) {
        usedThisMonth = 0;
        await tenantDoc.ref.update({
          remindersUsedThisMonth: 0,
          quotaResetMonth: month,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const maxRemindersQuota = Number(tenant.maxRemindersPerMonth ?? 30);
      if (usedThisMonth >= maxRemindersQuota) continue;

      const [rulesSnap, templatesSnap, debtorsSnap, debtsSnap] = await Promise.all([
        tenantDoc.ref.collection('reminderRules').where('enabled', '==', true).get(),
        tenantDoc.ref.collection('messageTemplates').get(),
        tenantDoc.ref.collection('debtors').get(),
        tenantDoc.ref.collection('debts').where('status', 'in', ['en_cours', 'partiellement_payee', 'en_retard']).get(),
      ]);

      const debtorsMap = new Map(debtorsSnap.docs.map((d) => [d.id, d.data()]));
      const rules = rulesSnap.docs.map((d) => d.data());
      const templates = templatesSnap.docs.map((d) => d.data());

      for (const debtDoc of debtsSnap.docs) {
        if (usedThisMonth >= maxRemindersQuota) break;
        const debt = debtDoc.data();

        // Arrêt immédiat si soldée / annulée
        if (debt.remainingAmount <= 0 || debt.status === 'payee' || debt.status === 'annulee') continue;

        const debtor = debtorsMap.get(debt.debtorId);
        // Arrêt immédiat si opt-out activé
        if (!debtor || debtor.optOut === true) continue;

        const daysOverdue = diffDays(debt.dueDate, ymd);

        // Met à jour automatiquement le statut en_retard si la date est dépassée
        if (daysOverdue > 0 && debt.status !== 'en_retard') {
          await debtDoc.ref.update({
            status: 'en_retard',
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        const matchingRule = rules.find((r) => Number(r.offsetDays) === daysOverdue);
        if (!matchingRule) continue;

        if (hour < Number(matchingRule.allowedStartHour) || hour >= Number(matchingRule.allowedEndHour)) {
          continue;
        }
        if (Number(debt.reminderCount ?? 0) >= Number(matchingRule.maxReminders ?? 5)) {
          continue;
        }

        // Éviter double envoi le même jour
        if (typeof debt.lastReminderAt === 'string' && debt.lastReminderAt.startsWith(ymd)) {
          continue;
        }

        // Escalade automatique du ton
        const tone =
          tenant.autoEscalate && daysOverdue > 10
            ? 'dernier_avis'
            : tenant.autoEscalate && daysOverdue > 2
              ? 'ferme'
              : (matchingRule.tone as string);

        const whatsappAllowed = tenant.plan === 'pro' || tenant.plan === 'business';
        let channel: 'whatsapp' | 'sms' =
          whatsappAllowed && (debtor.preferredChannel === 'whatsapp' || matchingRule.channel === 'whatsapp')
            ? 'whatsapp'
            : 'sms';

        const template =
          templates.find((t) => t.tone === tone && t.channel === channel) ||
          templates.find((t) => t.tone === tone) ||
          templates[0];

        const paymentLinkResult = await paymentProvider.createPaymentLink({
          tenantId,
          debtId: debtDoc.id,
          amountFcfa: debt.remainingAmount,
          customerPhone: debtor.phone,
          customerName: debtor.name,
          description: debt.description || 'Règlement créance',
        });

        const messageBody = String(template?.body || '')
          .replace(/\{nom\}/g, debtor.name)
          .replace(/\{montant_restant\}/g, formatFcfaServer(debt.remainingAmount))
          .replace(/\{echeance\}/g, debt.dueDate)
          .replace(/\{entreprise\}/g, tenant.name);

        let sendResult: {
          success: boolean;
          providerMessageId: string;
          status: 'simule' | 'envoyee' | 'echouee';
        };

        if (channel === 'whatsapp') {
          sendResult = await sendWhatsAppTemplateMessage({
            accessToken: secrets.whatsappAccessToken,
            phoneNumberId: secrets.whatsappPhoneNumberId,
            to: debtor.phone,
            templateName: template?.metaTemplateName || `payreminder_${tone}_fr`,
            variables: [debtor.name, formatFcfaServer(debt.remainingAmount), debt.dueDate, tenant.name],
            fallbackBody: messageBody,
          });

          // Repli automatique sur SMS si WhatsApp échoue
          if (!sendResult.success && tenant.fallbackToSms) {
            channel = 'sms';
            sendResult = await smsProvider.sendSms({
              to: debtor.phone,
              message: messageBody,
            });
          }
        } else {
          sendResult = await smsProvider.sendSms({
            to: debtor.phone,
            message: messageBody,
          });
        }

        const nowIso = new Date().toISOString();
        const reminderRef = tenantDoc.ref.collection('reminders').doc();
        await reminderRef.set({
          tenantId,
          debtId: debtDoc.id,
          debtorId: debt.debtorId,
          scheduledAt: nowIso,
          channel,
          tone,
          status: sendResult.status === 'simule' ? 'envoyee' : sendResult.status,
          providerMessageId: sendResult.providerMessageId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        await tenantDoc.ref.collection('messageLogs').add({
          tenantId,
          debtId: debtDoc.id,
          debtorId: debt.debtorId,
          debtorName: debtor.name,
          debtorPhone: debtor.phone,
          reminderId: reminderRef.id,
          direction: 'outbound',
          channel,
          tone,
          content: `${messageBody} Paiement : ${paymentLinkResult.paymentUrl}`,
          status: sendResult.status,
          providerMessageId: sendResult.providerMessageId,
          detectedIntent: 'none',
          createdAt: FieldValue.serverTimestamp(),
        });

        if (sendResult.success) {
          usedThisMonth += 1;
          await debtDoc.ref.update({
            reminderCount: FieldValue.increment(1),
            lastReminderAt: nowIso,
            paymentLink: paymentLinkResult.paymentUrl,
            updatedAt: FieldValue.serverTimestamp(),
          });
          await tenantDoc.ref.update({
            remindersUsedThisMonth: usedThisMonth,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }
  }
);
