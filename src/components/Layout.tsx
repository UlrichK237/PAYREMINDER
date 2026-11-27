import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  CreditCard,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings,
  Sun,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useTheme } from '../context/ThemeContext';
import { PLANS } from '../utils/plans';

interface LayoutProps {
  children: React.ReactNode;
  onQuickNewDebt: () => void;
}

const NAV_ITEMS = [
  { path: '/', label: 'Tableau de bord', icon: LayoutDashboard },
  { path: '/dettes', label: 'Dettes', icon: Wallet },
  { path: '/debiteurs', label: 'Débiteurs', icon: Users },
  { path: '/relances', label: 'Relances', icon: Bell },
  { path: '/rapports', label: 'Rapports', icon: BarChart3 },
  { path: '/abonnement', label: 'Abonnement', icon: CreditCard },
  { path: '/parametres', label: 'Paramètres', icon: Settings },
];

const MOBILE_TABS = [
  { path: '/', label: 'Accueil', icon: LayoutDashboard },
  { path: '/dettes', label: 'Dettes', icon: Wallet },
  { path: '/debiteurs', label: 'Clients', icon: Users },
  { path: '/relances', label: 'Relances', icon: Bell },
];

export function Layout({ children, onQuickNewDebt }: LayoutProps) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { demoMode, logout, profile } = useAuth();
  const { tenant, capabilities } = useData();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentNav = NAV_ITEMS.find((n) => n.path === location.pathname) || NAV_ITEMS[0];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row">
      {/* Sidebar Desktop (256px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 sticky top-0 h-screen">
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <Link to="/" className="text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            PayReminder
          </Link>
          {tenant && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
              {tenant.name}
            </p>
          )}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Navigation principale">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3.5 min-h-[44px] rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          {tenant && (
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <div className="flex items-center justify-between">
                <span>Forfait {PLANS[tenant.plan].name}</span>
                <span className="font-num">
                  {tenant.remindersUsedThisMonth}/{tenant.maxRemindersPerMonth >= 999999 ? '∞' : tenant.maxRemindersPerMonth}
                </span>
              </div>
              {(demoMode || capabilities.simulationMode) && (
                <p className="text-amber-700 dark:text-amber-400">
                  {demoMode ? 'Mode Démonstration local' : 'Envois en mode simulation'}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {profile?.role === 'staff' ? 'Personnel' : 'Propriétaire'}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-2.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Quitter</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500 pt-1">
            <Link to="/legal/cgu" className="hover:text-slate-600 dark:hover:text-slate-300 hover:underline">
              CGU
            </Link>
            <span>·</span>
            <Link to="/legal/confidentialite" className="hover:text-slate-600 dark:hover:text-slate-300 hover:underline">
              Confidentialité
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (Desktop + Mobile compact header <= 56px) */}
        <header className="sticky top-0 z-30 h-14 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Ouvrir le menu"
              className="lg:hidden min-h-[40px] min-w-[40px] -ml-1 flex items-center justify-center rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base lg:text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
              {currentNav.label}
            </h1>
            {tenant && (
              <span className="hidden md:inline text-xs text-slate-500 dark:text-slate-400 truncate">
                · {tenant.name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onQuickNewDebt}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Nouvelle dette</span>
              <span className="sm:hidden">Dette</span>
            </button>
          </div>
        </header>

        {/* Viewport Content */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-28 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Floating Action Button "+ Dette" sur Accueil et Dettes uniquement */}
      {(location.pathname === '/' || location.pathname === '/dettes') && (
        <button
          type="button"
          onClick={onQuickNewDebt}
          className="lg:hidden fixed right-4 bottom-20 z-30 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold shadow-lg shadow-emerald-950/20 dark:shadow-black/40 transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>Dette</span>
        </button>
      )}

      {/* Mobile Bottom Navigation Bar (<= 64px) */}
      <nav
        aria-label="Navigation mobile"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center"
      >
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`flex flex-col items-center justify-center h-full text-[11px] font-medium transition-colors ${
                active
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Mobile Drawer pour Rapports / Abonnement / Paramètres */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full flex flex-col border-r border-slate-200 dark:border-slate-800">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-lg font-bold text-slate-900 dark:text-white">PayReminder</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fermer le menu"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 p-3 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 min-h-[46px] rounded-xl text-sm font-medium ${
                      active
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
              {tenant && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tenant.name} · Forfait {PLANS[tenant.plan].name}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  void logout();
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-red-600 dark:text-red-400"
              >
                <LogOut className="w-4 h-4" />
                <span>Se déconnecter</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Keep unused icon import clean if needed elsewhere
export { FileSpreadsheet };
