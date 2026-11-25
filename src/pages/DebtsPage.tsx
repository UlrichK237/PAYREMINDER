import { useMemo, useState } from 'react';
import { Bell, CheckCircle2, Download, Plus, Search, Wallet } from 'lucide-react';
import { ConfirmModal } from '../components/ConfirmModal';
import { PaymentModal } from '../components/PaymentModal';
import { ReminderPreviewModal } from '../components/ReminderPreviewModal';
import { DebtStatusLabel } from '../components/StatusText';
import { useData } from '../context/DataContext';
import type { Debt, DebtStatus } from '../types/payreminder';
import { formatDateFr, formatFcfa, getDaysOverdue } from '../utils/formatters';
import { downloadPaymentReceiptPdf } from '../utils/pdfGenerator';

interface DebtsPageProps {
  onOpenNewDebt: () => void;
}

export function DebtsPage({ onOpenNewDebt }: DebtsPageProps) {
  const { tenant, debts, payments, debtors, cancelDebt } = useData();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DebtStatus>('all');
  const [selectedDebtForPayment, setSelectedDebtForPayment] = useState<Debt | null>(null);
  const [debtsToRemind, setDebtsToRemind] = useState<Debt[]>([]);
  const [debtToCancel, setDebtToCancel] = useState<Debt | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const overdueEligible = useMemo(() => {
    const optOutIds = new Set(debtors.filter((d) => d.optOut).map((d) => d.id));
    return debts.filter(
      (d) =>
        d.status === 'en_retard' &&
        d.remainingAmount > 0 &&
        !optOutIds.has(d.debtorId)
    );
  }, [debts, debtors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return debts.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!q) return true;
      return (
        d.debtorName.toLowerCase().includes(q) ||
        d.debtorPhone.includes(q) ||
        d.description.toLowerCase().includes(q)
      );
    });
  }, [debts, search, statusFilter]);

  const handleDownloadLatestReceipt = (debt: Debt) => {
    if (!tenant) return;
    const latestPay = payments.find((p) => p.debtId === debt.id);
    if (!latestPay) return;
    downloadPaymentReceiptPdf({ tenant, payment: latestPay, debt });
  };

  return (
    <div className="space-y-6">
      {toastMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {toastMsg}
          </span>
          <button type="button" onClick={() => setToastMsg(null)} className="underline">
            Fermer
          </button>
        </div>
      )}

      {/* Actions principales */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un client, motif, téléphone..."
            className="w-full min-h-[44px] pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {overdueEligible.length > 0 && (
            <button
              type="button"
              onClick={() => setDebtsToRemind(overdueEligible)}
              className="min-h-[44px] px-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-sm font-semibold inline-flex items-center gap-2 hover:bg-amber-100 dark:hover:bg-amber-950/70 whitespace-nowrap"
            >
              <Bell className="w-4 h-4" />
              <span>Relancer tous les retards ({overdueEligible.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenNewDebt}
            className="min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Nouvelle dette</span>
          </button>
        </div>
      </div>

      {/* Onglets Statut */}
      <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-w-full">
        {(
          [
            ['all', `Toutes (${debts.length})`],
            ['en_retard', `En retard (${debts.filter((d) => d.status === 'en_retard').length})`],
            ['en_cours', 'En cours'],
            ['partiellement_payee', 'Partielles'],
            ['payee', 'Payées'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(key)}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              statusFilter === key
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Liste / Tableau */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <p className="text-base font-semibold text-slate-900 dark:text-white">
            Aucune dette dans cette catégorie
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Créez une nouvelle créance en moins de 10 secondes.
          </p>
          <button
            type="button"
            onClick={onOpenNewDebt}
            className="min-h-[44px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold"
          >
            Nouvelle dette
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Client & Motif</th>
                  <th className="px-4 py-3">Échéance</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Initial</th>
                  <th className="px-4 py-3 text-right">Restant dû</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((d) => {
                  const daysOverdue = getDaysOverdue(d.dueDate);
                  const hasPayment = payments.some((p) => p.debtId === d.id);
                  const isActive = d.status !== 'payee' && d.status !== 'annulee';
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3.5">
                        <p className="font-medium text-slate-900 dark:text-white">{d.debtorName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {d.description} · {d.reminderCount} relance(s)
                        </p>
                      </td>
                      <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                        <p className="text-slate-800 dark:text-slate-200">{formatDateFr(d.dueDate)}</p>
                        {isActive && daysOverdue > 0 && (
                          <p className="text-red-600 dark:text-red-400 font-num">+{daysOverdue} j de retard</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <DebtStatusLabel status={d.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right font-num text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatFcfa(d.initialAmount)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-num font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatFcfa(d.remainingAmount)}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {isActive && (
                            <>
                              <button
                                type="button"
                                onClick={() => setSelectedDebtForPayment(d)}
                                className="min-h-[36px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-1"
                              >
                                <Wallet className="w-3.5 h-3.5" />
                                <span>Encaisser</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setDebtsToRemind([d])}
                                className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                Relancer maintenant
                              </button>
                              <button
                                type="button"
                                onClick={() => setDebtToCancel(d)}
                                className="min-h-[36px] px-2.5 rounded-lg text-xs text-slate-500 hover:text-red-600"
                              >
                                Annuler
                              </button>
                            </>
                          )}
                          {hasPayment && (
                            <button
                              type="button"
                              onClick={() => handleDownloadLatestReceipt(d)}
                              title="Télécharger le dernier reçu PDF"
                              className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 inline-flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Reçu</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PaymentModal debt={selectedDebtForPayment} onClose={() => setSelectedDebtForPayment(null)} />

      <ReminderPreviewModal
        debtsToRemind={debtsToRemind}
        onClose={() => setDebtsToRemind([])}
        onSuccess={(msg) => setToastMsg(msg)}
      />

      <ConfirmModal
        open={Boolean(debtToCancel)}
        title="Annuler cette dette ?"
        description={`Voulez-vous vraiment annuler la créance de ${debtToCancel?.debtorName} (${
          debtToCancel ? formatFcfa(debtToCancel.remainingAmount) : ''
        }) ? Les relances automatiques s'arrêteront immédiatement.`}
        confirmLabel="Oui, annuler la dette"
        danger
        onCancel={() => setDebtToCancel(null)}
        onConfirm={async () => {
          if (debtToCancel) {
            await cancelDebt(debtToCancel.id);
            setDebtToCancel(null);
            setToastMsg('Dette annulée.');
          }
        }}
      />
    </div>
  );
}
