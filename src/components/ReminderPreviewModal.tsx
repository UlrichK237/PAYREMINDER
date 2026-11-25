import { useState } from 'react';
import { Send, X } from 'lucide-react';
import { useData } from '../context/DataContext';
import type { Debt } from '../types/payreminder';
import {
  getDaysOverdue,
  pickEscalatedTone,
  renderTemplateMessage,
  TONE_LABELS,
} from '../utils/formatters';
import { PLANS } from '../utils/plans';

interface ReminderPreviewModalProps {
  debtsToRemind: Debt[];
  onClose: () => void;
  onSuccess: (summary: string) => void;
}

export function ReminderPreviewModal({
  debtsToRemind,
  onClose,
  onSuccess,
}: ReminderPreviewModalProps) {
  const { tenant, debtors, messageTemplates, capabilities, sendReminderNow, sendBulkOverdueReminders } = useData();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (debtsToRemind.length === 0 || !tenant) return null;

  const isBulk = debtsToRemind.length > 1;
  const whatsappAllowed = PLANS[tenant.plan].whatsappEnabled;

  const previews = debtsToRemind.slice(0, 5).map((debt) => {
    const debtor = debtors.find((d) => d.id === debt.debtorId);
    const days = getDaysOverdue(debt.dueDate);
    const tone = pickEscalatedTone(days, tenant.autoEscalate);
    const channel = whatsappAllowed ? debtor?.preferredChannel || 'sms' : 'sms';
    const tpl =
      messageTemplates.find((t) => t.tone === tone && t.channel === channel) ||
      messageTemplates[0];
    const message = renderTemplateMessage(tpl?.body || '', {
      nom: debt.debtorName,
      montant_restant: debt.remainingAmount,
      echeance: debt.dueDate,
      entreprise: tenant.name,
    });
    return {
      debt,
      optOut: Boolean(debtor?.optOut),
      channel,
      tone,
      message,
    };
  });

  const handleConfirmSend = async () => {
    setError(null);
    setSending(true);
    try {
      if (!isBulk) {
        const res = await sendReminderNow(debtsToRemind[0].id);
        onSuccess(
          `Relance ${res.channel.toUpperCase()} (${res.status}) envoyée à ${debtsToRemind[0].debtorName}${
            res.usedFallback ? ' via repli SMS' : ''
          }.`
        );
      } else {
        const res = await sendBulkOverdueReminders(debtsToRemind.map((d) => d.id));
        onSuccess(`${res.sent} relance(s) envoyée(s), ${res.skipped} ignorée(s) (opt-out ou quota).`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’envoi.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              {isBulk
                ? `Aperçu avant relance (${debtsToRemind.length} retards)`
                : `Relancer ${debtsToRemind[0].debtorName}`}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {capabilities.simulationMode
                ? 'Mode simulation actif : les envois seront tracés dans le journal avec le statut « simulé ».'
                : 'Envoi réel via fournisseur configuré (avec lien Mobile Money inclus).'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {previews.map((p) => (
            <div
              key={p.debt.id}
              className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {p.debt.debtorName} · {p.debt.debtorPhone}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {p.optOut ? 'Opt-out (ignoré)' : `${p.channel.toUpperCase()} · ${TONE_LABELS[p.tone]}`}
                </span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {p.message}
              </p>
            </div>
          ))}
          {debtsToRemind.length > 5 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
              … et {debtsToRemind.length - 5} autre(s) message(s) personnalisé(s).
            </p>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-3 rounded-xl">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void handleConfirmSend()}
            disabled={sending}
            className="min-h-[44px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Send className="w-4 h-4" />
            <span>{sending ? 'Envoi en cours...' : 'Confirmer et envoyer'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
