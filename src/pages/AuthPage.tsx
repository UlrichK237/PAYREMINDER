import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, MailCheck, Moon, RefreshCw, ShieldCheck, Store, Sun, GraduationCap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { normalizeCameroonPhone, isValidInternationalPhone } from '../utils/formatters';

export function AuthPage() {
  const {
    user,
    needsVerification,
    needsCompanySetup,
    pendingInvites,
    errorMessage,
    clearError,
    loginWithEmail,
    registerWithEmail,
    loginWithGoogle,
    resendVerificationEmail,
    refreshAuthUser,
    createCompanyForCurrentUser,
    acceptInvite,
    enterDemoMode,
    logout,
  } = useAuth();

  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userName, setUserName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [sector, setSector] = useState('Commerce & Boutique');
  const [phone, setPhone] = useState('+2376');
  const [consentAccepted, setConsentAccepted] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();
    setSubmitting(true);
    try {
      await loginWithEmail(email, password);
    } catch {
      // Handled by AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();
    const normalized = normalizeCameroonPhone(phone);
    if (!isValidInternationalPhone(normalized)) {
      setLocalError('Téléphone invalide. Exemple camerounais : +237677123456.');
      return;
    }
    if (!consentAccepted) {
      setLocalError('Veuillez accepter la politique de confidentialité et de conformité.');
      return;
    }
    setSubmitting(true);
    try {
      await registerWithEmail({
        email,
        password,
        userName,
        companyName,
        sector,
        phone: normalized,
      });
    } catch {
      // Handled by AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const normalized = normalizeCameroonPhone(phone);
    if (!companyName.trim()) {
      setLocalError('Indiquez le nom de votre entreprise ou commerce.');
      return;
    }
    if (!isValidInternationalPhone(normalized)) {
      setLocalError('Numéro invalide. Exemple : +237677123456.');
      return;
    }
    setSubmitting(true);
    try {
      await createCompanyForCurrentUser({
        userName: userName.trim() || user?.displayName || 'Propriétaire',
        companyName: companyName.trim(),
        sector,
        phone: normalized,
      });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Erreur lors de la création.');
    } finally {
      setSubmitting(false);
    }
  };

  // Écran 1 : Vérification email requise
  if (needsVerification) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
            <MailCheck className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Vérifiez votre adresse email
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Un lien de confirmation vient d’être envoyé à <strong>{user?.email}</strong>. Cliquez sur ce lien puis revenez ici.
            </p>
          </div>
          {infoMsg && <p className="text-xs text-emerald-700 dark:text-emerald-400">{infoMsg}</p>}
          {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => void refreshAuthUser()}
              className="w-full min-h-[46px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              J’ai validé mon email — Continuer
            </button>
            <button
              type="button"
              onClick={async () => {
                await resendVerificationEmail();
                setInfoMsg('Email de vérification renvoyé.');
              }}
              className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Renvoyer l’email
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full min-h-[40px] text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Utiliser un autre compte
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Écran 2 : Création de l'entreprise ou acceptation d'invitation après connexion Google/Email
  if (needsCompanySetup) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Configurer votre entreprise
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Connecté en tant que {user?.email}. Quelques secondes suffisent pour démarrer.
            </p>
          </div>

          {pendingInvites.length > 0 && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-3">
              <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                Vous avez une invitation d’équipe en attente
              </p>
              {pendingInvites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3">
                  <div className="text-xs text-emerald-800 dark:text-emerald-300">
                    Rejoindre <strong>{inv.tenantName}</strong> (Personnel)
                  </div>
                  <button
                    type="button"
                    onClick={() => void acceptInvite(inv)}
                    className="min-h-[40px] px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                  >
                    Accepter
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCreateCompany} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Votre nom complet
              </label>
              <input
                type="text"
                required
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder={user?.displayName || 'Ex: Mama Clarisse'}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Nom de votre commerce ou entreprise
              </label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ex: Boutique Étoile Akwa"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Secteur d’activité
                </label>
                <select
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="Commerce & Boutique">Commerce & Boutique</option>
                  <option value="Éducation / École">Éducation / École</option>
                  <option value="Grossiste / Distribution">Grossiste / Distribution</option>
                  <option value="Prestations & Services">Prestations & Services</option>
                  <option value="Santé / Pharmacie">Santé / Pharmacie</option>
                </select>
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
            </div>

            {localError && <p className="text-xs text-red-600 dark:text-red-400">{localError}</p>}

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => void logout()}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400"
              >
                Déconnexion
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 min-h-[46px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
              >
                {submitting ? 'Création...' : 'Créer mon espace PayReminder'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Écran 3 : Connexion / Inscription + Accès rapide Démo Cameroun
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between max-w-6xl w-full mx-auto">
        <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
          PayReminder
        </span>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Changer de thème"
          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Colonne présentation */}
        <div className="lg:col-span-6 space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-semibold tracking-wide text-emerald-700 dark:text-emerald-400">
              Conçu pour les commerçants et écoles au Cameroun · FCFA (XAF)
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
              Récupérez vos créances clients sans gêne ni oublis.
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
              Enregistrez vos crédits en 10 secondes, programmez des rappels polis sur WhatsApp et SMS, et suivez chaque franc encaissé par espèces, MTN MoMo ou Orange Money.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => enterDemoMode('pagnes')}
              className="flex items-start gap-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-600 dark:hover:border-emerald-500 text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Démo Vendeuse de pagnes
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  12 clientes · Paiements partiels · WhatsApp & MoMo
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => enterDemoMode('ecole')}
              className="flex items-start gap-3 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-600 dark:hover:border-emerald-500 text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Démo École & Scolarité
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  30 élèves en retard · Tranches · Rapports PDF
                </p>
              </div>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Fuseau Africa/Douala
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Respect strict du STOP / Opt-out
            </span>
          </div>
        </div>

        {/* Colonne formulaire Auth */}
        <div className="lg:col-span-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setLocalError(null);
                  clearError();
                }}
                className={`flex-1 min-h-[42px] text-sm font-medium rounded-lg transition-colors ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Se connecter
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setLocalError(null);
                  clearError();
                }}
                className={`flex-1 min-h-[42px] text-sm font-medium rounded-lg transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Créer mon entreprise
              </button>
            </div>

            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Adresse email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="boutique@exemple.cm"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Mot de passe
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>

                {(localError || errorMessage) && (
                  <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-3 rounded-xl">
                    {localError || errorMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Connexion...' : 'Connexion'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Votre nom
                    </label>
                    <input
                      type="text"
                      required
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="Ex: Paul Mbarga"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Nom de l’entreprise
                    </label>
                    <input
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Ex: Quincaillerie Centrale"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
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
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Secteur
                    </label>
                    <select
                      value={sector}
                      onChange={(e) => setSector(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                    >
                      <option value="Commerce & Boutique">Commerce & Boutique</option>
                      <option value="Éducation / École">Éducation / École</option>
                      <option value="Grossiste / Distribution">Grossiste / Distribution</option>
                      <option value="Prestations & Services">Prestations & Services</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Email professionnel
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@moncommerce.cm"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Mot de passe (min. 6 caractères)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>

                <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span>
                    Je confirme disposer du consentement de mes clients pour les relancer par SMS/WhatsApp et j’accepte la politique de confidentialité PayReminder.
                  </span>
                </label>

                {(localError || errorMessage) && (
                  <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-3 rounded-xl">
                    {localError || errorMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[46px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Création du compte...' : 'Créer mon compte gratuit'}
                </button>
              </form>
            )}

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white dark:bg-slate-900 px-3 text-slate-500">ou accès direct</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void loginWithGoogle()}
              className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors"
            >
              Continuer avec Google
            </button>
          </div>
        </div>
      </main>

      <footer className="px-6 py-4 max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>PayReminder · Suivi des créances FCFA</span>
        <div className="flex items-center gap-4">
          <Link to="/legal/cgu" className="hover:text-slate-700 dark:hover:text-slate-200 hover:underline">
            CGU
          </Link>
          <Link to="/legal/confidentialite" className="hover:text-slate-700 dark:hover:text-slate-200 hover:underline">
            Confidentialité
          </Link>
        </div>
      </footer>
    </div>
  );
}
