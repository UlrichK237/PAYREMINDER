import type { Debt, DebtStatus, PaymentMethod, Tone } from '../types/payreminder';

export const DOUALA_TIMEZONE = 'Africa/Douala';

/**
 * Formate un montant en FCFA (XAF) avec espace insécable comme séparateur de milliers et zéro décimale.
 * Exemple : 15000 -> "15 000 FCFA"
 */
export function formatFcfa(amount: number): string {
  const safe = Math.round(Number.isFinite(amount) ? amount : 0);
  const absFormatted = Math.abs(safe)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${safe < 0 ? '-' : ''}${absFormatted}\u00A0FCFA`;
}

/**
 * Formate un pourcentage (valeur 0..100) en français avec virgule et espace insécable avant %.
 * Exemple : 23 -> "23,0 %", 87.46 -> "87,5 %"
 */
export function formatPercent(value: number, digits = 1): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safe / 100);
}

/**
 * Retourne la date du jour au format YYYY-MM-DD dans le fuseau Africa/Douala.
 */
export function getTodayDoualaDate(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DOUALA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

/**
 * Retourne le mois courant au format YYYY-MM dans le fuseau Africa/Douala.
 */
export function getCurrentDoualaMonth(now = new Date()): string {
  return getTodayDoualaDate(now).slice(0, 7);
}

/**
 * Retourne l'heure courante (0-23) dans le fuseau Africa/Douala.
 */
export function getCurrentDoualaHour(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: DOUALA_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '12';
  return parseInt(hourPart, 10) % 24;
}

/**
 * Formate une date ISO ou YYYY-MM-DD en français lisible (ex: "24 nov. 2026").
 */
export function formatDateFr(dateStr: string): string {
  if (!dateStr) return '—';
  const normalized = dateStr.length === 10 ? `${dateStr}T12:00:00Z` : dateStr;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: DOUALA_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/**
 * Formate une date + heure complète dans Africa/Douala.
 */
export function formatDateTimeFr(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: DOUALA_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/**
 * Calcule le nombre de jours de retard par rapport à aujourd'hui (Africa/Douala).
 * Positif = en retard de N jours. Négatif = échéance dans N jours.
 */
export function getDaysOverdue(dueDate: string, referenceDate = getTodayDoualaDate()): number {
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const ref = new Date(`${referenceDate}T00:00:00Z`).getTime();
  if (Number.isNaN(due) || Number.isNaN(ref)) return 0;
  return Math.floor((ref - due) / (1000 * 60 * 60 * 24));
}

/**
 * Calcule le statut effectif d'une dette selon le montant restant et la date d'échéance.
 */
export function computeDebtStatus(
  debt: Pick<Debt, 'initialAmount' | 'remainingAmount' | 'dueDate' | 'status'>,
  referenceDate = getTodayDoualaDate()
): DebtStatus {
  if (debt.status === 'annulee') return 'annulee';
  if (debt.remainingAmount <= 0) return 'payee';
  const daysOverdue = getDaysOverdue(debt.dueDate, referenceDate);
  if (daysOverdue > 0) return 'en_retard';
  if (debt.remainingAmount < debt.initialAmount) return 'partiellement_payee';
  return 'en_cours';
}

/**
 * Normalise un numéro de téléphone camerounais vers le format E.164 (+237XXXXXXXXX) si possible.
 */
export function normalizeCameroonPhone(input: string): string {
  const cleaned = input.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('00237')) {
    return `+${cleaned.slice(2)}`;
  }
  if (cleaned.startsWith('237') && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  if (/^[62][0-9]{8}$/.test(cleaned)) {
    return `+237${cleaned}`;
  }
  return cleaned;
}

/**
 * Valide un numéro international (+237... au Cameroun ou format E.164 valide).
 */
export function isValidInternationalPhone(phone: string): boolean {
  return /^\+[1-9][0-9]{7,15}$/.test(phone);
}

/**
 * Valide spécifiquement un numéro camerounais (+237 + 9 chiffres commençant par 6 ou 2).
 */
export function isValidCameroonPhone(phone: string): boolean {
  return /^\+237[26][0-9]{8}$/.test(phone);
}

/**
 * Interpole les variables d'un modèle de relance.
 */
export function renderTemplateMessage(
  templateBody: string,
  vars: {
    nom: string;
    montant_restant: number;
    echeance: string;
    entreprise: string;
    lien_paiement?: string;
  }
): string {
  let msg = templateBody
    .replace(/\{nom\}/g, vars.nom)
    .replace(/\{montant_restant\}/g, formatFcfa(vars.montant_restant))
    .replace(/\{echeance\}/g, formatDateFr(vars.echeance))
    .replace(/\{entreprise\}/g, vars.entreprise);

  if (vars.lien_paiement && !msg.includes(vars.lien_paiement)) {
    msg += ` Régler par Mobile Money : ${vars.lien_paiement}`;
  }
  return msg;
}

/**
 * Détermine automatiquement le ton de relance selon le retard (escalade automatique).
 */
export function pickEscalatedTone(daysOverdue: number, autoEscalate: boolean): Tone {
  if (!autoEscalate || daysOverdue <= 2) return 'amical';
  if (daysOverdue <= 10) return 'ferme';
  return 'dernier_avis';
}

export const DEBT_STATUS_LABELS: Record<DebtStatus, string> = {
  en_cours: 'En cours',
  partiellement_payee: 'Partiellement payée',
  payee: 'Soldée',
  en_retard: 'En retard',
  annulee: 'Annulée',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  especes: 'Espèces',
  mtn_momo: 'MTN MoMo',
  orange_money: 'Orange Money',
  autre: 'Autre',
};

export const TONE_LABELS: Record<Tone, string> = {
  amical: 'Amical',
  ferme: 'Ferme',
  dernier_avis: 'Dernier avis',
};
