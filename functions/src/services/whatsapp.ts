/**
 * Intégration Meta WhatsApp Cloud API via templates pré-approuvés
 * + analyseur d'intention sur réponses entrantes (STOP/ARRET et promesses de paiement).
 */
export interface WhatsAppSendResult {
  success: boolean;
  simulated: boolean;
  providerMessageId: string;
  status: 'simule' | 'envoyee' | 'echouee';
  errorMessage?: string;
}

export interface InboundIntentAnalysis {
  intent: 'opt_out' | 'promise' | 'none';
  promiseDate?: string;
}

/**
 * Détecte les mots-clés d'opposition ("STOP", "ARRET", "ARRÊT") ou une promesse de paiement en français.
 */
export function analyzeInboundMessage(text: string, referenceNow = new Date()): InboundIntentAnalysis {
  const normalized = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Détection opt-out strict (STOP / ARRET / DESINSCRIPTION)
  if (/(\bstop\b|\barret\b|\bdesinscrire\b|\bne me contactez plus\b)/i.test(normalized)) {
    return { intent: 'opt_out' };
  }

  // Détection promesse de paiement ("je paie vendredi", "je regle demain", etc.)
  if (/(\bpaie\b|\bpayer\b|\bregle\b|\bregler\b|\bverse\b|\bverser\b|\bpromet\b|\bdemain\b|\blundi\b|\bmardi\b|\bmercredi\b|\bjeudi\b|\bvpt\b|\bvendredi\b|\bsamedi\b|\bdimanche\b)/i.test(normalized)) {
    const promised = estimatePromisedDate(normalized, referenceNow);
    return { intent: 'promise', promiseDate: promised };
  }

  return { intent: 'none' };
}

function estimatePromisedDate(normalizedText: string, ref: Date): string {
  const d = new Date(ref.getTime());
  if (normalizedText.includes('demain')) {
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const weekdays: Record<string, number> = {
    dimanche: 0,
    lundi: 1,
    mardi: 2,
    mercredi: 3,
    jeudi: 4,
    vendredi: 5,
    samedi: 6,
  };
  for (const [dayName, targetDow] of Object.entries(weekdays)) {
    if (normalizedText.includes(dayName)) {
      const currentDow = d.getUTCDay();
      let diff = (targetDow - currentDow + 7) % 7;
      if (diff === 0) diff = 7;
      d.setUTCDate(d.getUTCDate() + diff);
      return d.toISOString().slice(0, 10);
    }
  }
  // Défaut: +3 jours si aucune date précise trouvée
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

export async function sendWhatsAppTemplateMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  variables: string[];
  fallbackBody: string;
}): Promise<WhatsAppSendResult> {
  if (!params.accessToken || !params.phoneNumberId) {
    return {
      success: true,
      simulated: true,
      providerMessageId: `sim_wa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      status: 'simule',
    };
  }

  try {
    const cleanPhone = params.to.replace(/[^0-9]/g, '');
    const url = `https://graph.facebook.com/v21.0/${params.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
          name: params.templateName,
          language: { code: 'fr' },
          components: [
            {
              type: 'body',
              parameters: params.variables.map((v) => ({ type: 'text', text: v })),
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false,
        simulated: false,
        providerMessageId: `err_wa_${Date.now()}`,
        status: 'echouee',
        errorMessage: `Meta API ${response.status}: ${errText.slice(0, 180)}`,
      };
    }

    const data = (await response.json()) as { messages?: { id: string }[] };
    return {
      success: true,
      simulated: false,
      providerMessageId: data.messages?.[0]?.id || `wa_${Date.now()}`,
      status: 'envoyee',
    };
  } catch (error) {
    return {
      success: false,
      simulated: false,
      providerMessageId: `err_wa_${Date.now()}`,
      status: 'echouee',
      errorMessage: error instanceof Error ? error.message : 'Erreur réseau WhatsApp',
    };
  }
}
