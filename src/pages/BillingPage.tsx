import { useState } from 'react';
import { Check, CreditCard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { PlanId } from '../types/payreminder';
import { formatDateFr, formatFcfa } from '../utils/formatters';
import { formatQuotaValue, PLAN_ORDER, PLANS, UNLIMITED_QUOTA } from '../utils/plans';

export function BillingPage() {
  const { profile, demoMode } = useAuth();
  const { tenant, debtors, upgradePlan } = useData();
  const [upgrading, setUpgrading] = useState<PlanId | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!tenant) return null;

  const isOwner = demoMode || profile?.role === 'owner';
  const debtorPct =
    tenant.maxDebtors >= UNLIMITED_QUOTA
      ? 10
      : Math.min(100, Math.round((debtors.length / tenant.maxDebtors) * 100));
  const reminderPct =
    tenant.maxRemindersPerMonth >= UNLIMITED_QUOTA
      ? 10
      : Math.min(100, Math.round((tenant.remindersUsedThisMonth / tenant.maxRemindersPerMonth) * 100));

  const handleSelectPlan = async (planId: PlanId) => {
    setUpgrading(planId);
    setFeedback(null);
    try {
      await upgradePlan(planId);
      setFeedback(`Votre entreprise utilise désormais le forfait ${PLANS[planId].name}.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erreur lors du changement de forfait.');
    } finally {
      setUpgrading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Consommation actuelle */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Forfait actuel : {PLANS[tenant.plan].name}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Actif depuis le {formatDateFr(tenant.subscriptionDate)} · Cycle {tenant.quotaResetMonth}
            </p>
          </div>
          <span className="font-num text-sm font-bold text-slate-900 dark:text-white">
            {PLANS[tenant.plan].priceFcfa === 0
              ? 'Gratuit'
              : `${formatFcfa(PLANS[tenant.plan].priceFcfa)} / mois`}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">Débiteurs enregistrés</span>
              <span className="font-num font-semibold text-slate-900 dark:text-white">
                {debtors.length} / {formatQuotaValue(tenant.maxDebtors)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                style={{ width: `${debtorPct}%` }}
                className={`h-full rounded-full ${debtorPct >= 90 ? 'bg-red-600' : 'bg-emerald-600'}`}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">Relances ce mois-ci</span>
              <span className="font-num font-semibold text-slate-900 dark:text-white">
                {tenant.remindersUsedThisMonth} / {formatQuotaValue(tenant.maxRemindersPerMonth)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                style={{ width: `${reminderPct}%` }}
                className={`h-full rounded-full ${reminderPct >= 90 ? 'bg-red-600' : 'bg-emerald-600'}`}
              />
            </div>
          </div>
        </div>

        {feedback && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-xl">
            {feedback}
          </p>
        )}
      </div>

      {/* Grille des 4 forfaits */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const isCurrent = tenant.plan === planId;
          return (
            <div
              key={planId}
              className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 flex flex-col justify-between space-y-5 ${
                isCurrent
                  ? 'border-emerald-700 dark:border-emerald-500'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{plan.audience}</p>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    {plan.name}
                  </h3>
                  <p className="text-xl font-bold font-num text-emerald-700 dark:text-emerald-400 mt-2">
                    {plan.priceFcfa === 0 ? '0 FCFA' : `${formatFcfa(plan.priceFcfa)} / mois`}
                  </p>
                </div>

                <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                  {plan.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                disabled={isCurrent || !isOwner || upgrading !== null}
                onClick={() => void handleSelectPlan(planId)}
                className={`w-full min-h-[44px] rounded-xl text-xs font-semibold transition-colors ${
                  isCurrent
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 cursor-default'
                    : 'bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50'
                }`}
              >
                {isCurrent
                  ? 'Forfait actuel'
                  : upgrading === planId
                    ? 'Activation...'
                    : !isOwner
                      ? 'Réservé au propriétaire'
                      : `Choisir ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
