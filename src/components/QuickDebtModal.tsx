import React, { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { useData } from '../context/DataContext';
import { getTodayDoualaDate } from '../utils/formatters';

interface QuickDebtModalProps {
  open: boolean;
  onClose: () => void;
}

export function QuickDebtModal({ open, onClose }: QuickDebtModalProps) {
  const { debtors, createDebtor, createDebt } = useData();
  const [debtorId, setDebtorId] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('+2376');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(`${getTodayDoualaDate()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const effectiveDebtorId = debtorId || debtors[0]?.id || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedAmount = parseInt(amount.replace(/\s+/g, ''), 10);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Entrez un montant valide en FCFA.');
      return;
    }

    const needsNewClient = creatingClient || debtors.length === 0;
    if (needsNewClient && !consentConfirmed) {
      setError('Veuillez confirmer avoir le droit de contacter cette personne au sujet de cette créance.');
      return;
    }

    setSubmitting(true);
    try {
      let targetDebtorId = effectiveDebtorId;
      if (needsNewClient) {
        targetDebtorId = await createDebtor({
          name: newName,
          phone: newPhone,
          preferredChannel: 'whatsapp',
          note: '',
          consentConfirmed,
        });
      }
      await createDebt({
        debtorId: targetDebtorId,
        initialAmount: parsedAmount,
        dueDate,
        description: description || 'Créance client',
      });
      setAmount('');
      setDescription('');
      setNewName('');
      setNewPhone('+2376');
      setConsentConfirmed(false);
      setCreatingClient(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Enregistrer une dette rapide
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!creatingClient && debtors.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  1. Client débiteur
                </label>
                <button
                  type="button"
                  onClick={() => setCreatingClient(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Nouveau client
                </button>
              </div>
              <select
                value={effectiveDebtorId}
                onChange={(e) => setDebtorId(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              >
                {debtors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.phone})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  1. Nouveau client
                </span>
                {debtors.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCreatingClient(false)}
                    className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Choisir un client existant
                  </button>
                )}
              </div>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nom du client (ex: Marie Ngo)"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
              <input
                type="tel"
                required
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+237677123456"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-num"
              />
              <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  required
                  checked={consentConfirmed}
                  onChange={(e) => setConsentConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>Je confirme avoir le droit de contacter cette personne au sujet de cette créance</span>
              </label>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              2. Montant (FCFA)
            </label>
            <input
              type="number"
              required
              min={100}
              step={50}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ex: 15000"
              className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-base font-sans font-semibold tabular-nums"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              3. Date d’échéance
            </label>
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Motif (facultatif)
            </label>
            <input
              type="text"
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: 2 pagnes Wax / Tranche scolarité"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-3 rounded-xl">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {submitting ? 'Enregistrement...' : 'Enregistrer la dette'}
          </button>
        </form>
      </div>
    </div>
  );
}
