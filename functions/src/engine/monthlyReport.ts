import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { loadSecretsConfig } from '../config/env';

/**
 * Envoi automatique du rapport mensuel par email le 1er de chaque mois à 08h00 (Africa/Douala).
 */
export const scheduledMonthlyReport = onSchedule(
  {
    schedule: '0 8 1 * *',
    timeZone: 'Africa/Douala',
    region: 'europe-west1',
  },
  async () => {
    const db = getFirestore();
    const secrets = loadSecretsConfig();
    const tenantsSnap = await db.collection('tenants').get();

    for (const tenantDoc of tenantsSnap.docs) {
      const tenant = tenantDoc.data();
      if (tenant.plan !== 'pro' && tenant.plan !== 'business') continue;

      const [debtsSnap, paymentsSnap] = await Promise.all([
        tenantDoc.ref.collection('debts').get(),
        tenantDoc.ref.collection('payments').get(),
      ]);

      const totalDue = debtsSnap.docs.reduce((acc, d) => acc + Number(d.data().remainingAmount || 0), 0);
      const totalCollected = paymentsSnap.docs.reduce((acc, p) => acc + Number(p.data().amount || 0), 0);

      if (!secrets.emailProviderApiKey) {
        console.info(`[SIMULATION EMAIL] Rapport mensuel pour ${tenant.email} : dû=${totalDue}, encaissé=${totalCollected}`);
        continue;
      }

      // Exemple compatible Resend API
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secrets.emailProviderApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: secrets.emailFromAddress,
          to: [tenant.email],
          subject: `PayReminder — Rapport mensuel (${tenant.name})`,
          html: `<h2>Rapport mensuel ${tenant.name}</h2><p>Total restant dû : ${totalDue} FCFA</p><p>Total encaissé : ${totalCollected} FCFA</p>`,
        }),
      });
    }
  }
);
