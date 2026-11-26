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
  if (
    /(\bpaie\b|\bpayer\b|\bregle\b|\bregler\b|\bverse\b|\bverser\b|\bpromet\b|\bdemain\b|\blundi\b|\bmardi\b|\bmercredi\b|\bjeudi\b|\bvpt\b|\bvendredi\b|\bsamedi\b|\bdimanche\b)/i.test(
      normalized
    )
  ) {
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
