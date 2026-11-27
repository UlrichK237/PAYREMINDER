import { useState } from 'react';
import { Check, CreditCard, ExternalLink, Receipt } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { PlanId, PlanStatus } from '../types/payreminder';
import { formatDateFr, formatFcfa } from '../utils/formatters';
import { formatQuotaValue, PLAN_ORDER, PLANS, UNLIMITED_QUOTA } from '../utils/plans';

const PLAN_STATUS_META: Record<PlanStatus, { label: string; badgeClass: string }> = {
  active: {
    label: 'Actif',
    badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  grace: {
    label: 'Période de grâce',
    badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  },
  expired: {
    label: 'Expiré',
    badgeClass: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  },
};

export function BillingPage() {
  const { profile, demoMode } = useAuth();
  const {
    tenant,
    debtors,
    billingHistory,
    capabilities,
    startPlanCheckout,
    simulateSubscriptionPayment,
  } = useData();
  const [upgrading, setUpgrading] = useState<PlanId | null>(null);
  const [simulatingRef, setSimulatingRef] = useState<string | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<{
    planId: PlanId;
    paymentRef: string;
    paymentUrl: string;
    amountFcfa: number;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!tenant) return null;

  const isOwner = demoMode || profile?.role === 'owner';
  const showSimulationButton = !demoMode && capabilities.simulationRoutes;
  const planStatus: PlanStatus = tenant.planStatus || 'active';
  const statusMeta = PLAN_STATUS_META[planStatus];

  const debtorPct =
    tenant.maxDebtors >= UNLIMITED_QUOTA
      ? 10
      : Math.min(100, Math.round((debtors.length / tenant.maxDebtors) * 100));
  const reminderPct =
    tenant.maxRemindersPerMonth >= UNLIMITED_QUOTA
      ? 10
      : Math.min(100, Math.round((tenant.remindersUsedThisMonth / tenant.maxRemindersPerMonth) * 100));

  const openPaymentUrlInNewTab = (url: string) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handleSelectPlan = async (planId: PlanId) => {
    setUpgrading(planId);
    setFeedback(null);
    try {
      const res = await startPlanCheckout(planId);
      if (res.demoUpgraded) {
        setPendingCheckout(null);
        setFeedback(`Votre entreprise utilise désormais le forfait ${PLANS[planId].name}.`);
        return;
      }

      if (res.paymentUrl && res.paymentRef) {
        setPendingCheckout({
          planId,
          paymentRef: res.paymentRef,
          paymentUrl: res.paymentUrl,
          amountFcfa: res.amountFcfa ?? PLANS[planId].priceFcfa,
        });
        openPaymentUrlInNewTab(res.paymentUrl);
        setFeedback(
          `Paiement initié pour ${PLANS[planId].name} (${formatFcfa(
            res.amountFcfa ?? PLANS[planId].priceFcfa
          )}). Le forfait s’activera automatiquement après confirmation du paiement.`
        );
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erreur lors du changement de forfait.');
    } finally {
      setUpgrading(null);
    }
  };

  const handleSimulatePayment = async (paymentRef: string) => {
    setSimulatingRef(paymentRef);
    setFeedback(null);
    try {
      await simulateSubscriptionPayment(paymentRef);
      setPendingCheckout(null);
      setFeedback('Paiement abonnement simulé avec succès : votre nouveau forfait est actif.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erreur lors de la simulation du paiement.');
    } finally {
      setSimulatingRef(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Consommation actuelle */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>Forfait actuel : {PLANS[tenant.plan].name}</span>
              </h2>
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${statusMeta.badgeClass}`}>
                {statusMeta.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Actif depuis le {formatDateFr(tenant.subscriptionDate)} · Cycle {tenant.quotaResetMonth}
              {tenant.planExpiresAt ? ` · Expire le ${formatDateFr(tenant.planExpiresAt)}` : ''}
            </p>
          </div>
          <span className="font-sans text-sm font-bold tabular-nums text-slate-900 dark:text-white">
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

        {pendingCheckout && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4 rounded-xl">
            <div className="space-y-0.5 text-xs">
              <p className="font-semibold text-slate-900 dark:text-white">
                Paiement en attente — {PLANS[pendingCheckout.planId].name} ({formatFcfa(pendingCheckout.amountFcfa)})
              </p>
              <p className="text-slate-500 dark:text-slate-400 font-num">
                Référence : {pendingCheckout.paymentRef}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={pendingCheckout.paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Ouvrir le lien de paiement</span>
              </a>
              {showSimulationButton && (
                <button
                  type="button"
                  disabled={simulatingRef === pendingCheckout.paymentRef}
                  onClick={() => void handleSimulatePayment(pendingCheckout.paymentRef)}
                  className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                >
                  {simulatingRef === pendingCheckout.paymentRef ? 'Simulation...' : 'Simuler le paiement'}
                </button>
              )}
            </div>
          </div>
        )}

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
          const isFreeDisabled = planId === 'free' && !demoMode && !isCurrent;
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
                  <p className="text-xl font-bold font-sans tabular-nums text-emerald-700 dark:text-emerald-400 mt-2">
                    {plan.priceFcfa === 0 ? '0\u00A0FCFA' : `${formatFcfa(plan.priceFcfa)} / mois`}
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
                disabled={isCurrent || !isOwner || upgrading !== null || isFreeDisabled}
                onClick={() => void handleSelectPlan(planId)}
                className={`w-full min-h-[44px] rounded-xl text-xs font-semibold transition-colors ${
                  isCurrent || isFreeDisabled
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 cursor-default'
                    : 'bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50'
                }`}
              >
                {isCurrent
                  ? 'Forfait actuel'
                  : isFreeDisabled
                    ? 'Inclus par défaut'
                    : upgrading === planId
                      ? 'Préparation...'
                      : !isOwner
                        ? 'Réservé au propriétaire'
                        : `Choisir ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Historique des paiements d'abonnement */}
      {isOwner && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>Historique des paiements d’abonnement</span>
          </h3>

          {billingHistory.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Aucun paiement d’abonnement enregistré pour le moment.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {billingHistory.map((item) => (
                <div
                  key={item.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Forfait {PLANS[item.planId]?.name || item.planId} ·{' '}
                      <span className="font-sans font-semibold tabular-nums">{formatFcfa(item.amountFcfa)}</span>
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 font-num">
                      {formatDateFr(item.paidAt || item.createdAt)} · Réf. {item.paymentRef}
                      {item.receiptNumber ? ` · Reçu ${item.receiptNumber}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-1 rounded-lg font-semibold ${
                        item.status === 'paid'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : item.status === 'pending'
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                      }`}
                    >
                      {item.status === 'paid'
                        ? 'Payé'
                        : item.status === 'pending'
                          ? 'En attente'
                          : 'Échoué'}
                    </span>

                    {item.status === 'pending' && item.paymentUrl && (
                      <a
                        href={item.paymentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Payer</span>
                      </a>
                    )}

                    {item.status === 'pending' && showSimulationButton && (
                      <button
                        type="button"
                        disabled={simulatingRef === item.paymentRef}
                        onClick={() => void handleSimulatePayment(item.paymentRef)}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold disabled:opacity-50"
                      >
                        {simulatingRef === item.paymentRef ? 'Simulation...' : 'Simuler le paiement'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
