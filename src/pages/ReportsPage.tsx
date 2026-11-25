import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { Download, FileText, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { auth } from '../lib/firebase';
import { formatDateFr, formatFcfa, getCurrentDoualaMonth, PAYMENT_METHOD_LABELS } from '../utils/formatters';
import { downloadMonthlyReportPdf } from '../utils/pdfGenerator';
import { PLANS } from '../utils/plans';

export function ReportsPage() {
  const { demoMode } = useAuth();
  const { tenant, debts, payments, messageLogs } = useData();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentDoualaMonth());
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  const reportData = useMemo(() => {
    const monthPayments = payments.filter((p) => p.paidAt.slice(0, 7) === selectedMonth);
    const collectedThisMonth = monthPayments.reduce((acc, p) => acc + p.amount, 0);
    const activeDebts = debts.filter((d) => d.status !== 'annulee');
    const totalDue = activeDebts
      .filter((d) => d.status !== 'payee')
      .reduce((acc, d) => acc + d.remainingAmount, 0);
    const totalInitial = activeDebts.reduce((acc, d) => acc + d.initialAmount, 0);
    const totalRecovered = activeDebts.reduce((acc, d) => acc + (d.initialAmount - d.remainingAmount), 0);
    const recoveryRate = totalInitial > 0 ? (totalRecovered / totalInitial) * 100 : 0;
    const overdueDebts = activeDebts
      .filter((d) => d.status === 'en_retard' && d.remainingAmount > 0)
      .sort((a, b) => b.remainingAmount - a.remainingAmount);
    const remindersSent = messageLogs.filter(
      (l) => l.direction === 'outbound' && l.createdAt.slice(0, 7) === selectedMonth
    ).length;

    const d = new Date(`${selectedMonth}-15T12:00:00Z`);
    const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(d);

    return {
      monthPayments,
      collectedThisMonth,
      totalDue,
      recoveryRate,
      overdueDebts,
      remindersSent,
      monthLabel,
    };
  }, [debts, payments, messageLogs, selectedMonth]);

  if (!tenant) return null;

  const reportsAllowed = PLANS[tenant.plan].reportsEnabled;

  const handleExportCsv = () => {
    const csvRows = reportData.monthPayments.map((p) => ({
      Recu: p.receiptNumber,
      Date: formatDateFr(p.paidAt),
      Client: p.debtorName,
      Montant_FCFA: p.amount,
      Mode: PAYMENT_METHOD_LABELS[p.method],
      Note: p.note,
    }));
    const csv = Papa.unparse(csvRows, { delimiter: ';' });
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport-paiements-${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    downloadMonthlyReportPdf({
      tenant,
      monthLabel: reportData.monthLabel,
      monthKey: selectedMonth,
      totalDue: reportData.totalDue,
      collectedThisMonth: reportData.collectedThisMonth,
      recoveryRate: reportData.recoveryRate,
      overdueCount: reportData.overdueDebts.length,
      remindersSent: reportData.remindersSent,
      payments: reportData.monthPayments,
      overdueDebts: reportData.overdueDebts,
    });
  };

  const handleSendEmailReport = async () => {
    setSendingEmail(true);
    setEmailStatus(null);
    try {
      if (demoMode) {
        setEmailStatus(`Rapport mensuel simulé pour ${tenant.email} (mode démonstration).`);
        return;
      }
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Session expirée. Veuillez vous reconnecter.');

      const resp = await fetch('/api/reports/send-tenant-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenantId: tenant.id,
          monthKey: selectedMonth,
        }),
      });
      const data = (await resp.json()) as { message?: string; error?: string };
      if (!resp.ok) throw new Error(data.error || 'Échec envoi');
      setEmailStatus(data.message || 'Rapport envoyé.');
    } catch (err) {
      setEmailStatus(err instanceof Error ? err.message : 'Erreur lors de l’envoi email.');
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="space-y-6">
      {!reportsAllowed && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <span className="font-semibold">Rapports avancés disponibles à partir du forfait Pro</span>
            <p className="text-xs opacity-85 mt-0.5">
              Passez au forfait Pro pour débloquer l’export PDF mensuel et l’envoi automatique par email le 1er de chaque mois.
            </p>
          </div>
          <Link
            to="/abonnement"
            className="min-h-[40px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center justify-center shrink-0"
          >
            Passer à Pro
          </Link>
        </div>
      )}

      {/* Contrôles Période & Exports */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Période :
          </label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Download className="w-4 h-4" />
            <span>Exporter CSV</span>
          </button>
          <button
            type="button"
            disabled={!reportsAllowed}
            onClick={handleExportPdf}
            className="min-h-[42px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            <span>Exporter PDF</span>
          </button>
          <button
            type="button"
            disabled={!reportsAllowed || sendingEmail}
            onClick={() => void handleSendEmailReport()}
            className="min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Mail className="w-4 h-4" />
            <span>{sendingEmail ? 'Envoi...' : 'Envoyer par email'}</span>
          </button>
        </div>
      </div>

      {emailStatus && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-3.5 rounded-xl">
          {emailStatus}
        </p>
      )}

      {/* Résumé KPIs du mois */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Encaissé ({reportData.monthLabel})</p>
          <p className="text-xl font-bold font-num text-emerald-700 dark:text-emerald-400 mt-1">
            {formatFcfa(reportData.collectedThisMonth)}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Restant dû global</p>
          <p className="text-xl font-bold font-num text-slate-900 dark:text-white mt-1">
            {formatFcfa(reportData.totalDue)}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Taux de récupération</p>
          <p className="text-xl font-bold font-num text-slate-900 dark:text-white mt-1">
            {reportData.recoveryRate.toFixed(1)} %
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Relances envoyées ce mois</p>
          <p className="text-xl font-bold font-num text-slate-900 dark:text-white mt-1">
            {reportData.remindersSent}
          </p>
        </div>
      </div>

      {/* Table des encaissements du mois */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Détail des encaissements ({reportData.monthPayments.length})
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Envoi automatique planifié le 1er de chaque mois à 08h00 (Africa/Douala)
          </span>
        </div>
        {reportData.monthPayments.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Aucun encaissement enregistré pour {reportData.monthLabel}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">N° Reçu</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3 text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {reportData.monthPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-num text-xs text-slate-600 dark:text-slate-400">
                      {p.receiptNumber}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
                      {formatDateFr(p.paidAt)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{p.debtorName}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {PAYMENT_METHOD_LABELS[p.method]}
                    </td>
                    <td className="px-4 py-3 text-right font-num font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatFcfa(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
