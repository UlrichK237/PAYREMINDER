import { AlertCircle, CheckCircle2, Clock, Slash, CircleDot } from 'lucide-react';
import type { DebtStatus, MessageLogStatus } from '../types/payreminder';
import { DEBT_STATUS_LABELS } from '../utils/formatters';

export function DebtStatusLabel({ status }: { status: DebtStatus }) {
  switch (status) {
    case 'payee':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{DEBT_STATUS_LABELS[status]}</span>
        </span>
      );
    case 'en_retard':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{DEBT_STATUS_LABELS[status]}</span>
        </span>
      );
    case 'partiellement_payee':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <CircleDot className="w-3.5 h-3.5 shrink-0" />
          <span>{DEBT_STATUS_LABELS[status]}</span>
        </span>
      );
    case 'annulee':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          <Slash className="w-3.5 h-3.5 shrink-0" />
          <span>{DEBT_STATUS_LABELS[status]}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
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
