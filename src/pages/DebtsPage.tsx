import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Download,
  MoreHorizontal,
  Search,
  Wallet,
  XCircle,
} from 'lucide-react';
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

interface DebtOverflowMenuProps {
  debt: Debt;
  isActive: boolean;
  hasPayment: boolean;
  onReceipt: (debt: Debt) => void;
  onCancel: (debt: Debt) => void;
}

function DebtOverflowMenu({
  debt,
  isActive,
  hasPayment,
  onReceipt,
  onCancel,
}: DebtOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number; openUp: boolean }>({
    top: 0,
    right: 16,
    openUp: false,
  });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    const handleScrollOrResize = () => setOpen(false);

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
      firstItem?.focus();
    }
  }, [open]);

  if (!isActive && !hasPayment) {
    return null;
  }

  const toggleMenu = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < 140;
      setCoords({
        top: openUp ? rect.top - 6 : rect.bottom + 6,
        right: Math.max(12, window.innerWidth - rect.right),
        openUp,
      });
    }
    setOpen((prev) => !prev);
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []
    );
    if (items.length === 0) return;
    const currentIndex = items.findIndex((el) => el === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        aria-label={`Autres actions pour ${debt.debtorName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="min-h-[44px] min-w-[44px] md:min-h-[40px] md:min-w-[40px] inline-flex items-center justify-center rounded-xl md:rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={handleMenuKeyDown}
          style={{
            top: coords.openUp ? undefined : coords.top,
            bottom: coords.openUp ? window.innerHeight - coords.top : undefined,
            right: coords.right,
          }}
          className="fixed z-50 w-48 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1.5"
        >
          {hasPayment && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onReceipt(debt);
              }}
              className="w-full min-h-[44px] px-3.5 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 focus:outline-none flex items-center gap-2.5"
            >
              <Download className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
              <span>Reçu PDF</span>
            </button>
          )}
          {isActive && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onCancel(debt);
              }}
              className="w-full min-h-[44px] px-3.5 text-left text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 focus:bg-red-50 dark:focus:bg-red-950/40 focus:outline-none flex items-center gap-2.5"
            >
              <XCircle className="w-4 h-4 shrink-0" />
              <span>Annuler la dette</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function getDebtSortRank(status: DebtStatus): number {
  if (status === 'en_retard') return 0;
  if (status === 'en_cours' || status === 'partiellement_payee') return 1;
  if (status === 'payee') return 2;
  return 3;
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
    const list = debts.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (!q) return true;
      return (
        d.debtorName.toLowerCase().includes(q) ||
        d.debtorPhone.includes(q) ||
        d.description.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      const rankDiff = getDebtSortRank(a.status) - getDebtSortRank(b.status);
      if (rankDiff !== 0) return rankDiff;
      if (a.status === 'en_retard') {
        const overdueDiff = getDaysOverdue(b.dueDate) - getDaysOverdue(a.dueDate);
        if (overdueDiff !== 0) return overdueDiff;
      }
      if (a.status === 'en_cours' || a.status === 'partiellement_payee') {
        return a.dueDate.localeCompare(b.dueDate);
      }
      return b.dueDate.localeCompare(a.dueDate);
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
          <button type="button" onClick={() => setToastMsg(null)} className="underline min-h-[44px] px-2">
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

        {overdueEligible.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDebtsToRemind(overdueEligible)}
              className="w-full md:w-auto min-h-[44px] px-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-amber-100 dark:hover:bg-amber-950/70 whitespace-nowrap"
            >
              <Bell className="w-4 h-4 shrink-0" />
              <span>Relancer tous les retards ({overdueEligible.length})</span>
            </button>
          </div>
        )}
      </div>

      {/* Onglets Statut */}
      <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-w-full">
        {(
          [
            ['all', `Toutes (${debts.length})`],
            ['en_retard', `En retard (${debts.filter((d) => d.status === 'en_retard').length})`],
            ['en_cours', 'En cours'],
            ['partiellement_payee', 'Partielles'],
            ['payee', 'Soldées'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(key)}
            className={`min-h-[38px] px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
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
        <>
          {/* Vue Mobile (< md) : cartes */}
          <div className="md:hidden space-y-3">
            {filtered.map((d) => {
              const daysOverdue = getDaysOverdue(d.dueDate);
              const hasPayment = payments.some((p) => p.debtId === d.id);
              const isActive = d.status !== 'payee' && d.status !== 'annulee';
              const isPaid = d.status === 'payee';
              return (
                <article
                  key={d.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3"
                >
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white whitespace-nowrap overflow-hidden text-ellipsis">
                      {d.debtorName}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {d.description}
                    </p>
                  </div>

                  <div className="flex items-end justify-between gap-3 pt-1">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Restant dû
                      </p>
                      {isPaid ? (
                        <p className="text-lg font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                          Soldée
                        </p>
                      ) : (
                        <p className="text-2xl font-bold font-sans tabular-nums text-slate-900 dark:text-white mt-0.5 whitespace-nowrap">
                          {formatFcfa(d.remainingAmount)}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <DebtStatusLabel status={d.status} daysOverdue={daysOverdue} pill />
                      <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        Échéance {formatDateFr(d.dueDate)}
                      </p>
                    </div>
                  </div>

                  {(isActive || hasPayment) && (
                    <div className="flex items-center gap-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                      {isActive ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setSelectedDebtForPayment(d)}
                            className="flex-1 min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                          >
                            <Wallet className="w-4 h-4 shrink-0" />
                            <span>Encaisser</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDebtsToRemind([d])}
                            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            Relancer
                          </button>
                        </>
                      ) : (
                        <div className="flex-1" />
                      )}
                      <DebtOverflowMenu
                        debt={d}
                        isActive={isActive}
                        hasPayment={hasPayment}
                        onReceipt={handleDownloadLatestReceipt}
                        onCancel={setDebtToCancel}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Vue Tablette & Desktop (>= md) : tableau */}
          <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 min-w-[240px]">Client & Motif</th>
                    <th className="px-4 py-3 whitespace-nowrap">Échéance</th>
                    <th className="px-4 py-3 whitespace-nowrap">Statut</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">Initial</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">Restant dû</th>
                    <th className="px-4 py-3 text-right w-[252px] whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((d) => {
                    const daysOverdue = getDaysOverdue(d.dueDate);
                    const hasPayment = payments.some((p) => p.debtId === d.id);
                    const isActive = d.status !== 'payee' && d.status !== 'annulee';
                    const isPaid = d.status === 'payee';
                    return (
                      <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3.5 min-w-[240px] max-w-[320px]">
                          <p className="font-medium text-slate-900 dark:text-white whitespace-nowrap">
                            {d.debtorName}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[280px]">
                            {d.description} · {d.reminderCount} relance(s)
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-xs whitespace-nowrap text-slate-700 dark:text-slate-300">
                          {formatDateFr(d.dueDate)}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <DebtStatusLabel status={d.status} daysOverdue={daysOverdue} pill />
                        </td>
                        <td className="px-4 py-3.5 text-right font-sans tabular-nums text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formatFcfa(d.initialAmount)}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          {isPaid ? (
                            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                              Soldée
                            </span>
                          ) : (
                            <span className="font-sans font-bold tabular-nums text-slate-900 dark:text-white">
                              {formatFcfa(d.remainingAmount)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap w-[252px]">
                          <div className="inline-flex items-center justify-end gap-1.5 w-[228px]">
                            {isActive && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setSelectedDebtForPayment(d)}
                                  className="min-h-[40px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                                >
                                  <Wallet className="w-3.5 h-3.5 shrink-0" />
                                  <span>Encaisser</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDebtsToRemind([d])}
                                  className="min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                                >
                                  Relancer
                                </button>
                              </>
                            )}
                            <DebtOverflowMenu
                              debt={d}
                              isActive={isActive}
                              hasPayment={hasPayment}
                              onReceipt={handleDownloadLatestReceipt}
                              onCancel={setDebtToCancel}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
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
