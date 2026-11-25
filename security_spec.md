# Spécification de Sécurité Firestore — PayReminder (Phase 0 TDD)

## 1. Invariants de Données & Isolation Multi-Tenant

1. **Isolation stricte par tenant** : Aucun utilisateur authentifié d'un tenant A ne peut lire, lister, créer, modifier ou supprimer un document appartenant au tenant B (`/tenants/{tenantB}/...`).
2. **Vérification d'identité email** : Toutes les opérations d'écriture et de lecture multi-tenant exigent `request.auth != null && request.auth.token.email_verified == true`.
3. **Intégrité des rôles (RBAC)** : Un utilisateur ne peut pas s'auto-promouvoir `owner` ni rejoindre un tenant arbitraire sans être le créateur initial du tenant (`ownerId == request.auth.uid`) ou détenteur d'une invitation `pending` correspondant à son email vérifié.
4. **Intégrité financière des dettes** : `remainingAmount` doit être compris entre `0` et `initialAmount`. Une dette au statut terminal (`payee` ou `annulee`) est verrouillée contre toute modification client non autorisée.
5. **Immuabilité des champs critiques** : `tenantId`, `ownerId`, `createdAt`, `receiptNumber` sont immuables après création.
6. **Protection PII** : Les numéros de téléphone et emails des débiteurs et membres ne sont jamais lisibles publiquement ni par d'autres tenants.

## 2. Les "Dirty Dozen" Payloads (Tentatives d'Attaque)

1. **Cross-Tenant Read** : Utilisateur du tenant A tente `get(/tenants/tenantB/debtors/d1)` -> `PERMISSION_DENIED`.
2. **Cross-Tenant List** : Utilisateur du tenant A tente `list(/tenants/tenantB/debts)` -> `PERMISSION_DENIED`.
3. **Email Spoofing** : Utilisateur avec `email_verified: false` tente de créer un tenant ou un débiteur -> `PERMISSION_DENIED`.
4. **Role Escalation** : Membre `staff` tente de modifier son document `/tenants/t1/users/{staffUid}` pour passer `role: 'owner'` -> `PERMISSION_DENIED`.
5. **Orphaned Debt** : Création d'une dette avec un `debtorId` inexistant -> `PERMISSION_DENIED`.
6. **Negative / Overflow Amount** : Création d'une dette avec `remainingAmount > initialAmount` ou `initialAmount <= 0` -> `PERMISSION_DENIED`.
7. **Shadow Field Injection** : Création d'un débiteur avec un champ fantôme `isAdmin: true` -> `PERMISSION_DENIED`.
8. **ID Poisoning** : Requête sur un ID de document contenant des caractères invalides ou > 128 caractères -> `PERMISSION_DENIED`.
9. **Terminal State Mutation** : Tentative de réouvrir une dette déjà `payee` en changeant `remainingAmount` -> `PERMISSION_DENIED`.
10. **Quota Tampering by Staff** : Un membre `staff` tente de modifier `plan` ou `maxDebtors` sur `/tenants/{tenantId}` -> `PERMISSION_DENIED`.
11. **Payment Immutability Tampering** : Tentative de modification ou suppression d'un reçu de paiement existant `/tenants/{tenantId}/payments/{id}` -> `PERMISSION_DENIED`.
12. **Uninvited Tenant Join** : Un utilisateur sans invitation valide tente d'écrire son UID dans `/tenants/t1/users/{uid}` -> `PERMISSION_DENIED`.
