import React, { useState } from 'react';
import { CheckCircle2, Download, Link2, Smartphone, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { Debt, Payment, PaymentMethod } from '../types/payreminder';
import { formatFcfa, PAYMENT_METHOD_LABELS } from '../utils/formatters';
import { downloadPaymentReceiptPdf } from '../utils/pdfGenerator';

interface PaymentModalProps {
  debt: Debt | null;
  onClose: () => void;
}

export function PaymentModal({ debt, onClose }: PaymentModalProps) {
  const { demoMode } = useAuth();
  const { tenant, capabilities, recordPayment, generatePaymentLink, simulatePaymentWebhook } = useData();
  const showSimulation = demoMode || capabilities.simulationRoutes;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('mtn_momo');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPayment, setSavedPayment] = useState<Payment | null>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  if (!debt) return null;

  const effectiveAmountStr = amount === '' ? String(debt.remainingAmount) : amount;

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseInt(effectiveAmountStr.replace(/\s+/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Montant invalide.');
      return;
    }
    setSaving(true);
    try {
      const payment = await recordPayment({
        debtId: debt.id,
        amount: parsed,
        method,
        note,
      });
      setSavedPayment(payment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du paiement.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateMoMoLink = async () => {
    setError(null);
    try {
      const url = await generatePaymentLink(debt);
      setGeneratedLink(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer le lien.');
    }
  };

  const handleSimulateMoMoWebhook = async () => {
    setError(null);
    setSaving(true);
    try {
      await simulatePaymentWebhook({
        debtId: debt.id,
        amount: debt.remainingAmount,
        method: method === 'orange_money' ? 'orange_money' : 'mtn_momo',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec simulation webhook.');
    } finally {
      setSaving(false);
    }
  };

  const resetAndClose = () => {
    setAmount('');
    setNote('');
    setSavedPayment(null);
    setGeneratedLink(null);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Encaisser un paiement
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {debt.debtorName} · Solde dû : <span className="font-num font-semibold">{formatFcfa(debt.remainingAmount)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {savedPayment && tenant ? (
          <div className="space-y-4 py-2 text-center">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900 dark:text-white">
                Paiement de {formatFcfa(savedPayment.amount)} enregistré
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Reçu N° {savedPayment.receiptNumber} · {PAYMENT_METHOD_LABELS[savedPayment.method]}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                downloadPaymentReceiptPdf({
                  tenant,
                  payment: savedPayment,
                  debt: {
                    ...debt,
                    remainingAmount: Math.max(0, debt.remainingAmount - savedPayment.amount),
                  },
                })
              }
              className="w-full min-h-[46px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Télécharger le reçu PDF
            </button>
            <button
              type="button"
              onClick={resetAndClose}
              className="w-full min-h-[42px] text-sm text-slate-600 dark:text-slate-400"
            >
              Terminer
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSavePayment} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Montant reçu (FCFA)
                  </label>
                  <button
                    type="button"
                    onClick={() => setAmount(String(Math.round(debt.remainingAmount / 2)))}
                    className="text-xs text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                  >
                    Moitié ({formatFcfa(Math.round(debt.remainingAmount / 2))})
                  </button>
                </div>
                <input
                  type="number"
                  required
                  min={1}
                  max={debt.remainingAmount}
                  value={effectiveAmountStr}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-base font-num font-semibold"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Mode de règlement
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['mtn_momo', 'orange_money', 'especes', 'autre'] as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`min-h-[42px] px-3 rounded-xl border text-xs font-medium transition-colors ${
                        method === m
                          ? 'border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Note (facultatif)
                </label>
                <input
                  type="text"
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex: Référence transaction MoMo"
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
                disabled={saving}
                className="w-full min-h-[48px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
              >
                {saving ? 'Enregistrement...' : 'Valider le paiement'}
              </button>
            </form>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Encaissement à distance Mobile Money
              </p>
              <div className={`grid grid-cols-1 ${showSimulation ? 'sm:grid-cols-2' : ''} gap-2`}>
                <button
                  type="button"
                  onClick={() => void handleCreateMoMoLink()}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Générer un lien MoMo
                </button>
                {showSimulation && (
                  <button
                    type="button"
                    onClick={() => void handleSimulateMoMoWebhook()}
                    disabled={saving}
                    className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    Simuler webhook payé
                  </button>
                )}
              </div>
              {generatedLink && (
                <p className="text-[11px] font-num break-all bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg text-slate-600 dark:text-slate-300">
                  {generatedLink}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
