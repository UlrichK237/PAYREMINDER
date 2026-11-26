import { ArrowLeft, Moon, ShieldAlert, Sun } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

interface LegalPageProps {
  docType: 'cgu' | 'confidentialite';
}

export function LegalPage({ docType }: LegalPageProps) {
  const { theme, toggleTheme } = useTheme();
  const isPrivacy = docType === 'confidentialite';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Retour</span>
            </Link>
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              PayReminder
            </span>
          </div>

          <div className="flex items-center gap-2">
            <nav className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium">
              <Link
                to="/legal/cgu"
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  !isPrivacy
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                CGU
              </Link>
              <Link
                to="/legal/confidentialite"
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  isPrivacy
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Confidentialité
              </Link>
            </nav>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Changer de thème"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="font-medium">
            Document à faire valider par un juriste avant la mise en production.
          </p>
        </div>

        {isPrivacy ? (
          <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            <div className="space-y-1 border-b border-slate-100 dark:border-slate-800 pb-4">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Politique de confidentialité — PayReminder
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Protection des données personnelles des commerçants et de leurs clients débiteurs (Cameroun &amp; principes RGPD).
              </p>
            </div>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                1. Rôles : Responsable de traitement &amp; Sous-traitant
              </h2>
              <p>
                Chaque commerçant, établissement scolaire ou entreprise utilisant PayReminder agit en qualité de{' '}
                <strong>Responsable de traitement</strong> vis-à-vis des données de ses clients débiteurs : il détermine
                l’existence de la créance, confirme son droit de contacter la personne concernée et décide du suivi.
              </p>
              <p>
                <strong>PayReminder</strong> agit exclusivement en qualité de <strong>Sous-traitant technique</strong> :
                la plateforme héberge les données de manière cloisonnée par entreprise, exécute les relances SMS et
                WhatsApp configurées et génère les reçus de paiement pour le compte du commerçant.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                2. Données personnelles traitées concernant les débiteurs
              </h2>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Identité et coordonnées : nom complet, numéro de téléphone international (+237...), canal préféré.</li>
                <li>Informations de créance : montant initial et restant dû en FCFA (XAF), date d’échéance, motif, historique des paiements et reçus.</li>
                <li>Suivi des échanges et conformité : journal des relances envoyées/reçues, promesses de paiement, statut d’opposition (<code>optOut</code> / STOP), horodatage et auteur de la confirmation du droit de contact.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                3. Finalités du traitement
              </h2>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Suivi comptable des créances clients et édition de reçus de paiement PDF.</li>
                <li>Envoi de rappels d’échéance polis par WhatsApp et SMS pendant les horaires autorisés (fuseau Africa/Douala).</li>
                <li>Mise à disposition de liens de règlement Mobile Money (MTN MoMo / Orange Money).</li>
                <li>Prévention du harcèlement (plafonds par jour et sur 7 jours glissants) et blocage immédiat sur réponse « STOP ».</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                4. Durée de conservation
              </h2>
              <p>
                Les données des débiteurs sont conservées pendant la durée de gestion de la créance et, sauf obligation
                comptable ou légale contraire, pour une durée maximale recommandée de <strong>3 ans</strong> après le
                règlement complet ou le dernier échange, ou jusqu’à demande d’effacement anticipé.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                5. Droits des personnes &amp; Effacement des données
              </h2>
              <p>
                Tout client débiteur dispose d’un droit d’accès, de rectification, d’opposition immédiate aux messages
                (en répondant <strong>STOP</strong> par SMS ou WhatsApp) et d’effacement de ses données personnelles.
              </p>
              <p>
                Le propriétaire de l’entreprise peut effacer à tout moment la fiche d’un débiteur ainsi que l’ensemble
                de ses dettes, paiements, relances et journaux associés depuis la page <strong>Débiteurs</strong>.
                Pour toute question ou demande relative aux données personnelles :{' '}
                <a href="mailto:contact@payreminder.cm" className="text-emerald-700 dark:text-emerald-400 underline">
                  contact@payreminder.cm
                </a>.
              </p>
            </section>
          </article>
        ) : (
          <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            <div className="space-y-1 border-b border-slate-100 dark:border-slate-800 pb-4">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Conditions Générales d’Utilisation (CGU) — PayReminder
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Service SaaS de suivi des créances et relances automatisées (FCFA / Africa/Douala).
              </p>
            </div>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                1. Objet du service
              </h2>
              <p>
                PayReminder met à disposition des commerçants, écoles et PME un espace sécurisé permettant
                d’enregistrer des créances clients en FCFA (XAF), d’automatiser des rappels de paiement par SMS ou
                WhatsApp et de suivre les encaissements.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                2. Engagements du commerçant (Responsable de traitement)
              </h2>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>N’enregistrer que des créances réelles, exigibles et légitimes.</li>
                <li>Confirmer disposer du droit de contacter chaque client ajouté avant tout envoi de relance.</li>
                <li>Proscrire tout message menaçant, intimidant ou injurieux ; respecter l’opposition immédiate (« STOP ») et les plages horaires nocturnes.</li>
                <li>Préserver la confidentialité de ses accès et vérifier son numéro de téléphone avant l’activation d’envois réels.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                3. Forfaits, quotas et facturation
              </h2>
              <p>
                L’accès est proposé via un forfait Gratuit limité et des forfaits payants mensuels (Starter, Pro,
                Business) payables en FCFA par Mobile Money. Les plafonds journaliers et mensuels sont appliqués côté
                serveur pour garantir la qualité de délivrabilité et éviter tout abus.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                4. Données, sécurité et contact
              </h2>
              <p>
                Les données sont strictement isolées par entreprise. Le commerçant demeure responsable du traitement de
                sa base clients conformément à la{' '}
                <Link to="/legal/confidentialite" className="text-emerald-700 dark:text-emerald-400 underline">
                  Politique de confidentialité
                </Link>
                . Contact support et données personnelles :{' '}
                <a href="mailto:contact@payreminder.cm" className="text-emerald-700 dark:text-emerald-400 underline">
                  contact@payreminder.cm
                </a>.
              </p>
            </section>
          </article>
        )}
      </main>
    </div>
  );
}
