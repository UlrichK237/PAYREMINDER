import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { QuickDebtModal } from './components/QuickDebtModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider, useData } from './context/DataContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthPage } from './pages/AuthPage';
import { BillingPage } from './pages/BillingPage';
import { DashboardPage } from './pages/DashboardPage';
import { DebtorsPage } from './pages/DebtorsPage';
import { DebtsPage } from './pages/DebtsPage';
import { RemindersPage } from './pages/RemindersPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';

function AppRoutes() {
  const { user, profile, authReady, demoMode, needsVerification, needsCompanySetup } = useAuth();
  const { loadingData } = useData();
  const [quickDebtOpen, setQuickDebtOpen] = useState(false);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-sm text-slate-500 dark:text-slate-400">Chargement de PayReminder...</div>
      </div>
    );
  }

  const isWorkspaceReady = demoMode || (Boolean(user) && !needsVerification && !needsCompanySetup && Boolean(profile));

  if (!isWorkspaceReady) {
    return <AuthPage />;
  }

  if (loadingData) {
    return (
      <Layout onQuickNewDebt={() => setQuickDebtOpen(true)}>
        <div className="space-y-4">
          <div className="h-24 rounded-2xl bg-slate-200/70 dark:bg-slate-800/60" />
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-slate-200/70 dark:bg-slate-800/60" />
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <>
      <Layout onQuickNewDebt={() => setQuickDebtOpen(true)}>
        <Routes>
          <Route path="/" element={<DashboardPage onOpenNewDebt={() => setQuickDebtOpen(true)} />} />
          <Route path="/dettes" element={<DebtsPage onOpenNewDebt={() => setQuickDebtOpen(true)} />} />
          <Route path="/debiteurs" element={<DebtorsPage />} />
          <Route path="/relances" element={<RemindersPage />} />
          <Route path="/rapports" element={<ReportsPage />} />
          <Route path="/abonnement" element={<BillingPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <QuickDebtModal open={quickDebtOpen} onClose={() => setQuickDebtOpen(false)} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <DataProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </DataProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
