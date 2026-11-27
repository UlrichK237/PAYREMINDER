import { AlertCircle, CheckCircle2, Clock, Slash, CircleDot } from 'lucide-react';
import type { DebtStatus, MessageLogStatus } from '../types/payreminder';
import { DEBT_STATUS_LABELS } from '../utils/formatters';

export function DebtStatusLabel({
  status,
  daysOverdue,
  pill = false,
}: {
  status: DebtStatus;
  daysOverdue?: number;
  pill?: boolean;
}) {
  const baseClass = pill
    ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap'
    : 'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap';

  switch (status) {
    case 'payee':
      return (
        <span
          className={`${baseClass} ${
            pill
              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-900/60'
              : 'text-emerald-700 dark:text-emerald-400'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{DEBT_STATUS_LABELS[status]}</span>
        </span>
      );
    case 'en_retard': {
      const label =
        daysOverdue && daysOverdue > 0
          ? `${DEBT_STATUS_LABELS[status]} · ${daysOverdue}\u00A0j`
          : DEBT_STATUS_LABELS[status];
      return (
        <span
          className={`${baseClass} ${
            pill
              ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200/80 dark:border-red-900/60'
              : 'text-red-700 dark:text-red-400'
          }`}
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{label}</span>
        </span>
      );
    }
    case 'partiellement_payee':
      return (
        <span
          className={`${baseClass} ${
            pill
              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200/80 dark:border-amber-900/60'
              : 'text-amber-700 dark:text-amber-400'
          }`}
        >
          <CircleDot className="w-3.5 h-3.5 shrink-0" />
          <span>{DEBT_STATUS_LABELS[status]}</span>
        </span>
      );
    case 'annulee':
      return (
        <span
          className={`${baseClass} ${
            pill
              ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Slash className="w-3.5 h-3.5 shrink-0" />
          <span>{DEBT_STATUS_LABELS[status]}</span>
        </span>
      );
    default:
      return (
        <span
          className={`${baseClass} ${
            pill
              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200/80 dark:border-blue-900/60'
              : 'text-blue-700 dark:text-blue-400'
          }`}
        >
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>{DEBT_STATUS_LABELS[status]}</span>
        </span>
      );
  }
}

const LOG_STATUS_LABELS: Record<MessageLogStatus, string> = {
  simule: 'Simulé',
  envoyee: 'Envoyée',
  delivree: 'Délivrée',
  lue: 'Lue',
  echouee: 'Échouée',
  recue: 'Réponse reçue',
};

export function LogStatusLabel({ status }: { status: MessageLogStatus }) {
  const colorClass =
    status === 'lue' || status === 'delivree'
      ? 'text-emerald-700 dark:text-emerald-400'
      : status === 'echouee'
        ? 'text-red-700 dark:text-red-400'
        : status === 'recue'
          ? 'text-blue-700 dark:text-blue-400'
          : 'text-slate-600 dark:text-slate-400';

  return <span className={`text-xs font-medium ${colorClass}`}>{LOG_STATUS_LABELS[status]}</span>;
}
