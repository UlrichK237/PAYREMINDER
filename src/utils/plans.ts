import type { PlanDefinition, PlanId } from '../types/payreminder';

export const UNLIMITED_QUOTA = 999999;

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Gratuit',
    audience: 'Pour démarrer et tester',
    priceFcfa: 0,
    maxDebtors: 5,
    maxRemindersPerMonth: 30,
    whatsappEnabled: false,
    reportsEnabled: false,
    multiUserEnabled: false,
    highlights: [
      'Jusqu’à 5 débiteurs actifs',
      '30 relances SMS par mois',
      'Reçus de paiement PDF',
      '1 seul utilisateur',
    ],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    audience: 'Pour petits commerces et boutiques',
    priceFcfa: 5000,
    maxDebtors: 50,
    maxRemindersPerMonth: 200,
    whatsappEnabled: false,
    reportsEnabled: false,
    multiUserEnabled: false,
    highlights: [
      'Jusqu’à 50 débiteurs actifs',
      '200 relances SMS par mois',
      'Import CSV / Excel des clients',
      'Liens de paiement Mobile Money',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    audience: 'Pour commerces établis et écoles',
    priceFcfa: 15000,
    maxDebtors: 500,
    maxRemindersPerMonth: 1000,
    whatsappEnabled: true,
    reportsEnabled: true,
    multiUserEnabled: false,
    highlights: [
      'Jusqu’à 500 débiteurs actifs',
      '1 000 relances WhatsApp & SMS / mois',
      'Repli automatique WhatsApp vers SMS',
      'Rapports mensuels PDF & email auto',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    audience: 'Pour réseaux, grossistes et groupes scolaires',
    priceFcfa: 35000,
    maxDebtors: UNLIMITED_QUOTA,
    maxRemindersPerMonth: UNLIMITED_QUOTA,
    whatsappEnabled: true,
    reportsEnabled: true,
    multiUserEnabled: true,
    highlights: [
      'Débiteurs illimités',
      'Relances WhatsApp & SMS illimitées',
      'Multi-utilisateurs (équipe & caissiers)',
      'Support prioritaire & webhooks dédiés',
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'starter', 'pro', 'business'];

export function formatQuotaValue(value: number): string {
  return value >= UNLIMITED_QUOTA ? 'Illimité' : value.toLocaleString('fr-FR').replace(/\s/g, '\u00A0');
}
