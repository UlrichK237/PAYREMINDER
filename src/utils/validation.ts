import { isValidInternationalPhone, normalizeCameroonPhone } from './formatters';

/**
 * Constantes de validation synchronisées mot pour mot avec firebase-blueprint.json et firestore.rules.
 */
export const SCHEMA_LIMITS = {
  NAME_MAX: 120,
  SECTOR_MAX: 80,
  EMAIL_MAX: 160,
  PHONE_MAX: 20,
  NOTE_MAX: 500,
  DESCRIPTION_MAX: 300,
  TEMPLATE_BODY_MIN: 10,
  TEMPLATE_BODY_MAX: 1000,
  AMOUNT_MAX: 500_000_000,
  PHONE_PATTERN: /^\+[1-9][0-9]{7,15}$/,
  DATE_PATTERN: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
} as const;

export function validateDebtorInput(input: {
  name: string;
  phone: string;
  note: string;
}): { ok: true; normalizedPhone: string } | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name || name.length > SCHEMA_LIMITS.NAME_MAX) {
    return { ok: false, error: `Le nom doit contenir entre 1 et ${SCHEMA_LIMITS.NAME_MAX} caractères.` };
  }
  const normalizedPhone = normalizeCameroonPhone(input.phone.trim());
  if (!isValidInternationalPhone(normalizedPhone) || normalizedPhone.length > SCHEMA_LIMITS.PHONE_MAX) {
    return { ok: false, error: 'Numéro invalide. Utilisez le format international (ex: +237677123456).' };
  }
  if (input.note.trim().length > SCHEMA_LIMITS.NOTE_MAX) {
    return { ok: false, error: `La note ne doit pas dépasser ${SCHEMA_LIMITS.NOTE_MAX} caractères.` };
  }
  return { ok: true, normalizedPhone };
}

export function validateDebtInput(input: {
  debtorId: string;
  initialAmount: number;
  dueDate: string;
  description: string;
}): { ok: true } | { ok: false; error: string } {
  if (!input.debtorId) {
    return { ok: false, error: 'Veuillez sélectionner un client débiteur.' };
  }
  if (!Number.isInteger(input.initialAmount) || input.initialAmount <= 0 || input.initialAmount > SCHEMA_LIMITS.AMOUNT_MAX) {
    return { ok: false, error: 'Le montant doit être un entier positif en FCFA.' };
  }
  if (!SCHEMA_LIMITS.DATE_PATTERN.test(input.dueDate)) {
    return { ok: false, error: 'Date d’échéance invalide.' };
  }
  if (input.description.trim().length > SCHEMA_LIMITS.DESCRIPTION_MAX) {
    return { ok: false, error: `La description ne doit pas dépasser ${SCHEMA_LIMITS.DESCRIPTION_MAX} caractères.` };
  }
  return { ok: true };
}
