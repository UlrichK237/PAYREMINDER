import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createSmsProvider } from './functions/src/services/sms';
import { analyzeInboundMessage, sendWhatsAppTemplateMessage } from './functions/src/services/whatsapp';
import { createPaymentProvider } from './functions/src/services/payment';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getServerSecrets() {
  return {
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'payreminder_verify_token',
    smsProviderUrl: process.env.SMS_PROVIDER_URL || '',
    smsApiKey: process.env.SMS_API_KEY || '',
    smsSenderId: process.env.SMS_SENDER_ID || 'PayReminder',
    paymentProviderUrl: process.env.PAYMENT_PROVIDER_URL || '',
    paymentApiKey: process.env.PAYMENT_API_KEY || '',
    paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    emailProviderApiKey: process.env.EMAIL_PROVIDER_API_KEY || '',
    emailFromAddress: process.env.EMAIL_FROM_ADDRESS || 'rapports@payreminder.cm',
    appBaseUrl: process.env.APP_URL || 'http://localhost:3000',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // 1. Capacités serveur (sans jamais exposer les clés API)
  app.get('/api/config/capabilities', (_req, res) => {
    const secrets = getServerSecrets();
    const whatsappConfigured = Boolean(secrets.whatsappAccessToken && secrets.whatsappPhoneNumberId);
    const smsConfigured = Boolean(secrets.smsProviderUrl && secrets.smsApiKey);
    const paymentConfigured = Boolean(secrets.paymentProviderUrl && secrets.paymentApiKey);
    const emailConfigured = Boolean(secrets.emailProviderApiKey);

    res.json({
      whatsappConfigured,
      smsConfigured,
      paymentConfigured,
      emailConfigured,
      simulationMode: !whatsappConfigured && !smsConfigured,
      timezone: 'Africa/Douala',
    });
  });

  // 2. Envoi d'une relance (WhatsApp Cloud API ou SMS avec repli automatique)
  app.post('/api/reminders/dispatch', async (req, res) => {
    try {
      const {
        tenantId,
        debtId,
        debtorName,
        debtorPhone,
        channel,
        tone,
        messageBody,
        metaTemplateName,
        templateVariables,
        fallbackToSms = true,
        remainingAmount,
        tenantPlan,
      } = req.body as {
        tenantId?: string;
        debtId?: string;
        debtorName?: string;
        debtorPhone?: string;
        channel?: 'whatsapp' | 'sms';
        tone?: string;
        messageBody?: string;
        metaTemplateName?: string;
        templateVariables?: string[];
        fallbackToSms?: boolean;
        remainingAmount?: number;
        tenantPlan?: string;
      };

      if (!tenantId || !debtorPhone || !messageBody || !channel) {
        res.status(400).json({ error: 'Paramètres de relance incomplets.' });
        return;
      }

      if (typeof debtorPhone !== 'string' || !/^\+[1-9][0-9]{7,15}$/.test(debtorPhone)) {
        res.status(400).json({ error: 'Numéro de téléphone invalide (+237...).' });
        return;
      }

      // Contrôle côté serveur : WhatsApp réservé aux plans Pro et Business
      let effectiveChannel: 'whatsapp' | 'sms' = channel;
      if (effectiveChannel === 'whatsapp' && tenantPlan !== 'pro' && tenantPlan !== 'business') {
        effectiveChannel = 'sms';
      }

      const secrets = getServerSecrets();
      const smsProvider = createSmsProvider(secrets);
      const paymentProvider = createPaymentProvider(secrets);

      let paymentUrl = '';
      if (debtId && remainingAmount && remainingAmount > 0) {
        const linkRes = await paymentProvider.createPaymentLink({
          tenantId,
          debtId,
          amountFcfa: remainingAmount,
          customerPhone: debtorPhone,
          customerName: debtorName || 'Client',
          description: 'Règlement créance',
        });
        paymentUrl = linkRes.paymentUrl;
      }

      const finalBody = paymentUrl && !messageBody.includes(paymentUrl)
        ? `${messageBody} Paiement Mobile Money : ${paymentUrl}`
        : messageBody;

      let result: {
        success: boolean;
        simulated: boolean;
        providerMessageId: string;
        status: 'simule' | 'envoyee' | 'echouee';
        errorMessage?: string;
      };
      let usedFallback = false;

      if (effectiveChannel === 'whatsapp') {
        result = await sendWhatsAppTemplateMessage({
          accessToken: secrets.whatsappAccessToken,
          phoneNumberId: secrets.whatsappPhoneNumberId,
          to: debtorPhone,
          templateName: metaTemplateName || `payreminder_${tone || 'amical'}_fr`,
          variables: templateVariables || [debtorName || 'Client', `${remainingAmount || 0} FCFA`],
          fallbackBody: finalBody,
        });

        if (!result.success && fallbackToSms) {
          usedFallback = true;
          effectiveChannel = 'sms';
          result = await smsProvider.sendSms({
            to: debtorPhone,
            message: finalBody,
          });
        }
      } else {
        result = await smsProvider.sendSms({
          to: debtorPhone,
          message: finalBody,
        });
      }

      res.json({
        ok: result.success,
        channel: effectiveChannel,
        usedFallback,
        status: result.status,
        simulated: result.simulated,
        providerMessageId: result.providerMessageId,
        paymentUrl,
        renderedContent: finalBody,
        errorMessage: result.errorMessage,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Erreur serveur lors de la relance',
      });
    }
  });

  // 3. Génération d'un lien de paiement Mobile Money
  app.post('/api/payments/create-link', async (req, res) => {
    const { tenantId, debtId, amountFcfa, customerPhone, customerName, description } = req.body as {
      tenantId?: string;
      debtId?: string;
      amountFcfa?: number;
      customerPhone?: string;
      customerName?: string;
      description?: string;
    };

    if (!tenantId || !debtId || !amountFcfa || amountFcfa <= 0) {
      res.status(400).json({ error: 'Paramètres de lien de paiement invalides.' });
      return;
    }

    const secrets = getServerSecrets();
    const provider = createPaymentProvider(secrets);
    const link = await provider.createPaymentLink({
      tenantId,
      debtId,
      amountFcfa,
      customerPhone: customerPhone || '+237600000000',
      customerName: customerName || 'Client',
      description: description || 'Règlement créance',
    });
    res.json(link);
  });

  // 4. Webhook WhatsApp (GET vérification Meta + POST analyse STOP / promesse)
  app.get('/api/webhooks/whatsapp', (req, res) => {
    const secrets = getServerSecrets();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === secrets.whatsappWebhookVerifyToken) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Jeton de vérification invalide');
  });

  app.post('/api/webhooks/whatsapp', (req, res) => {
    const { messageText, fromPhone } = req.body as { messageText?: string; fromPhone?: string };
    if (!messageText) {
      res.status(400).json({ error: 'messageText requis' });
      return;
    }
    const analysis = analyzeInboundMessage(messageText);
    res.json({
      ok: true,
      fromPhone: fromPhone || '',
      intent: analysis.intent,
      promiseDate: analysis.promiseDate || null,
    });
  });

  // 5. Webhook Paiement Mobile Money
  app.post('/api/webhooks/payment', (req, res) => {
    const { debtId, amount, method, transactionRef } = req.body as {
      debtId?: string;
      amount?: number;
      method?: 'mtn_momo' | 'orange_money';
      transactionRef?: string;
    };
    if (!debtId || !amount || amount <= 0) {
      res.status(400).json({ error: 'Payload webhook paiement invalide' });
      return;
    }
    res.json({
      ok: true,
      verified: true,
      debtId,
      amount: Math.round(amount),
      method: method || 'mtn_momo',
      transactionRef: transactionRef || `MOMO-${Date.now().toString().slice(-6)}`,
    });
  });

  // 6. Envoi manuel / test du rapport mensuel par email
  app.post('/api/reports/send-monthly', async (req, res) => {
    const { toEmail, tenantName, monthLabel, totalDue, collectedThisMonth, recoveryRate } = req.body as {
      toEmail?: string;
      tenantName?: string;
      monthLabel?: string;
      totalDue?: number;
      collectedThisMonth?: number;
      recoveryRate?: number;
    };
    if (!toEmail || !tenantName) {
      res.status(400).json({ error: 'Email et nom de l’entreprise requis.' });
      return;
    }

    const secrets = getServerSecrets();
    if (!secrets.emailProviderApiKey) {
      res.json({
        ok: true,
        simulated: true,
        message: `Rapport mensuel simulé pour ${toEmail} (aucune clé EMAIL_PROVIDER_API_KEY configurée).`,
      });
      return;
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.emailProviderApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: secrets.emailFromAddress,
        to: [toEmail],
        subject: `PayReminder — Rapport ${monthLabel || ''} (${tenantName})`,
        html: `<h2>Rapport mensuel ${tenantName}</h2><p>Restant dû : ${totalDue ?? 0} FCFA</p><p>Encaissé ce mois : ${collectedThisMonth ?? 0} FCFA</p><p>Taux de récupération : ${recoveryRate ?? 0}%</p>`,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      res.status(502).json({ error: `Échec envoi email: ${err.slice(0, 160)}` });
      return;
    }

    res.json({
      ok: true,
      simulated: false,
      message: `Rapport mensuel envoyé à ${toEmail}.`,
    });
  });

  // Vite dev middleware vs static production serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build introuvable. Exécutez npm run build.');
      }
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.info(`PayReminder server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
