import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'Une erreur inattendue est survenue.';
    if (readable.startsWith('{')) {
      try {
        const parsed = JSON.parse(readable) as { error?: string; operationType?: string; path?: string };
        if (parsed.error?.includes('Missing or insufficient permissions')) {
          readable = `Accès refusé lors de l'opération (${parsed.operationType || 'lecture'}) sur ${parsed.path || 'les données'}. Vérifiez que votre email est vérifié et que vous appartenez bien à cette entreprise.`;
        } else if (parsed.error) {
          readable = parsed.error;
        }
      } catch {
        // Garde le message brut si le JSON n'est pas valide
      }
    }
    return { hasError: true, message: readable };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Un problème est survenu
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-sm transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Recharger l’application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
