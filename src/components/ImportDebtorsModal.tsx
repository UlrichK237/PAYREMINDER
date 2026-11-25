import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { AlertCircle, CheckCircle2, Upload, X } from 'lucide-react';
import { useData } from '../context/DataContext';
import type { Channel } from '../types/payreminder';
import { isValidInternationalPhone, normalizeCameroonPhone } from '../utils/formatters';

interface ImportDebtorsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ParsedRow {
  rowNum: number;
  name: string;
  phone: string;
  preferredChannel: Channel;
  note: string;
  valid: boolean;
  error?: string;
}

export function ImportDebtorsModal({ open, onClose }: ImportDebtorsModalProps) {
  const { tenant, debtors, bulkImportDebtors } = useData();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  if (!open) return null;

  const parseRawRecords = (rawRows: Array<Record<string, unknown>>) => {
    const parsed: ParsedRow[] = rawRows.map((rec, index) => {
      const normalizedKeys: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec)) {
        normalizedKeys[k.trim().toLowerCase()] = String(v ?? '').trim();
      }
      const name = normalizedKeys['nom'] || normalizedKeys['name'] || normalizedKeys['client'] || '';
      const rawPhone =
        normalizedKeys['telephone'] ||
        normalizedKeys['téléphone'] ||
        normalizedKeys['phone'] ||
        normalizedKeys['tel'] ||
        '';
      const channelRaw = (normalizedKeys['canal'] || normalizedKeys['channel'] || 'whatsapp').toLowerCase();
      const preferredChannel: Channel = channelRaw.includes('sms') ? 'sms' : 'whatsapp';
      const note = normalizedKeys['note'] || normalizedKeys['remarque'] || '';

      const phone = normalizeCameroonPhone(rawPhone);
      let valid = true;
      let error = '';
      if (!name) {
        valid = false;
        error = 'Nom manquant';
      } else if (!isValidInternationalPhone(phone)) {
        valid = false;
        error = `Téléphone invalide (${rawPhone || 'vide'})`;
      }

      return {
        rowNum: index + 2,
        name,
        phone,
        preferredChannel,
        note,
        valid,
        error: error || undefined,
      };
    });
    setRows(parsed);
    setDoneCount(null);
    setServerError(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setServerError(null);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => parseRawRecords(results.data),
        error: () => setServerError('Impossible de lire le fichier CSV.'),
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
        parseRawRecords(json);
      } catch {
        setServerError('Impossible de lire le fichier Excel.');
      }
    } else {
      setServerError('Format non supporté. Utilisez un fichier .csv, .xlsx ou .xls.');
    }
  };

  const validRows = rows.filter((r) => r.valid);
  const invalidRows = rows.filter((r) => !r.valid);
  const remainingSlots = tenant ? Math.max(0, tenant.maxDebtors - debtors.length) : 0;

  const handleConfirmImport = async () => {
    setServerError(null);
    setImporting(true);
    try {
      const count = await bulkImportDebtors(
        validRows.map((r) => ({
          name: r.name,
          phone: r.phone,
          preferredChannel: r.preferredChannel,
          note: r.note,
        }))
      );
      setDoneCount(count);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Échec de l’import.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Importer des débiteurs (CSV / Excel)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Colonnes attendues : nom, telephone (+237...), canal (whatsapp/sms), note
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl cursor-pointer hover:border-emerald-600 transition-colors">
          <Upload className="w-6 h-6 text-emerald-700 dark:text-emerald-400" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Choisir un fichier .csv, .xlsx ou .xls
          </span>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="hidden" />
        </label>

        {rows.length > 0 && (
          <div className="flex-1 overflow-y-auto space-y-3">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                {validRows.length} ligne(s) valide(s)
              </span>
              {invalidRows.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400 font-medium">
                  <AlertCircle className="w-4 h-4" />
                  {invalidRows.length} erreur(s) détectée(s)
                </span>
              )}
              <span className="text-slate-500 dark:text-slate-400">
                Places restantes sur le forfait : {remainingSlots >= 99999 ? 'Illimité' : remainingSlots}
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2.5">Ligne</th>
                    <th className="px-3 py-2.5">Nom</th>
                    <th className="px-3 py-2.5">Téléphone</th>
                    <th className="px-3 py-2.5">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.slice(0, 30).map((r) => (
                    <tr key={r.rowNum}>
                      <td className="px-3 py-2 font-num text-slate-500">{r.rowNum}</td>
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{r.name || '—'}</td>
                      <td className="px-3 py-2 font-num text-slate-600 dark:text-slate-300">{r.phone || '—'}</td>
                      <td className="px-3 py-2">
                        {r.valid ? (
                          <span className="text-emerald-700 dark:text-emerald-400">Prêt</span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">{r.error}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {serverError && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-3 rounded-xl">
            {serverError}
          </p>
        )}

        {doneCount !== null && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-xl">
            {doneCount} débiteur(s) importé(s) avec succès.
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Fermer
          </button>
          <button
            type="button"
            disabled={validRows.length === 0 || importing || doneCount !== null}
            onClick={() => void handleConfirmImport()}
            className="min-h-[44px] px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-50"
          >
            {importing ? 'Importation...' : `Importer ${validRows.length} client(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
