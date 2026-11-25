import type { Debt, Debtor, MessageLog, Payment } from '../types/payreminder';
import { computeDebtStatus, getTodayDoualaDate } from './formatters';

function shiftDays(baseYmd: string, deltaDays: number): string {
  const d = new Date(`${baseYmd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export interface DemoDataset {
  key: 'pagnes' | 'ecole';
  businessName: string;
  sector: string;
  debtors: Omit<Debtor, 'tenantId' | 'createdAt' | 'updatedAt'>[];
  debts: Omit<Debt, 'tenantId' | 'createdAt' | 'updatedAt'>[];
  payments: Omit<Payment, 'tenantId' | 'createdAt'>[];
  logs: Omit<MessageLog, 'tenantId' | 'createdAt'>[];
}

export function buildPagnesDemoDataset(userId: string): DemoDataset {
  const today = getTodayDoualaDate();
  const names = [
    { name: 'Marie-Claire Ngo Bell', phone: '+237677142536', ch: 'whatsapp' as const, note: 'Cliente fidèle marché Mboppi', score: 92 },
    { name: 'Chantal Fotso', phone: '+237699284112', ch: 'whatsapp' as const, note: 'Pagne Wax Hollandais x3', score: 78 },
    { name: 'Beatrice Kamga', phone: '+237655319044', ch: 'sms' as const, note: 'Couturière à Bonamoussadi', score: 65 },
    { name: 'Solange Mbarga', phone: '+237678440219', ch: 'whatsapp' as const, note: 'Commande tenue cérémonie', score: 85 },
    { name: 'Carine Ndi', phone: '+237691553870', ch: 'whatsapp' as const, note: 'Acompte versé par MoMo', score: 74 },
    { name: 'Paulette Tchatchoua', phone: '+237674882105', ch: 'sms' as const, note: 'Retard régulier mais paie toujours', score: 60 },
    { name: 'Nadine Etoundi', phone: '+237695119430', ch: 'whatsapp' as const, note: 'Lot de bazin riche', score: 88 },
    { name: 'Sandrine Mballa', phone: '+237672903418', ch: 'whatsapp' as const, note: 'Promesse règlement vendredi', score: 70 },
    { name: 'Viviane Tamo', phone: '+237698774211', ch: 'sms' as const, note: 'Boutique Akwa', score: 52 },
    { name: 'Gisèle Biyong', phone: '+237651203948', ch: 'whatsapp' as const, note: 'Tissu dentelle 6 yards', score: 95 },
    { name: 'Hortense Essomba', phone: '+237670394812', ch: 'whatsapp' as const, note: 'Reste sur lot mariage', score: 45 },
    { name: 'Estelle Ngono', phone: '+237693827164', ch: 'whatsapp' as const, note: 'Cliente régulière Deïdo', score: 82 },
  ];

  const amounts = [45000, 32000, 60000, 25000, 80000, 18000, 55000, 35000, 95000, 22000, 75000, 40000];
  const paidAmounts = [0, 12000, 0, 25000, 30000, 0, 15000, 0, 20000, 22000, 10000, 0];
  const dueOffsets = [-5, -14, -36, -2, -9, -4, 3, -1, -42, -8, -22, 5];

  const debtors: DemoDataset['debtors'] = names.map((c, idx) => ({
    id: `pagne_cli_${idx + 1}`,
    name: c.name,
    phone: c.phone,
    preferredChannel: c.ch,
    note: c.note,
    optOut: idx === 5,
    reliabilityScore: c.score,
    promiseDate: idx === 7 ? shiftDays(today, 3) : undefined,
  }));

  const debts: DemoDataset['debts'] = debtors.map((d, idx) => {
    const initial = amounts[idx];
    const paid = paidAmounts[idx];
    const remaining = initial - paid;
    const dueDate = shiftDays(today, dueOffsets[idx]);
    const issuedAt = shiftDays(dueDate, -20);
    const baseStatus = computeDebtStatus({ initialAmount: initial, remainingAmount: remaining, dueDate, status: 'en_cours' });
    return {
      id: `pagne_debt_${idx + 1}`,
      debtorId: d.id,
      debtorName: d.name,
      debtorPhone: d.phone,
      initialAmount: initial,
      remainingAmount: remaining,
      issuedAt,
      dueDate,
      status: baseStatus,
      description: idx % 2 === 0 ? 'Lot pagnes Wax & accessoires' : 'Tissus Bazin & broderie',
      reminderCount: dueOffsets[idx] < 0 ? 2 : 0,
      lastReminderAt: dueOffsets[idx] < 0 ? `${shiftDays(today, -1)}T10:15:00Z` : undefined,
    };
  });

  const payments: DemoDataset['payments'] = [];
  debts.forEach((debt, idx) => {
    const paid = paidAmounts[idx];
    if (paid > 0) {
      payments.push({
        id: `pagne_pay_${idx + 1}`,
        debtId: debt.id,
        debtorId: debt.debtorId,
        debtorName: debt.debtorName,
        amount: paid,
        paidAt: `${shiftDays(today, -3 - idx)}T14:30:00Z`,
        method: idx % 3 === 0 ? 'mtn_momo' : idx % 3 === 1 ? 'orange_money' : 'especes',
        note: 'Règlement enregistré au comptoir',
        receiptNumber: `REC-2026-0${idx + 10}`,
        createdBy: userId,
      });
    }
  });

  const logs: DemoDataset['logs'] = [
    {
      id: 'pagne_log_1',
      debtId: 'pagne_debt_1',
      debtorId: 'pagne_cli_1',
      debtorName: debtors[0].name,
      debtorPhone: debtors[0].phone,
      direction: 'outbound',
      channel: 'whatsapp',
      tone: 'ferme',
      content: `Bonjour ${debtors[0].name}, votre solde de 45\u00A0000\u00A0FCFA chez Boutique Mama Clarisse est en retard. Merci de régulariser rapidement.`,
      status: 'simule',
      providerMessageId: 'sim_wa_1001',
      detectedIntent: 'none',
    },
    {
      id: 'pagne_log_2',
      debtId: 'pagne_debt_8',
      debtorId: 'pagne_cli_8',
      debtorName: debtors[7].name,
      debtorPhone: debtors[7].phone,
      direction: 'inbound',
      channel: 'whatsapp',
      content: 'Bonjour maman Clarisse, je paie vendredi par MTN MoMo sans faute.',
      status: 'recue',
      providerMessageId: 'in_wa_2002',
      detectedIntent: 'promise',
      promiseDate: shiftDays(today, 3),
    },
    {
      id: 'pagne_log_3',
      debtorId: 'pagne_cli_6',
      debtorName: debtors[5].name,
      debtorPhone: debtors[5].phone,
      direction: 'inbound',
      channel: 'sms',
      content: 'STOP',
      status: 'recue',
      providerMessageId: 'in_sms_3003',
      detectedIntent: 'opt_out',
    },
  ];

  return {
    key: 'pagnes',
    businessName: 'Boutique Mama Clarisse — Pagnes & Tissus',
    sector: 'Commerce / Mode & Tissus',
    debtors,
    debts,
    payments,
    logs,
  };
}

export function buildEcoleDemoDataset(userId: string): DemoDataset {
  const today = getTodayDoualaDate();
  const firstNames = ['Junior', 'Aïcha', 'Brice', 'Divine', 'Kévin', 'Orlane', 'Yannick', 'Cynthia', 'Franck', 'Merveille'];
  const lastNames = ['Nkoa', 'Tchoungui', 'Mbida', 'Fokam', 'Atangana', 'Nguefac', 'Ndongo', 'Kouam', 'Biya', 'Moussa'];

  const debtors: DemoDataset['debtors'] = Array.from({ length: 30 }, (_, idx) => {
    const fn = firstNames[idx % firstNames.length];
    const ln = lastNames[Math.floor(idx / 3) % lastNames.length];
    const parentPhone = `+2376${70 + (idx % 28)}${String(110000 + idx * 7319).slice(0, 6)}`;
    const classes = ['6ème A', '5ème B', '4ème A', '3ème C', '2nde S', '1ère D', 'Tle D'];
    return {
      id: `ecole_eleve_${idx + 1}`,
      name: `${fn} ${ln} (${classes[idx % classes.length]})`,
      phone: parentPhone,
      preferredChannel: idx % 4 === 0 ? 'sms' : 'whatsapp',
      note: `Parent d’élève · Tranche scolarité`,
      optOut: idx === 24,
      reliabilityScore: 50 + ((idx * 7) % 45),
    };
  });

  const debts: DemoDataset['debts'] = debtors.map((d, idx) => {
    const initial = [50000, 75000, 90000, 120000, 65000][idx % 5];
    const paid = idx % 3 === 0 ? 25000 : idx % 5 === 0 ? initial : 0;
    const remaining = initial - paid;
    const dueOffset = [-35, -18, -6, -2, 4, -12, -45, -9, -1, 7][idx % 10];
    const dueDate = shiftDays(today, dueOffset);
    const issuedAt = shiftDays(dueDate, -30);
    return {
      id: `ecole_debt_${idx + 1}`,
      debtorId: d.id,
      debtorName: d.name,
      debtorPhone: d.phone,
      initialAmount: initial,
      remainingAmount: remaining,
      issuedAt,
      dueDate,
      status: computeDebtStatus({ initialAmount: initial, remainingAmount: remaining, dueDate, status: 'en_cours' }),
      description: `2ème tranche frais de scolarité 2026`,
      reminderCount: dueOffset < 0 ? 1 + (idx % 3) : 0,
      lastReminderAt: dueOffset < 0 ? `${shiftDays(today, -2)}T09:00:00Z` : undefined,
    };
  });

  const payments: DemoDataset['payments'] = [];
  debts.forEach((debt, idx) => {
    const paid = debt.initialAmount - debt.remainingAmount;
    if (paid > 0) {
      payments.push({
        id: `ecole_pay_${idx + 1}`,
        debtId: debt.id,
        debtorId: debt.debtorId,
        debtorName: debt.debtorName,
        amount: paid,
        paidAt: `${shiftDays(today, -5 - (idx % 10))}T11:20:00Z`,
        method: idx % 2 === 0 ? 'orange_money' : 'mtn_momo',
        note: 'Versement scolarité parent',
        receiptNumber: `SCO-2026-${100 + idx}`,
        createdBy: userId,
      });
    }
  });

  const logs: DemoDataset['logs'] = [
    {
      id: 'ecole_log_1',
      debtId: 'ecole_debt_1',
      debtorId: 'ecole_eleve_1',
      debtorName: debtors[0].name,
      debtorPhone: debtors[0].phone,
      direction: 'outbound',
      channel: 'whatsapp',
      tone: 'ferme',
      content: `Bonjour parent de ${debtors[0].name}, votre solde de scolarité est en retard. Merci de régulariser à l'économat.`,
      status: 'simule',
      providerMessageId: 'sim_wa_ecole_1',
      detectedIntent: 'none',
    },
  ];

  return {
    key: 'ecole',
    businessName: 'Collège Bilingue Espoir — Douala',
    sector: 'Éducation / Établissement scolaire',
    debtors,
    debts,
    payments,
    logs,
  };
}
