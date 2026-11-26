import type React from 'react';
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { Debt, Debtor, Payment, Tenant } from '../types/payreminder';
import { computeDebtStatus, getTodayDoualaDate } from '../utils/formatters';
import { validateDebtInput } from '../utils/validation';
import { getAuthHeaders, makeId } from './helpers';
import type { DataContextValue } from './types';

interface UseDebtAndPaymentActionsDeps {
  tenant: Tenant | null;
  debtors: Debtor[];
  debts: Debt[];
  demoMode: boolean;
  actorUid: string;
  setRawDebts: React.Dispatch<React.SetStateAction<Debt[]>>;
  setPayments: React.Dispatch<React.SetStateAction<Payment[]>>;
}

export function useDebtAndPaymentActions(deps: UseDebtAndPaymentActionsDeps) {
  const { tenant, debtors, debts, demoMode, actorUid, setRawDebts, setPayments } = deps;

  const createDebt: DataContextValue['createDebt'] = async (input) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    const check = validateDebtInput(input);
    if (!check.ok) throw new Error(check.error);

    const debtor = debtors.find((d) => d.id === input.debtorId);
    if (!debtor) throw new Error('Débiteur sélectionné introuvable.');

    const id = makeId('det');
    const issuedAt = getTodayDoualaDate();
    const status = computeDebtStatus({
      initialAmount: input.initialAmount,
      remainingAmount: input.initialAmount,
      dueDate: input.dueDate,
      status: 'en_cours',
    });
    const nowIso = new Date().toISOString();

    const newDebt: Debt = {
      id,
      tenantId: tenant.id,
      debtorId: debtor.id,
      debtorName: debtor.name,
      debtorPhone: debtor.phone,
      initialAmount: Math.round(input.initialAmount),
      remainingAmount: Math.round(input.initialAmount),
      issuedAt,
      dueDate: input.dueDate,
      status,
      description: input.description.trim() || 'Créance client',
      reminderCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (demoMode) {
      setRawDebts((prev) => [newDebt, ...prev]);
      return id;
    }

    try {
      await setDoc(doc(db, 'tenants', tenant.id, 'debts', id), {
        tenantId: tenant.id,
        debtorId: newDebt.debtorId,
        debtorName: newDebt.debtorName,
        debtorPhone: newDebt.debtorPhone,
        initialAmount: newDebt.initialAmount,
        remainingAmount: newDebt.remainingAmount,
        issuedAt: newDebt.issuedAt,
        dueDate: newDebt.dueDate,
        status: newDebt.status,
        description: newDebt.description,
        reminderCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `tenants/${tenant.id}/debts/${id}`);
    }
  };

  const cancelDebt: DataContextValue['cancelDebt'] = async (debtId) => {
    if (!tenant) return;
    if (demoMode) {
      setRawDebts((prev) =>
        prev.map((d) => (d.id === debtId ? { ...d, status: 'annulee', updatedAt: new Date().toISOString() } : d))
      );
      return;
    }
    try {
      await updateDoc(doc(db, 'tenants', tenant.id, 'debts', debtId), {
        status: 'annulee',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tenants/${tenant.id}/debts/${debtId}`);
    }
  };

  const recordPayment: DataContextValue['recordPayment'] = async (input) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    const debt = debts.find((d) => d.id === input.debtId);
    if (!debt) throw new Error('Dette introuvable.');
    if (debt.status === 'payee' || debt.status === 'annulee') {
      throw new Error('Cette dette est déjà soldée ou annulée.');
    }

    const amount = Math.round(input.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Montant du paiement invalide.');
    }
    if (amount > debt.remainingAmount) {
      throw new Error('Le montant saisi dépasse le solde restant dû.');
    }

    const newRemaining = debt.remainingAmount - amount;
    const newStatus =
      newRemaining === 0
        ? 'payee'
        : computeDebtStatus({
            initialAmount: debt.initialAmount,
            remainingAmount: newRemaining,
            dueDate: debt.dueDate,
            status: 'partiellement_payee',
          });

    const payId = makeId('pay');
    const nowIso = new Date().toISOString();
    const receiptNumber = `REC-${nowIso.slice(0, 4)}-${Math.floor(1000 + Math.random() * 8999)}`;

    const payment: Payment = {
      id: payId,
      tenantId: tenant.id,
      debtId: debt.id,
      debtorId: debt.debtorId,
      debtorName: debt.debtorName,
      amount,
      paidAt: nowIso,
      method: input.method,
      note: input.note.trim(),
      receiptNumber,
      createdBy: actorUid,
      createdAt: nowIso,
    };

    if (demoMode) {
      setPayments((prev) => [payment, ...prev]);
      setRawDebts((prev) =>
        prev.map((d) =>
          d.id === debt.id ? { ...d, remainingAmount: newRemaining, status: newStatus, updatedAt: nowIso } : d
        )
      );
      return payment;
    }

    const batch = writeBatch(db);
    batch.set(doc(db, 'tenants', tenant.id, 'payments', payId), {
      tenantId: tenant.id,
      debtId: payment.debtId,
      debtorId: payment.debtorId,
      debtorName: payment.debtorName,
      amount: payment.amount,
      paidAt: payment.paidAt,
      method: payment.method,
      note: payment.note,
      receiptNumber: payment.receiptNumber,
      createdBy: payment.createdBy,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'tenants', tenant.id, 'debts', debt.id), {
      remainingAmount: newRemaining,
      status: newStatus,
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return payment;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tenants/${tenant.id}/payments/${payId}`);
    }
  };

  const generatePaymentLink: DataContextValue['generatePaymentLink'] = async (debt) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    if (demoMode) {
      const ref = `DEMO-${debt.id.slice(-4).toUpperCase()}-${Date.now().toString().slice(-4)}`;
      const demoUrl = `${window.location.origin}/dettes?payer=${encodeURIComponent(debt.id)}&ref=${encodeURIComponent(ref)}&montant=${debt.remainingAmount}`;
      setRawDebts((prev) => prev.map((d) => (d.id === debt.id ? { ...d, paymentLink: demoUrl } : d)));
      return demoUrl;
    }

    const headers = await getAuthHeaders();
    const resp = await fetch('/api/payments/create-link', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: tenant.id,
        debtId: debt.id,
      }),
    });
    const data = (await resp.json()) as { paymentUrl?: string; error?: string };
    if (!resp.ok || !data.paymentUrl) {
      throw new Error(data.error || 'Impossible de générer le lien Mobile Money.');
    }
    return data.paymentUrl;
  };

  return {
    createDebt,
    cancelDebt,
    recordPayment,
    generatePaymentLink,
  };
}
