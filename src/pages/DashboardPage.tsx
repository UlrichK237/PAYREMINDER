import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Database,
  GraduationCap,
  Percent,
  Store,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { DebtStatusLabel } from '../components/StatusText';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import {
  formatDateFr,
  formatFcfa,
  formatPercent,
  getCurrentDoualaMonth,
  getDaysOverdue,
  getTodayDoualaDate,
} from '../utils/formatters';

export function DashboardPage({ onOpenNewDebt }: { onOpenNewDebt: () => void }) {
  const { demoMode } = useAuth();
  const { tenant, debts, payments, debtors, loadDemoDataset } = useData();
  const [loadingDemo, setLoadingDemo] = useState<'pagnes' | 'ecole' | null>(null);
  const [demoFeedback, setDemoFeedback] = useState<string | null>(null);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);

  const currentMonth = getCurrentDoualaMonth();
  const today = getTodayDoualaDate();

  const metrics = useMemo(() => {
    const activeDebts = debts.filter((d) => d.status !== 'annulee');
    const totalDue = activeDebts
      .filter((d) => d.status !== 'payee')
      .reduce((acc, d) => acc + d.remainingAmount, 0);

    const collectedThisMonth = payments
      .filter((p) => p.paidAt.slice(0, 7) === currentMonth)
      .reduce((acc, p) => acc + p.amount, 0);

    const totalInitial = activeDebts.reduce((acc, d) => acc + d.initialAmount, 0);
    const totalCollectedAllTime = activeDebts.reduce(
      (acc, d) => acc + (d.initialAmount - d.remainingAmount),
      0
    );
    const recoveryRate = totalInitial > 0 ? (totalCollectedAllTime / totalInitial) * 100 : 0;

    // Retards par ancienneté : 0-7, 8-30, 30+ jours
    const aging = {
      b0_7: { count: 0, amount: 0 },
      b8_30: { count: 0, amount: 0 },
      b30_plus: { count: 0, amount: 0 },
    };
    for (const d of activeDebts) {
      if (d.status !== 'en_retard' || d.remainingAmount <= 0) continue;
      const days = getDaysOverdue(d.dueDate, today);
      if (days <= 7) {
        aging.b0_7.count += 1;
        aging.b0_7.amount += d.remainingAmount;
      } else if (days <= 30) {
        aging.b8_30.count += 1;
        aging.b8_30.amount += d.remainingAmount;
      } else {
        aging.b30_plus.count += 1;
        aging.b30_plus.amount += d.remainingAmount;
      }
    }

    // Top 5 plus gros impayés
    const topUnpaid = [...activeDebts]
      .filter((d) => d.remainingAmount > 0)
      .sort((a, b) => b.remainingAmount - a.remainingAmount)
      .slice(0, 5);

    // Prochaines échéances (à venir dans les 14 prochains jours)
    const upcoming = [...activeDebts]
      .filter((d) => d.remainingAmount > 0 && d.dueDate >= today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5);

    // Évolution mensuelle (6 derniers mois)
    const months: Array<{ key: string; label: string; collected: number; issued: number }> = [];
    const base = new Date(`${today}T12:00:00Z`);
    for (let i = 5; i >= 0; i--) {
      const mDate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
      const key = mDate.toISOString().slice(0, 7);
      const label = new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(mDate);
      const collected = payments
        .filter((p) => p.paidAt.slice(0, 7) === key)
        .reduce((acc, p) => acc + p.amount, 0);
      const issued = activeDebts
        .filter((d) => d.issuedAt.slice(0, 7) === key)
        .reduce((acc, d) => acc + d.initialAmount, 0);
      months.push({ key, label, collected, issued });
    }

    return {
      totalDue,
      collectedThisMonth,
      recoveryRate,
      aging,
      topUnpaid,
      upcoming,
      months,
    };
  }, [debts, payments, currentMonth, today]);

  const maxChartVal = Math.max(
    1,
    ...metrics.months.map((m) => Math.max(m.collected, m.issued))
  );

  const handleLoadDemo = async (key: 'pagnes' | 'ecole') => {
    setLoadingDemo(key);
    setDemoFeedback(null);
    try {
      await loadDemoDataset(key);
      setDemoFeedback(
        key === 'pagnes'
          ? 'Jeu de données « Vendeuse de pagnes (12 clientes) » chargé.'
          : 'Jeu de données « École (30 élèves) » chargé.'
      );
    } catch (err) {
      setDemoFeedback(err instanceof Error ? err.message : 'Erreur lors du chargement.');
    } finally {
      setLoadingDemo(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPIs Principaux */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="col-span-2 lg:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total restant dû</p>
            <Wallet className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          </div>
          <p className="text-3xl lg:text-2xl font-bold font-sans tabular-nums text-slate-900 dark:text-white">
            {formatFcfa(metrics.totalDue)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sur {debts.filter((d) => d.remainingAmount > 0 && d.status !== 'annulee').length} créance(s) active(s)
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Récupéré ce mois</p>
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-bold font-sans tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatFcfa(metrics.collectedThisMonth)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {payments.filter((p) => p.paidAt.slice(0, 7) === currentMonth).length} encaissement(s)
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Taux de récupération</p>
            <Percent className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-bold font-sans tabular-nums text-slate-900 dark:text-white">
            {formatPercent(metrics.recoveryRate)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Global sur portefeuille suivi
          </p>
        </div>

        <div className="col-span-2 lg:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Retards critiques (+30 j)</p>
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          </div>
          <p className="text-2xl font-bold font-sans tabular-nums text-red-700 dark:text-red-400">
            {formatFcfa(metrics.aging.b30_plus.amount)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {metrics.aging.b30_plus.count} dossier(s) à traiter
          </p>
        </div>
      </section>

      {/* Bandeau Démo / Jeu de données compact et fermable */}
      {(debtors.length === 0 || demoMode) && !demoBannerDismissed && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">
                <Database className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span>
                  {demoMode ? 'Jeux de données de démonstration' : 'Démarrer rapidement avec un exemple réel'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {tenant?.name} · Boutique de pagnes (12) ou École (30)
              </p>
              {demoFeedback && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">{demoFeedback}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDemoBannerDismissed(true)}
              aria-label="Fermer le bandeau de démonstration"
              className="lg:hidden min-h-[44px] min-w-[44px] -mr-1 -mt-1 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={loadingDemo !== null}
              onClick={() => void handleLoadDemo('pagnes')}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Store className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>{loadingDemo === 'pagnes' ? 'Chargement...' : 'Vendeuse de pagnes (12)'}</span>
            </button>
            <button
              type="button"
              disabled={loadingDemo !== null}
              onClick={() => void handleLoadDemo('ecole')}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <GraduationCap className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span>{loadingDemo === 'ecole' ? 'Chargement...' : 'École scolarité (30)'}</span>
            </button>
            <button
              type="button"
              onClick={() => setDemoBannerDismissed(true)}
              aria-label="Fermer le bandeau de démonstration"
              className="hidden lg:flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Graphique Évolution + Retards par ancienneté */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>Évolution mensuelle (6 mois)</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Créances émises vs montants encaissés (FCFA)
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 dark:bg-slate-700" />
                Émis
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" />
                Encaissé
              </span>
            </div>
          </div>

          <div className="h-52 flex items-end justify-between gap-2 sm:gap-4 pt-4">
            {metrics.months.map((m) => {
              const hIssued = Math.max(4, Math.round((m.issued / maxChartVal) * 100));
              const hCollected = Math.max(4, Math.round((m.collected / maxChartVal) * 100));
              return (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                  <div className="w-full flex items-end justify-center gap-1.5 h-40">
                    <div
                      title={`Émis : ${formatFcfa(m.issued)}`}
                      style={{ height: `${hIssued}%` }}
                      className="w-3 sm:w-4 rounded-t-md bg-slate-200 dark:bg-slate-700 transition-all"
                    />
                    <div
                      title={`Encaissé : ${formatFcfa(m.collected)}`}
                      style={{ height: `${hCollected}%` }}
                      className="w-3 sm:w-4 rounded-t-md bg-emerald-600 dark:bg-emerald-500 transition-all"
                    />
                  </div>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 capitalize">
                    {m.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Retards par ancienneté */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Retards par ancienneté
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Répartition des créances échues non soldées
            </p>
          </div>

          <div className="space-y-4">
            {[
              {
                label: '0 à 7 jours de retard',
                count: metrics.aging.b0_7.count,
                amount: metrics.aging.b0_7.amount,
                barClass: 'bg-amber-500',
              },
              {
                label: '8 à 30 jours de retard',
                count: metrics.aging.b8_30.count,
                amount: metrics.aging.b8_30.amount,
                barClass: 'bg-orange-600',
              },
              {
                label: 'Plus de 30 jours de retard',
                count: metrics.aging.b30_plus.count,
                amount: metrics.aging.b30_plus.amount,
                barClass: 'bg-red-600',
              },
            ].map((bucket) => {
              const totalOverdueAmt =
                metrics.aging.b0_7.amount + metrics.aging.b8_30.amount + metrics.aging.b30_plus.amount;
              const pct = totalOverdueAmt > 0 ? Math.round((bucket.amount / totalOverdueAmt) * 100) : 0;
              return (
                <div key={bucket.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {bucket.label} ({bucket.count})
                    </span>
                    <span className="font-sans font-semibold tabular-nums text-slate-900 dark:text-white">
                      {formatFcfa(bucket.amount)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div style={{ width: `${pct}%` }} className={`h-full rounded-full ${bucket.barClass}`} />
                  </div>
                </div>
              );
            })}
          </div>

          <Link
            to="/dettes"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline pt-1"
          >
            <span>Traiter les dossiers en retard</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

      {/* Top 5 Impayés & Prochaines Échéances */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Top 5 des plus gros impayés
            </h2>
            <Link to="/dettes" className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline">
              Tout voir
            </Link>
          </div>

          {metrics.topUnpaid.length === 0 ? (
            <div className="py-6 text-center space-y-2">
              <p className="text-sm text-slate-500 dark:text-slate-400">Aucun impayé actif.</p>
              <button
                type="button"
                onClick={onOpenNewDebt}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 underline"
              >
                Ajouter une créance
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {metrics.topUnpaid.map((d) => (
                <div key={d.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{d.debtorName}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      <span>Échéance {formatDateFr(d.dueDate)}</span>
                      <span>·</span>
                      <DebtStatusLabel status={d.status} />
                    </div>
                  </div>
                  <span className="font-sans text-sm font-semibold tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                    {formatFcfa(d.remainingAmount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-slate-500" />
              <span>Prochaines échéances</span>
            </h2>
            <Link to="/dettes" className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline">
              Gérer
            </Link>
          </div>

          {metrics.upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Aucune échéance à venir prochainement.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {metrics.upcoming.map((d) => (
                <div key={d.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{d.debtorName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Prévu le {formatDateFr(d.dueDate)} · {d.description}
                    </p>
                  </div>
                  <span className="font-sans text-sm font-semibold tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                    {formatFcfa(d.remainingAmount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
