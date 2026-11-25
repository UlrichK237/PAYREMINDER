import type { MessageTemplate, ReminderRule } from '../types/payreminder';

export const DEFAULT_TEMPLATES: Omit<MessageTemplate, 'id' | 'tenantId' | 'updatedAt'>[] = [
  {
    tone: 'amical',
    channel: 'whatsapp',
    body: 'Bonjour {nom}, petit rappel de {entreprise} : il reste {montant_restant} à régler, échéance le {echeance}. Merci de votre confiance.',
    metaTemplateName: 'payreminder_amical_fr',
  },
  {
    tone: 'ferme',
    channel: 'whatsapp',
    body: 'Bonjour {nom}, votre solde de {montant_restant} chez {entreprise} est en retard depuis le {echeance}. Merci de régulariser rapidement.',
    metaTemplateName: 'payreminder_ferme_fr',
  },
  {
    tone: 'dernier_avis',
    channel: 'whatsapp',
    body: "Bonjour {nom}, dernier rappel de {entreprise} concernant {montant_restant} impayés. Contactez-nous aujourd'hui pour convenir d'un règlement.",
    metaTemplateName: 'payreminder_dernier_avis_fr',
  },
  {
    tone: 'amical',
    channel: 'sms',
    body: 'Bonjour {nom}, petit rappel de {entreprise} : il reste {montant_restant} à régler, échéance le {echeance}. Merci de votre confiance.',
  },
  {
    tone: 'ferme',
    channel: 'sms',
    body: 'Bonjour {nom}, votre solde de {montant_restant} chez {entreprise} est en retard depuis le {echeance}. Merci de régulariser rapidement.',
  },
  {
    tone: 'dernier_avis',
    channel: 'sms',
    body: "Bonjour {nom}, dernier rappel de {entreprise} concernant {montant_restant} impayés. Contactez-nous aujourd'hui pour convenir d'un règlement.",
  },
];

export const DEFAULT_REMINDER_RULES: Omit<ReminderRule, 'id' | 'tenantId' | 'updatedAt'>[] = [
  {
    offsetDays: -3,
    label: 'J-3 · Rappel préventif',
    channel: 'whatsapp',
    tone: 'amical',
    allowedStartHour: 8,
    allowedEndHour: 19,
    maxReminders: 5,
    enabled: true,
  },
  {
    offsetDays: 0,
    label: 'J0 · Jour d’échéance',
    channel: 'whatsapp',
    tone: 'amical',
    allowedStartHour: 8,
    allowedEndHour: 19,
    maxReminders: 5,
    enabled: true,
  },
  {
    offsetDays: 3,
    label: 'J+3 · Premier retard',
    channel: 'whatsapp',
    tone: 'ferme',
    allowedStartHour: 8,
    allowedEndHour: 19,
    maxReminders: 5,
    enabled: true,
  },
  {
    offsetDays: 7,
    label: 'J+7 · Relance SMS',
    channel: 'sms',
    tone: 'ferme',
    allowedStartHour: 8,
    allowedEndHour: 19,
    maxReminders: 5,
    enabled: true,
  },
  {
    offsetDays: 15,
    label: 'J+15 · Dernier avis',
    channel: 'sms',
    tone: 'dernier_avis',
    allowedStartHour: 8,
    allowedEndHour: 19,
    maxReminders: 5,
    enabled: true,
  },
];
