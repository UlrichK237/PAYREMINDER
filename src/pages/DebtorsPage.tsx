import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, CheckCircle2, Edit3, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { ImportDebtorsModal } from '../components/ImportDebtorsModal';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { Channel, Debtor } from '../types/payreminder';
import { formatDateFr, formatFcfa, formatPercent } from '../utils/formatters';
import { formatQuotaValue, PLANS } from '../utils/plans';

export function DebtorsPage() {
  const { profile, demoMode } = useAuth();
  const { tenant, debtors, debts, createDebtor, updateDebtor, eraseDebtorData } = useData();
  const isOwner = demoMode || profile?.role === 'owner';
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'sms' | 'optout'>('all');
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Debtor | null>(null);
  const [erasingTarget, setErasingTarget] = useState<Debtor | null>(null);
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+2376');
  const [preferredChannel, setPreferredChannel] = useState<Channel>('whatsapp');
  const [note, setNote] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const debtTotalsByDebtor = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of debts) {
      if (d.status !== 'payee' && d.status !== 'annulee') {
        map.set(d.debtorId, (map.get(d.debtorId) || 0) + d.remainingAmount);
      }
    }
    return map;
  }, [debts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return debtors.filter((d) => {
      if (channelFilter === 'whatsapp' && d.preferredChannel !== 'whatsapp') return false;
      if (channelFilter === 'sms' && d.preferredChannel !== 'sms') return false;
      if (channelFilter === 'optout' && !d.optOut) return false;
      if (!q) return true;
      return d.name.toLowerCase().includes(q) || d.phone.toLowerCase().includes(q);
    });
  }, [debtors, search, channelFilter]);

  const quotaReached = tenant ? debtors.length >= tenant.maxDebtors : false;
  const nearQuota = tenant ? debtors.length >= tenant.maxDebtors * 0.8 && !quotaReached : false;

  const openCreateModal = () => {
    setEditing(null);
    setName('');
    setPhone('+2376');
    setPreferredChannel(tenant && PLANS[tenant.plan].whatsappEnabled ? 'whatsapp' : 'sms');
    setNote('');
    setConsentConfirmed(false);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (d: Debtor) => {
    setEditing(d);
    setName(d.name);
    setPhone(d.phone);
    setPreferredChannel(d.preferredChannel);
    setNote(d.note);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!editing && !consentConfirmed) {
      setFormError('Confirmez avoir le droit de contacter cette personne au sujet de cette créance.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateDebtor(editing.id, { name, phone, preferredChannel, note });
      } else {
        await createDebtor({ name, phone, preferredChannel, note, consentConfirmed });
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur de sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmErase = async () => {
    if (!erasingTarget) return;
    setEraseError(null);
    setErasing(true);
    try {
      await eraseDebtorData(erasingTarget.id);
      setErasingTarget(null);
    } catch (err) {
      setEraseError(err instanceof Error ? err.message : 'Erreur lors de l’effacement.');
    } finally {
      setErasing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alerte Quota Progressif */}
      {(quotaReached || nearQuota) && tenant && (
        <div
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            quotaReached
              ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-900 dark:text-red-200'
              : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="text-sm">
            <span className="font-semibold">
              {quotaReached ? 'Limite de débiteurs atteinte' : 'Quota de débiteurs bientôt atteint'}
            </span>
            <span className="mx-2">·</span>
            <span className="font-num">
              {debtors.length} / {formatQuotaValue(tenant.maxDebtors)}
            </span>
            <span className="block text-xs opacity-85 mt-0.5">
              Passez au forfait supérieur pour ajouter davantage de clients sans interruption.
            </span>
          </div>
          <Link
            to="/abonnement"
            className="min-h-[40px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center justify-center whitespace-nowrap shrink-0"
          >
            Voir les forfaits
          </Link>
        </div>
      )}

      {/* Toolbar Actions & Recherche */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom ou +237..."
            className="w-full min-h-[44px] pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            <span>Importer CSV / Excel</span>
          </button>
          <button
            type="button"
            disabled={quotaReached}
            onClick={openCreateModal}
            className="min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Nouveau client</span>
          </button>
        </div>
      </div>

      {/* Filtres segmentés */}
      <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-w-full">
        {(
          [
            ['all', `Tous (${debtors.length})`],
            ['whatsapp', 'WhatsApp'],
            ['sms', 'SMS'],
            ['optout', 'Opt-out (STOP)'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setChannelFilter(key)}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              channelFilter === key
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Liste / Table */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <p className="text-base font-semibold text-slate-900 dark:text-white">
            Aucun débiteur trouvé
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Ajoutez votre premier client manuellement ou importez votre liste depuis un fichier Excel ou CSV.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[44px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold"
          >
            Ajouter un client
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Téléphone</th>
                  <th className="px-4 py-3">Canal / Statut</th>
                  <th className="px-4 py-3 text-right">Fiabilité</th>
                  <th className="px-4 py-3 text-right">Solde dû</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((d) => {
                  const totalOwed = debtTotalsByDebtor.get(d.id) || 0;
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3.5">
                        <p className="font-medium text-slate-900 dark:text-white">{d.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                          {d.note || 'Aucune note'}
                          {d.promiseDate ? ` · Promesse le ${formatDateFr(d.promiseDate)}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 font-num text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {d.phone}
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        {d.optOut ? (
                          <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 font-medium">
                            <Ban className="w-3.5 h-3.5" />
                            Opt-out actif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {d.preferredChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-sans tabular-nums text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatPercent(d.reliabilityScore, 0)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-sans font-semibold tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                        {formatFcfa(totalOwed)}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void updateDebtor(d.id, { optOut: !d.optOut })}
                            className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {d.optOut ? 'Réactiver' : 'STOP'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(d)}
                            aria-label={`Modifier ${d.name}`}
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => {
                                setEraseError(null);
                                setErasingTarget(d);
                              }}
                              aria-label={`Effacer les données de ${d.name}`}
                              title="Effacer les données (RGPD)"
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

      {/* Modal Ajout / Édition Débiteur */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {editing ? 'Modifier le débiteur' : 'Nouveau débiteur'}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                aria-label="Fermer"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Nom complet
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Chantal Fotso"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Téléphone (+237...)
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+237677123456"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-num"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Canal préféré
                </label>
                <select
                  value={preferredChannel}
                  onChange={(e) => setPreferredChannel(e.target.value as Channel)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="whatsapp">WhatsApp (Plans Pro / Business)</option>
                  <option value="sms">SMS</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Note interne
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex: Marché Mboppi · Paie généralement le vendredi"
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              {!editing && (
                <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={consentConfirmed}
                    onChange={(e) => setConsentConfirmed(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span>Je confirme avoir le droit de contacter cette personne au sujet de cette créance</span>
                </label>
              )}
              {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal confirmation effacement RGPD (Owner-only) */}
      {erasingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Effacer les données du débiteur
              </h2>
              <button
                type="button"
                onClick={() => setErasingTarget(null)}
                aria-label="Fermer"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Vous allez supprimer définitivement <strong>{erasingTarget.name}</strong> ({erasingTarget.phone}) ainsi que
              toutes ses dettes, paiements, relances et journaux de messages associés. Cette action est irréversible et
              sera tracée dans le journal d’activité.
            </p>
            {eraseError && (
              <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-3 rounded-xl">
                {eraseError}
              </p>
            )}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                disabled={erasing}
                onClick={() => setErasingTarget(null)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={erasing}
                onClick={() => void handleConfirmErase()}
                className="min-h-[44px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-60"
              >
                {erasing ? 'Effacement...' : 'Effacer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ImportDebtorsModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
