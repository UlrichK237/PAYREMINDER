import type { Channel } from '../types/payreminder';

export const ALLOWED_TEMPLATE_VARIABLES = new Set([
  'nom',
  'montant_restant',
  'echeance',
  'entreprise',
  'lien_paiement',
]);

export const FORBIDDEN_INTIMIDATION_WORDS = [
  'police',
  'gendarmerie',
  'prison',
  'arreter',
  'tribunal',
  'huissier',
  'menace',
  'menacer',
];

export interface TemplateValidationResult {
  ok: boolean;
  error?: string;
}

function stripAccentsLower(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Valide le corps d'un modèle de relance (partagé front et serveur) :
 * - Longueur max : 480 car. (SMS), 1 000 car. (WhatsApp)
 * - Aucune URL autre que {lien_paiement}
 * - Aucun mot d'intimidation (insensible à la casse et aux accents)
 * - Uniquement les variables autorisées
 */
export function validateTemplateBody(body: string, channel: Channel): TemplateValidationResult {
  if (typeof body !== 'string' || body.trim().length < 10) {
    return {
      ok: false,
      error: 'Le modèle de message doit contenir au moins 10 caractères.',
    };
  }

  const maxLength = channel === 'sms' ? 480 : 1000;
  if (body.length > maxLength) {
    return {
      ok: false,
      error: `Modèle trop long : maximum ${maxLength} caractères pour ${channel === 'sms' ? 'un SMS' : 'WhatsApp'}.`,
    };
  }

  // Vérification des variables {foo}
  const variableMatches = body.matchAll(/\{([^{}]+)\}/g);
  for (const match of variableMatches) {
    const varName = match[1].trim();
    if (!ALLOWED_TEMPLATE_VARIABLES.has(varName)) {
      return {
        ok: false,
        error: `Variable non autorisée : {${varName}}. Variables autorisées : {nom}, {montant_restant}, {echeance}, {entreprise}, {lien_paiement}.`,
      };
    }
  }

  // Interdiction de toute URL autre que {lien_paiement}
  const bodyWithoutPaymentPlaceholder = body.replace(/\{lien_paiement\}/g, ' ');
  const hasSchemeUrl = /\b(?:https?:\/\/|ftp:\/\/|www\.)\S+/i.test(bodyWithoutPaymentPlaceholder);
  const hasDomainUrl =
    /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|cm|net|org|fr|io|co|biz|info|xyz|me|app|link|ly|gl|gg|tk|ml|ga|cf)\b(?:\/\S*)?/i.test(
      bodyWithoutPaymentPlaceholder
    );
  if (hasSchemeUrl || hasDomainUrl) {
    return {
      ok: false,
      error: 'Aucune URL externe n’est autorisée dans un modèle. Utilisez uniquement la variable {lien_paiement}.',
    };
  }

  // Interdiction des mots d'intimidation (insensible à la casse et aux accents)
  const normalized = stripAccentsLower(body);
  for (const word of FORBIDDEN_INTIMIDATION_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(normalized)) {
      return {
        ok: false,
        error: `Terme d’intimidation interdit dans le modèle (« ${word} »). Gardez un ton professionnel et respectueux.`,
      };
    }
  }

  return { ok: true };
}
