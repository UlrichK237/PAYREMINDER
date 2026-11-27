import React, { useMemo, useState } from 'react';
import { ChevronDown, MessageSquare, Send, ShieldCheck } from 'lucide-react';
import { LogStatusLabel } from '../components/StatusText';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { formatDateTimeFr, TONE_LABELS } from '../utils/formatters';

export function RemindersPage() {
  const { demoMode } = useAuth();
  const { debtors, messageLogs, capabilities, simulateInboundWhatsapp } = useData();
  const showSimulation = demoMode || capabilities.simulationRoutes;
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'sms' | 'inbound'>('all');
  const [simAccordionOpen, setSimAccordionOpen] = useState(false);
  const [simPhone, setSimPhone] = useState('');
  const [simMessage, setSimMessage] = useState('Je paie vendredi par MTN MoMo');
  const [simResult, setSimResult] = useState<string | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  const selectedPhone = simPhone || debtors[0]?.phone || '+237677142536';

  const filteredLogs = useMemo(() => {
    return messageLogs.filter((l) => {
      if (channelFilter === 'whatsapp') return l.channel === 'whatsapp';
      if (channelFilter === 'sms') return l.channel === 'sms';
      if (channelFilter === 'inbound') return l.direction === 'inbound';
      return true;
    });
  }, [messageLogs, channelFilter]);

  const handleSimulateInbound = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimRunning(true);
    setSimResult(null);
    try {
      const res = await simulateInboundWhatsapp({
        fromPhone: selectedPhone,
        messageText: simMessage,
      });
      if (res.intent === 'opt_out') {
        setSimResult('Mot-clé STOP/ARRET détecté : Opt-out activé automatiquement sur ce client.');
      } else if (res.intent === 'promise') {
        setSimResult(
          `Promesse de paiement détectée (date estimée : ${res.promiseDate}) et ajoutée à la fiche client.`
        );
      } else {
        setSimResult('Réponse entrante enregistrée dans le journal de conformité.');
      }
    } catch (err) {
      setSimResult(err instanceof Error ? err.message : 'Erreur de simulation.');
    } finally {
      setSimRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* En-tête historique des messages */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span>Historique des messages</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {capabilities.simulationMode
              ? 'Mode simulation : aucune clé WhatsApp/SMS configurée côté serveur, les envois sont journalisés localement (« simulé »).'
              : 'Passerelle serveur connectée · Exécution automatique toutes les 15 minutes (Africa/Douala).'}
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 font-sans tabular-nums whitespace-nowrap">
          {messageLogs.length} message(s) journalisé(s)
        </div>
      </div>

      {/* Filtres journaux */}
      <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-w-full">
        {(
          [
            ['all', 'Tous les messages'],
            ['whatsapp', 'WhatsApp'],
            ['sms', 'SMS'],
            ['inbound', 'Réponses entrantes'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setChannelFilter(key)}
            className={`min-h-[38px] px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              channelFilter === key
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Liste des journaux */}
      {filteredLogs.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center space-y-2">
          <MessageSquare className="w-7 h-7 text-slate-400 mx-auto" />
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            Aucun message enregistré pour le moment
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Déclenchez une relance depuis la page Dettes pour tracer les envois ici.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800">
          {filteredLogs.map((log) => (
            <div key={log.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-900 dark:text-white">{log.debtorName}</span>
                  <span>·</span>
                  <span className="font-num">{log.debtorPhone}</span>
                  <span>·</span>
                  <span>{log.channel.toUpperCase()}</span>
                  {log.tone && log.tone in TONE_LABELS && (
                    <>
                      <span>·</span>
                      <span>Ton {TONE_LABELS[log.tone as keyof typeof TONE_LABELS]}</span>
                    </>
                  )}
                  {log.detectedIntent === 'opt_out' && (
                    <>
                      <span>·</span>
                      <span className="text-red-600 dark:text-red-400 font-semibold">Opt-out détecté</span>
                    </>
                  )}
                  {log.detectedIntent === 'promise' && log.promiseDate && (
                    <>
                      <span>·</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        Promesse ({log.promiseDate})
                      </span>
                    </>
                  )}
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed break-words">
                  {log.content}
                </p>
              </div>
              <div className="sm:text-right shrink-0 space-y-1">
                <div>
                  <LogStatusLabel status={log.status} />
                </div>
                <p className="text-[11px] font-num text-slate-400">
                  {formatDateTimeFr(log.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Accordéon fermé par défaut : Outils de test (simulation) */}
      {showSimulation && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setSimAccordionOpen((prev) => !prev)}
            aria-expanded={simAccordionOpen}
            className="w-full min-h-[48px] px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
          >
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              Outils de test (simulation)
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-500 transition-transform ${
                simAccordionOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {simAccordionOpen && (
            <div className="px-5 pb-5 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Simulez une réponse WhatsApp entrante : essayez « STOP » pour activer l’opt-out ou « Je paie vendredi » pour enregistrer une promesse datée.
              </p>

              <form onSubmit={handleSimulateInbound} className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-4">
                  <select
                    value={selectedPhone}
                    onChange={(e) => setSimPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-num"
                  >
                    {debtors.map((d) => (
                      <option key={d.id} value={d.phone}>
                        {d.name} ({d.phone})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-5">
                  <input
                    type="text"
                    required
                    value={simMessage}
                    onChange={(e) => setSimMessage(e.target.value)}
                    placeholder="Ex: STOP ou Je paie vendredi"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div className="md:col-span-3">
                  <button
                    type="submit"
                    disabled={simRunning || debtors.length === 0}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-emerald-700 hover:bg-slate-800 dark:hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Simuler réponse client</span>
                  </button>
                </div>
              </form>

              <div className="flex flex-wrap gap-2">
                {['STOP', 'ARRET', 'Je paie vendredi', 'Je règle demain'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setSimMessage(preset)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    « {preset} »
                  </button>
                ))}
              </div>

              {simResult && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-xl">
                  {simResult}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
