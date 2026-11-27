import { jsPDF } from 'jspdf';
import type { Debt, Payment, Tenant } from '../types/payreminder';
import { formatDateFr, formatDateTimeFr, formatFcfa, formatPercent, PAYMENT_METHOD_LABELS } from './formatters';

function sanitizePdfText(val: string): string {
  // jsPDF Helvetica gère bien le latin1 et l'espace normale (remplace \u00A0 par espace standard)
  return val.replace(/\u00A0/g, ' ');
}

/**
 * Génère et télécharge un reçu de paiement officiel en PDF (FCFA).
 */
export function downloadPaymentReceiptPdf(params: {
  tenant: Tenant;
  payment: Payment;
  debt: Debt;
}): void {
  const { tenant, payment, debt } = params;
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });

  doc.setFillColor(4, 120, 87);
  doc.rect(0, 0, 148, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RECU DE PAIEMENT', 12, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(sanitizePdfText(tenant.name), 12, 21);
  doc.text(sanitizePdfText(`N° ${payment.receiptNumber}`), 136, 13, { align: 'right' });

  doc.setTextColor(15, 23, 42);
  let y = 40;
  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(sanitizePdfText(label), 12, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(sanitizePdfText(value), 136, y, { align: 'right' });
    y += 9;
  };

  row('Entreprise', tenant.name);
  row('Téléphone entreprise', tenant.phone);
  row('Client / Débiteur', payment.debtorName);
  row('Objet de la créance', debt.description || 'Créance client');
  row('Date du règlement', formatDateTimeFr(payment.paidAt));
  row('Mode de paiement', PAYMENT_METHOD_LABELS[payment.method]);

  doc.setDrawColor(226, 232, 240);
  doc.line(12, y, 136, y);
  y += 10;

  doc.setFillColor(240, 253, 244);
  doc.roundedRect(12, y - 4, 124, 24, 3, 3, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(4, 120, 87);
  doc.text('Montant encaissé', 18, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(sanitizePdfText(formatFcfa(payment.amount)), 130, y + 5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  doc.text(
    sanitizePdfText(`Solde restant dû : ${formatFcfa(debt.remainingAmount)}`),
    18,
    y + 14
  );

  y += 32;
  if (payment.note) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(sanitizePdfText(`Note : ${payment.note}`), 12, y);
    y += 10;
  }

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    sanitizePdfText(`Document généré par PayReminder · Fuseau horaire ${tenant.timezone}`),
    12,
    195
  );

  doc.save(`recu-${payment.receiptNumber}.pdf`);
}

/**
 * Génère et télécharge le rapport financier mensuel en PDF.
 */
export function downloadMonthlyReportPdf(params: {
  tenant: Tenant;
  monthLabel: string;
  monthKey: string;
  totalDue: number;
  collectedThisMonth: number;
  recoveryRate: number;
  overdueCount: number;
  remindersSent: number;
  payments: Payment[];
  overdueDebts: Debt[];
}): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { tenant, monthLabel, monthKey, totalDue, collectedThisMonth, recoveryRate, overdueCount, remindersSent, payments, overdueDebts } = params;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('RAPPORT MENSUEL DE RECOUVREMENT', 14, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.text(sanitizePdfText(`${tenant.name} · Période : ${monthLabel}`), 14, 24);

  let y = 44;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Synthèse financière', 14, y);
  y += 8;

  const kpis = [
    ['Total restant dû', formatFcfa(totalDue)],
    ['Encaissé sur la période', formatFcfa(collectedThisMonth)],
    ['Taux de récupération', formatPercent(recoveryRate)],
    ['Dossiers en retard', `${overdueCount}`],
    ['Relances envoyées', `${remindersSent}`],
  ];

  doc.setFontSize(10);
  for (const [k, v] of kpis) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(sanitizePdfText(k), 14, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(sanitizePdfText(v), 196, y, { align: 'right' });
    y += 7;
  }

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Encaissements enregistrés (${payments.length})`, 14, y);
  y += 7;
  doc.setFontSize(9);

  if (payments.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Aucun paiement enregistré sur cette période.', 14, y);
    y += 8;
  } else {
    for (const p of payments.slice(0, 15)) {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(sanitizePdfText(`${formatDateFr(p.paidAt)} · ${p.debtorName} (${PAYMENT_METHOD_LABELS[p.method]})`), 14, y);
      doc.setFont('helvetica', 'bold');
      doc.text(sanitizePdfText(formatFcfa(p.amount)), 196, y, { align: 'right' });
      y += 6;
    }
  }

  y += 6;
  if (y > 250) {
    doc.addPage();
    y = 20;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`Principaux impayés en retard (${overdueDebts.length})`, 14, y);
  y += 7;
  doc.setFontSize(9);

  for (const d of overdueDebts.slice(0, 15)) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(sanitizePdfText(`${d.debtorName} · Échéance ${formatDateFr(d.dueDate)}`), 14, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(185, 28, 28);
    doc.text(sanitizePdfText(formatFcfa(d.remainingAmount)), 196, y, { align: 'right' });
    y += 6;
  }

  doc.save(`rapport-payreminder-${monthKey}.pdf`);
}
