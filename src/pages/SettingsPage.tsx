import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { History, KeyRound, PhoneCall, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { AuditLogAction, Channel, Tone } from '../types/payreminder';
import { formatDateTimeFr, renderTemplateMessage, TONE_LABELS } from '../utils/formatters';
import { PLANS } from '../utils/plans';
import { validateTemplateBody } from '../utils/templateValidation';

const AUDIT_ACTION_LABELS: Record<AuditLogAction, string> = {
  plan_change: 'Changement de forfait',
  subscription_payment: 'Paiement abonnement',
  manual_reminder: 'Relance manuelle',
  debtor_erase: 'Effacement RGPD',
  phone_verified: 'Téléphone vérifié',
};

export function SettingsPage() {
  const { profile, demoMode } = useAuth();
  const {
    tenant,
    teamUsers,
    teamInvites,
    messageTemplates,
    reminderRules,
    auditLogs,
    capabilities,
    phoneVerified,
    dailyUsage,
    updateTenantSettings,
    updateMessageTemplate,
    updateReminderRule,
    inviteStaffMember,
    revokeInvite,
    sendPhoneVerificationCode,
    verifyPhoneVerificationCode,
  } = useData();

  const [tab, setTab] = useState<'company' | 'templates' | 'rules' | 'team' | 'security' | 'audit'>('company');

  // Form profil entreprise
  const [name, setName] = useState(tenant?.name || '');
  const [sector, setSector] = useState(tenant?.sector || '');
  const [phone, setPhone] = useState(tenant?.phone || '');
  const [email, setEmail] = useState(tenant?.email || '');
  const [quietStart, setQuietStart] = useState(tenant?.quietHoursStart ?? 20);
  const [quietEnd, setQuietEnd] = useState(tenant?.quietHoursEnd ?? 7);
  const [autoEscalate, setAutoEscalate] = useState(tenant?.autoEscalate ?? true);
  const [fallbackToSms, setFallbackToSms] = useState(tenant?.fallbackToSms ?? true);

  // Modèles
  const [draftBodies, setDraftBodies] = useState<Record<string, string>>({});

  // Équipe
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  // Vérification téléphone propriétaire
  const [phoneCodeInput, setPhoneCodeInput] = useState('');
  const [sendingPhoneCode, setSendingPhoneCode] = useState(false);
  const [verifyingPhoneCode, setVerifyingPhoneCode] = useState(false);
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!tenant) return null;

  const isOwner = demoMode || profile?.role === 'owner';

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setErrorMsg(null);
    try {
      await updateTenantSettings({
        name: name || tenant.name,
        sector: sector || tenant.sector,
        phone: phone || tenant.phone,
        email: email || tenant.email,
        quietHoursStart: Number(quietStart),
        quietHoursEnd: Number(quietEnd),
        autoEscalate,
        fallbackToSms,
      });
      setFeedback('Paramètres de l’entreprise mis à jour.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur de mise à jour.');
    }
  };

  const handleSaveTemplate = async (tplId: string, body: string, channel: Channel) => {
    setFeedback(null);
    setErrorMsg(null);
    const check = validateTemplateBody(body, channel);
    if (!check.ok) {
      setErrorMsg(check.error || 'Modèle de message invalide.');
      return;
    }
    try {
      await updateMessageTemplate(tplId, body);
      setFeedback('Modèle de message enregistré.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde du modèle.');
    }
  };

  const handleInviteStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setErrorMsg(null);
    try {
      await inviteStaffMember({ name: inviteName, email: inviteEmail });
      setInviteName('');
      setInviteEmail('');
      setFeedback('Invitation envoyée. Votre collaborateur la verra dès sa connexion.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible d’inviter ce membre.');
    }
  };

  const handleRequestPhoneCode = async () => {
    setFeedback(null);
    setErrorMsg(null);
    setSendingPhoneCode(true);
    try {
      const res = await sendPhoneVerificationCode();
      setDevCodeHint(res.devCode || null);
      setFeedback(`Code de vérification envoyé par SMS au ${res.phone}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible d’envoyer le code SMS.');
    } finally {
      setSendingPhoneCode(false);
    }
  };

  const handleVerifyPhoneCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setErrorMsg(null);
    setVerifyingPhoneCode(true);
    try {
      await verifyPhoneVerificationCode(phoneCodeInput);
      setPhoneCodeInput('');
      setDevCodeHint(null);
      setFeedback('Téléphone du propriétaire vérifié avec succès.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Code invalide ou expiré.');
    } finally {
      setVerifyingPhoneCode(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Onglets */}
      <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-w-full">
        {(
          [
            ['company', 'Entreprise'],
            ['templates', 'Modèles de messages'],
            ['rules', 'Règles de relance'],
            ['team', 'Équipe'],
            ['security', 'Clés API & Conformité'],
            ...(isOwner ? ([['audit', 'Journal d’activité']] as const) : []),
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setFeedback(null);
              setErrorMsg(null);
            }}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              tab === key
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {feedback && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-3.5 rounded-xl">
          {feedback}
        </p>
      )}
      {errorMsg && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-3.5 rounded-xl">
          {errorMsg}
        </p>
      )}

      {/* Tab 1 : Entreprise */}
      {tab === 'company' && (
        <form
          onSubmit={handleSaveCompany}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 max-w-2xl"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Profil & préférences générales
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nom de l’entreprise
              </label>
              <input
                type="text"
                disabled={!isOwner}
                value={name || tenant.name}
                onChange={(e) => setName(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Secteur d’activité
              </label>
              <input
                type="text"
                disabled={!isOwner}
                value={sector || tenant.sector}
                onChange={(e) => setSector(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Téléphone (+237...)
              </label>
              <input
                type="tel"
                disabled={!isOwner}
                value={phone || tenant.phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-num"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Email pour rapports mensuels
              </label>
              <input
                type="email"
                disabled={!isOwner}
                value={email || tenant.email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Début des heures de silence (nuit)
              </label>
              <input
                type="number"
                min={18}
                max={23}
                disabled={!isOwner}
                value={quietStart}
                onChange={(e) => setQuietStart(Number(e.target.value))}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-num"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Fin des heures de silence (matin)
              </label>
              <input
                type="number"
                min={5}
                max={10}
                disabled={!isOwner}
                value={quietEnd}
                onChange={(e) => setQuietEnd(Number(e.target.value))}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-num"
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                disabled={!isOwner}
                checked={autoEscalate}
                onChange={(e) => setAutoEscalate(e.target.checked)}
              />
              <span>Escalade automatique du ton selon le nombre de jours de retard</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                disabled={!isOwner}
                checked={fallbackToSms}
                onChange={(e) => setFallbackToSms(e.target.checked)}
              />
              <span>Repli automatique sur SMS si l’envoi WhatsApp échoue</span>
            </label>
          </div>

          {isOwner && (
            <button
              type="submit"
              className="min-h-[44px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold"
            >
              Enregistrer les modifications
            </button>
          )}
        </form>
      )}

      {/* Tab 2 : Modèles de messages + Aperçu en direct */}
      {tab === 'templates' && (
        <div className="space-y-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Variables disponibles : <span className="font-num">{'{nom}'}</span>,{' '}
            <span className="font-num">{'{montant_restant}'}</span>,{' '}
            <span className="font-num">{'{echeance}'}</span>,{' '}
            <span className="font-num">{'{entreprise}'}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {messageTemplates.map((tpl) => {
              const currentBody = draftBodies[tpl.id] ?? tpl.body;
              const livePreview = renderTemplateMessage(currentBody, {
                nom: 'Marie-Claire Ngo',
                montant_restant: 25000,
                echeance: '2026-11-30',
                entreprise: tenant.name,
              });

              return (
                <div
                  key={tpl.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      Ton {TONE_LABELS[tpl.tone]} · {tpl.channel.toUpperCase()}
                    </span>
                    {tpl.metaTemplateName && (
                      <span className="font-num text-slate-400">{tpl.metaTemplateName}</span>
                    )}
                  </div>

                  <textarea
                    rows={3}
                    disabled={!isOwner}
                    value={currentBody}
                    onChange={(e) =>
                      setDraftBodies((prev) => ({ ...prev, [tpl.id]: e.target.value }))
                    }
                    className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-semibold block mb-1 text-slate-500 dark:text-slate-400">
                      Aperçu en direct :
                    </span>
                    {livePreview}
                  </div>

                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void handleSaveTemplate(tpl.id, currentBody, tpl.channel)}
                      className="min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                    >
                      Sauvegarder ce modèle
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3 : Règles du calendrier */}
      {tab === 'rules' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800">
          {reminderRules.map((rule) => (
            <div key={rule.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{rule.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Déclenchement à J{rule.offsetDays >= 0 ? `+${rule.offsetDays}` : rule.offsetDays} · Plage{' '}
                  {rule.allowedStartHour}h–{rule.allowedEndHour}h · Max {rule.maxReminders} relances
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  disabled={!isOwner}
                  value={rule.channel}
                  onChange={(e) => void updateReminderRule(rule.id, { channel: e.target.value as Channel })}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                </select>
                <select
                  disabled={!isOwner}
                  value={rule.tone}
                  onChange={(e) => void updateReminderRule(rule.id, { tone: e.target.value as Tone })}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                >
                  <option value="amical">Amical</option>
                  <option value="ferme">Ferme</option>
                  <option value="dernier_avis">Dernier avis</option>
                </select>
                <button
                  type="button"
                  disabled={!isOwner}
                  onClick={() => void updateReminderRule(rule.id, { enabled: !rule.enabled })}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold border ${
                    rule.enabled
                      ? 'border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500'
                  }`}
                >
                  {rule.enabled ? 'Activée' : 'Désactivée'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 4 : Équipe */}
      {tab === 'team' && (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Inviter un membre du personnel</span>
            </h2>
            {!PLANS[tenant.plan].multiUserEnabled && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Le multi-utilisateur est disponible sur le forfait Business.
              </p>
            )}
            <form onSubmit={handleInviteStaff} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                type="text"
                required
                placeholder="Nom du caissier / assistant"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="sm:col-span-4 min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
              <input
                type="email"
                required
                placeholder="email@exemple.cm"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="sm:col-span-5 min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
              <button
                type="submit"
                disabled={!isOwner || !PLANS[tenant.plan].multiUserEnabled}
                className="sm:col-span-3 min-h-[44px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50"
              >
                Inviter
              </button>
            </form>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span>Membres actifs ({teamUsers.length})</span>
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {teamUsers.map((u) => (
                <div key={u.id} className="py-3 flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{u.name}</p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </div>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {u.role === 'owner' ? 'Propriétaire' : 'Personnel'}
                  </span>
                </div>
              ))}
              {teamInvites
                .filter((i) => i.status === 'pending')
                .map((inv) => (
                  <div key={inv.id} className="py-3 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{inv.name}</p>
                      <p className="text-xs text-amber-600">Invitation en attente · {inv.email}</p>
                    </div>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => void revokeInvite(inv.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Révoquer
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 5 : Sécurité, Clés API serveur & Conformité */}
      {tab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 lg:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>Sécurité — Vérification du téléphone du propriétaire</span>
              </h2>
              <span
                className={`text-xs font-semibold ${
                  phoneVerified
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {phoneVerified ? 'Téléphone vérifié' : 'Non vérifié'}
              </span>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Numéro enregistré : <span className="font-num font-semibold text-slate-700 dark:text-slate-200">{tenant.phone}</span> ·{' '}
              Envois du jour ({dailyUsage.date}) :{' '}
              <span className="font-num font-semibold text-slate-700 dark:text-slate-200">
                {dailyUsage.count}/{PLANS[tenant.plan].maxRemindersPerDay}
              </span>
              . La vérification par SMS est obligatoire avant tout envoi via un fournisseur réel.
            </p>

            {isOwner && !phoneVerified && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={sendingPhoneCode}
                  onClick={() => void handleRequestPhoneCode()}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  {sendingPhoneCode ? 'Envoi du code...' : 'Envoyer un code SMS (6 chiffres)'}
                </button>
                <form onSubmit={handleVerifyPhoneCode} className="flex items-center gap-2 flex-1 max-w-xs">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={phoneCodeInput}
                    onChange={(e) => setPhoneCodeInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="Code à 6 chiffres"
                    className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-num"
                  />
                  <button
                    type="submit"
                    disabled={verifyingPhoneCode || phoneCodeInput.length !== 6}
                    className="min-h-[42px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 shrink-0"
                  >
                    {verifyingPhoneCode ? 'Validation...' : 'Valider'}
                  </button>
                </form>
              </div>
            )}

            {devCodeHint && (
              <p className="text-xs text-slate-600 dark:text-slate-300 font-num bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl">
                Mode simulation développement — code généré : {devCodeHint}
              </p>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>État des passerelles serveur (zéro clé côté front)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Les secrets sont lus exclusivement côté serveur dans les variables d’environnement de <code className="font-num">server.ts</code>.
            </p>
            <div className="space-y-2.5 text-xs">
              {[
                ['WhatsApp Cloud API (WHATSAPP_ACCESS_TOKEN)', capabilities.whatsappConfigured],
                ['Passerelle SMS Cameroun (SMS_API_KEY)', capabilities.smsConfigured],
                ['Mobile Money (PAYMENT_API_KEY)', capabilities.paymentConfigured],
                ['Email Rapports (EMAIL_PROVIDER_API_KEY)', capabilities.emailConfigured],
              ].map(([label, ok]) => (
                <div key={String(label)} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-700 dark:text-slate-300">{label}</span>
                  <span className={ok ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-amber-600 dark:text-amber-400'}>
                    {ok ? 'Configurée' : 'Mode simulation'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Conformité & Politique de confidentialité</span>
            </h2>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed list-disc pl-4">
              <li>Isolation multi-tenant stricte : chaque entreprise ne lit que ses documents sous <code className="font-num">tenants/{'{tenantId}'}</code>.</li>
              <li>Opt-out immédiat : toute réponse « STOP » ou « ARRET » bloque instantanément les relances futures.</li>
              <li>Horaires respectueux : aucune relance automatique la nuit (fuseau Africa/Douala).</li>
              <li>Journalisation immuable de chaque message et de chaque reçu de paiement dans <code className="font-num">messageLogs</code>.</li>
              <li>Aucun message à caractère menaçant ou abusif dans les modèles par défaut.</li>
            </ul>
            <div className="pt-2 flex flex-wrap items-center gap-4 text-xs">
              <Link to="/legal/cgu" className="text-emerald-700 dark:text-emerald-400 hover:underline">
                Conditions Générales d’Utilisation (CGU)
              </Link>
              <Link to="/legal/confidentialite" className="text-emerald-700 dark:text-emerald-400 hover:underline">
                Politique de confidentialité
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6 : Journal d'activité (Owner-only) */}
      {tab === 'audit' && isOwner && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Journal d’activité</span>
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {auditLogs.length} événement(s)
            </span>
          </div>

          {auditLogs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Aucune action sensible enregistrée pour le moment.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Date (Douala)</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Détails</th>
                    <th className="px-4 py-3">Acteur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLogs.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3 font-num text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatDateTimeFr(entry.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                        {AUDIT_ACTION_LABELS[entry.action] || entry.action}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {entry.summary}
                      </td>
                      <td className="px-4 py-3 font-num text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {entry.actorUid.slice(0, 14)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
