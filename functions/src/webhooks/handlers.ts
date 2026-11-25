import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { loadSecretsConfig } from '../config/env';
import { analyzeInboundMessage } from '../services/whatsapp';

/**
 * Webhook WhatsApp Cloud API (vérification GET + statuts et messages entrants POST).
 */
export const whatsappWebhook = onRequest({ region: 'europe-west1' }, async (req, res) => {
  const secrets = loadSecretsConfig();

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === secrets.whatsappWebhookVerifyToken) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const db = getFirestore();
  const entries = (req.body?.entry || []) as Array<{
    changes?: Array<{
      value?: {
        statuses?: Array<{ id: string; status: 'sent' | 'delivered' | 'read' | 'failed' }>;
        messages?: Array<{ id: string; from: string; text?: { body?: string } }>;
      };
    }>;
  }>;

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;

      // 1. Mise à jour des statuts (envoyé, délivré, lu)
      for (const st of value.statuses || []) {
        const statusMap: Record<string, string> = {
          sent: 'envoyee',
          delivered: 'delivree',
          read: 'lue',
          failed: 'echouee',
        };
        const mapped = statusMap[st.status];
        if (!mapped) continue;

        const logsSnap = await db.collectionGroup('messageLogs').where('providerMessageId', '==', st.id).get();
        for (const docSnap of logsSnap.docs) {
          await docSnap.ref.update({ status: mapped });
        }
      }

      // 2. Réponses entrantes : détection STOP/ARRET et promesses de paiement
      for (const msg of value.messages || []) {
        const phone = msg.from.startsWith('+') ? msg.from : `+${msg.from}`;
        const bodyText = msg.text?.body || '';
        const analysis = analyzeInboundMessage(bodyText);

        const debtorsSnap = await db.collectionGroup('debtors').where('phone', '==', phone).get();
        for (const debtorDoc of debtorsSnap.docs) {
          const tenantRef = debtorDoc.ref.parent.parent;
          if (!tenantRef) continue;

          if (analysis.intent === 'opt_out') {
            await debtorDoc.ref.update({
              optOut: true,
              updatedAt: FieldValue.serverTimestamp(),
            });
          } else if (analysis.intent === 'promise' && analysis.promiseDate) {
            const currentNote = String(debtorDoc.data().note || '');
            await debtorDoc.ref.update({
              promiseDate: analysis.promiseDate,
              note: `${currentNote ? `${currentNote} | ` : ''}Promesse (${analysis.promiseDate}) : ${bodyText}`.slice(0, 500),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          await tenantRef.collection('messageLogs').add({
            tenantId: tenantRef.id,
            debtorId: debtorDoc.id,
            debtorName: debtorDoc.data().name,
            debtorPhone: phone,
            direction: 'inbound',
            channel: 'whatsapp',
            content: bodyText.slice(0, 1500),
            status: 'recue',
            providerMessageId: msg.id,
            detectedIntent: analysis.intent,
            ...(analysis.promiseDate ? { promiseDate: analysis.promiseDate } : {}),
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }
  }

  res.status(200).json({ ok: true });
});

/**
 * Webhook Mobile Money : marque automatiquement la dette comme payée lors de la confirmation.
 */
export const paymentWebhook = onRequest({ region: 'europe-west1' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const { tenantId, debtId, amount, method, transactionRef } = req.body as {
    tenantId?: string;
    debtId?: string;
    amount?: number;
    method?: 'mtn_momo' | 'orange_money';
    transactionRef?: string;
  };

  if (!tenantId || !debtId || !amount || amount <= 0) {
    res.status(400).json({ error: 'Paramètres webhook paiement invalides' });
    return;
  }

  const db = getFirestore();
  const debtRef = db.collection('tenants').doc(tenantId).collection('debts').doc(debtId);
  const debtSnap = await debtRef.get();
  if (!debtSnap.exists) {
    res.status(404).json({ error: 'Dette introuvable' });
    return;
  }

  const debt = debtSnap.data()!;
  const newRemaining = Math.max(0, Number(debt.remainingAmount) - Math.round(amount));
  const newStatus = newRemaining === 0 ? 'payee' : 'partiellement_payee';

  await db.runTransaction(async (tx) => {
    tx.update(debtRef, {
      remainingAmount: newRemaining,
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const payRef = db.collection('tenants').doc(tenantId).collection('payments').doc();
    tx.set(payRef, {
      tenantId,
      debtId,
      debtorId: debt.debtorId,
      debtorName: debt.debtorName,
      amount: Math.round(amount),
      paidAt: new Date().toISOString(),
      method: method || 'mtn_momo',
      note: `Paiement Mobile Money vérifié (${transactionRef || 'WEB'})`,
      receiptNumber: `MM-${Date.now().toString().slice(-6)}`,
      createdBy: 'system_webhook',
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  res.status(200).json({ ok: true, newStatus, remainingAmount: newRemaining });
});
