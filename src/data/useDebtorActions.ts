import type React from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  AuditLogEntry,
  Debt,
  Debtor,
  MessageLog,
  Payment,
  Reminder,
  Tenant,
} from '../types/payreminder';
import { PLANS } from '../utils/plans';
import { validateDebtorInput } from '../utils/validation';
import { getAuthHeaders, makeId } from './helpers';
import type { DataContextValue } from './types';

interface UseDebtorActionsDeps {
  tenant: Tenant | null;
  debtors: Debtor[];
  demoMode: boolean;
  actorUid: string;
  setDebtors: React.Dispatch<React.SetStateAction<Debtor[]>>;
  setRawDebts: React.Dispatch<React.SetStateAction<Debt[]>>;
  setPayments: React.Dispatch<React.SetStateAction<Payment[]>>;
  setReminders: React.Dispatch<React.SetStateAction<Reminder[]>>;
  setMessageLogs: React.Dispatch<React.SetStateAction<MessageLog[]>>;
  setAuditLogs: React.Dispatch<React.SetStateAction<AuditLogEntry[]>>;
}

export function useDebtorActions(deps: UseDebtorActionsDeps) {
  const {
    tenant,
    debtors,
    demoMode,
    actorUid,
    setDebtors,
    setRawDebts,
    setPayments,
    setReminders,
    setMessageLogs,
    setAuditLogs,
  } = deps;

  const createDebtor: DataContextValue['createDebtor'] = async (input) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    if (!input.consentConfirmed) {
      throw new Error('Confirmez avoir le droit de contacter cette personne au sujet de cette créance.');
    }
    if (debtors.length >= tenant.maxDebtors) {
      throw new Error(
        `Limite atteinte : votre forfait ${PLANS[tenant.plan].name} autorise ${tenant.maxDebtors} débiteurs maximum. Passez au forfait supérieur.`
      );
    }

    const check = validateDebtorInput(input);
    if (!check.ok) throw new Error(check.error);

    const id = makeId('deb');
    const nowIso = new Date().toISOString();
    const newDebtor: Debtor = {
      id,
      tenantId: tenant.id,
      name: input.name.trim(),
      phone: check.normalizedPhone,
      preferredChannel: PLANS[tenant.plan].whatsappEnabled ? input.preferredChannel : 'sms',
      note: input.note.trim(),
      optOut: false,
      reliabilityScore: 80,
      consentConfirmedAt: nowIso,
      consentConfirmedBy: actorUid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (demoMode) {
      setDebtors((prev) => [newDebtor, ...prev]);
      return id;
    }

    try {
      await setDoc(doc(db, 'tenants', tenant.id, 'debtors', id), {
        tenantId: tenant.id,
        name: newDebtor.name,
        phone: newDebtor.phone,
        preferredChannel: newDebtor.preferredChannel,
        note: newDebtor.note,
        optOut: false,
        reliabilityScore: 80,
        consentConfirmedAt: nowIso,
        consentConfirmedBy: actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `tenants/${tenant.id}/debtors/${id}`);
    }
  };

  const updateDebtor: DataContextValue['updateDebtor'] = async (id, patch) => {
    if (!tenant) return;
    if (demoMode) {
      setDebtors((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d))
      );
      return;
    }

    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.name !== undefined) payload.name = patch.name.trim().slice(0, 120);
    if (patch.phone !== undefined) payload.phone = patch.phone.trim();
    if (patch.preferredChannel !== undefined) payload.preferredChannel = patch.preferredChannel;
    if (patch.note !== undefined) payload.note = patch.note.trim().slice(0, 500);
    if (patch.optOut !== undefined) payload.optOut = patch.optOut;
    if (patch.reliabilityScore !== undefined) payload.reliabilityScore = patch.reliabilityScore;
    if (patch.promiseDate !== undefined && patch.promiseDate !== '') payload.promiseDate = patch.promiseDate;

    try {
      await updateDoc(doc(db, 'tenants', tenant.id, 'debtors', id), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tenants/${tenant.id}/debtors/${id}`);
    }
  };

  const deleteDebtor: DataContextValue['deleteDebtor'] = async (id) => {
    if (!tenant) return;
    if (demoMode) {
      setDebtors((prev) => prev.filter((d) => d.id !== id));
      return;
    }
    try {
      await deleteDoc(doc(db, 'tenants', tenant.id, 'debtors', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tenants/${tenant.id}/debtors/${id}`);
    }
  };

  const eraseDebtorData: DataContextValue['eraseDebtorData'] = async (debtorId) => {
    if (!tenant) throw new Error('Entreprise introuvable.');

    if (demoMode) {
      const nowIso = new Date().toISOString();
      setDebtors((prev) => prev.filter((d) => d.id !== debtorId));
      setRawDebts((prev) => prev.filter((d) => d.debtorId !== debtorId));
      setPayments((prev) => prev.filter((p) => p.debtorId !== debtorId));
      setReminders((prev) => prev.filter((r) => r.debtorId !== debtorId));
      setMessageLogs((prev) => prev.filter((m) => m.debtorId !== debtorId));
      setAuditLogs((prev) => [
        {
          id: makeId('audit'),
          tenantId: tenant.id,
          action: 'debtor_erase',
          actorUid,
          targetId: debtorId,
          summary: 'Effacement complet du débiteur et de son historique (mode démo)',
          createdAt: nowIso,
        },
        ...prev,
      ]);
      return;
    }

    const headers = await getAuthHeaders();
    const resp = await fetch('/api/debtors/erase', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tenantId: tenant.id,
        debtorId,
      }),
    });
    const data = (await resp.json()) as { ok?: boolean; error?: string };
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || 'Impossible d’effacer les données du débiteur.');
    }
  };

  const bulkImportDebtors: DataContextValue['bulkImportDebtors'] = async (rows, consentConfirmed) => {
    if (!tenant) throw new Error('Entreprise introuvable.');
    if (!consentConfirmed) {
      throw new Error('Confirmez avoir le droit de contacter les personnes importées au sujet de leurs créances.');
    }
    const availableSlots = Math.max(0, tenant.maxDebtors - debtors.length);
    if (rows.length > availableSlots) {
      throw new Error(
        `Import bloqué : il vous reste ${availableSlots} place(s) sur votre forfait ${PLANS[tenant.plan].name}.`
      );
    }

    const nowIso = new Date().toISOString();
    const created: Debtor[] = [];
    const batch = demoMode ? null : writeBatch(db);

    for (const r of rows) {
      const check = validateDebtorInput(r);
      if (!check.ok) continue;
      const id = makeId('deb');
      const item: Debtor = {
        id,
        tenantId: tenant.id,
        name: r.name.trim(),
        phone: check.normalizedPhone,
        preferredChannel: PLANS[tenant.plan].whatsappEnabled ? r.preferredChannel : 'sms',
        note: r.note.trim(),
        optOut: false,
        reliabilityScore: 80,
        consentConfirmedAt: nowIso,
        consentConfirmedBy: actorUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      created.push(item);
      if (batch) {
        batch.set(doc(db, 'tenants', tenant.id, 'debtors', id), {
          tenantId: tenant.id,
          name: item.name,
          phone: item.phone,
          preferredChannel: item.preferredChannel,
          note: item.note,
          optOut: false,
          reliabilityScore: 80,
          consentConfirmedAt: nowIso,
          consentConfirmedBy: actorUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (demoMode) {
      setDebtors((prev) => [...created, ...prev]);
      return created.length;
    }

    if (batch && created.length > 0) {
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `tenants/${tenant.id}/debtors`);
      }
    }
    return created.length;
  };

  return {
    createDebtor,
    updateDebtor,
    deleteDebtor,
    eraseDebtorData,
    bulkImportDebtors,
  };
}
