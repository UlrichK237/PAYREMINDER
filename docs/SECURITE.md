# Architecture de sécurité — PayReminder

## Principe directeur : Zéro confiance côté navigateur

**Règle absolue : le client n'envoie jamais `plan`, `montant`, `numéro` ni `texte de message`.**

Toute décision critique liée à la facturation, aux quotas, au moteur de relances (manuel ou planifié), aux liens Mobile Money, à la vérification téléphonique, à la confirmation des paiements et à l'effacement RGPD des débiteurs est prise exclusivement côté serveur dans `server/app.ts` et `server/services/*` à partir des données lues dans Firestore via `firebase-admin` (`server/firebaseAdmin.ts`).

---

## Inventaire complet des routes serveur (`server/app.ts`)

| Méthode & Route | Protection | Description |
| --- | --- | --- |
| `GET /api/config/capabilities` | Public (aucun secret exposé) | Indique les capacités actives (`whatsappConfigured`, `smsConfigured`, `simulationMode`, `simulationRoutes`, `timezone`) |
| `POST /api/billing/checkout` | `requireAuth` + `requireTenantOwner` + `uidRateLimiter` | Crée un paiement d'abonnement `pending` avec le prix officiel `PLANS` |
| `POST /api/billing/change-plan` | `requireNonProduction` (`404` en prod) + `requireAuth` + `requireTenantOwner` + `uidRateLimiter` | Changement de forfait dev uniquement si `ALLOW_PLAN_CHANGE_WITHOUT_PAYMENT=true` + log `auditLogs` |
| `POST /api/debtors/erase` | `requireAuth` + `requireTenantOwner` + `uidRateLimiter` | Effacement complet RGPD du débiteur, dettes, paiements, relances, messageLogs + conservation `suppressions` si opt-out + trace `auditLogs` |
| `POST /api/security/send-phone-code` | `requireAuth` + `requireTenantOwner` + `phoneCodeIpRateLimiter` (10/h via `ipKeyGenerator(req.ip)`, `TRUST_PROXY_HOPS`) + `phoneCodeRateLimiter` (3/h) | Génère un code OTP HMAC-SHA256 (`OTP_PEPPER`) dans `tenantSecurityPrivate` et applique un plafond global cross-tenant dans `otpDestinations` (max 3/h et 5/24h par numéro, préfixe `ALLOWED_PHONE_PREFIXES`) |
| `POST /api/security/verify-phone-code` | `requireAuth` + `requireTenantOwner` + `uidRateLimiter` | Vérifie le code OTP (max 5 essais), active `phoneVerified` + `phoneVerifiedNumber` + trace `auditLogs` |
| `POST /api/reminders/dispatch` | `requireAuth` + `requireTenantMember` + `uidRateLimiter` | Envoi manuel via `sendReminderForDebt` + trace `auditLogs` (`manual_reminder`) |
| `POST /api/payments/create-link` | `requireAuth` + `requireTenantMember` + `uidRateLimiter` | Génère un lien Mobile Money depuis `remainingAmount` lu en base |
| `POST /api/reports/send-tenant-email` | `requireAuth` + `requireTenantMember` + `uidRateLimiter` | Envoie le rapport mensuel de l'entreprise (forfaits Pro/Business, HTML échappé) |
| `POST /api/simulate/whatsapp-inbound` | `requireSimulationRoutesEnabled` (`404` en prod) + `requireAuth` + `requireTenantMember` + `uidRateLimiter` | Simule un message entrant WhatsApp (STOP / promesse) |
| `POST /api/simulate/payment` | `requireSimulationRoutesEnabled` (`404` en prod) + `requireAuth` + `requireTenantMember` + `uidRateLimiter` | Simule un paiement Mobile Money sur une dette |
| `POST /api/simulate/subscription-payment` | `requireSimulationRoutesEnabled` (`404` en prod) + `requireAuth` + `requireTenantOwner` + `uidRateLimiter` | Simule la confirmation d'un paiement d'abonnement |
| `GET /api/webhooks/whatsapp` | Vérification `hub.verify_token` en temps constant | Validation initiale du webhook Meta WhatsApp |
| `POST /api/webhooks/whatsapp` | Signature HMAC-SHA256 (`x-hub-signature-256` / `WHATSAPP_APP_SECRET`) | Statuts de livraison + messages entrants (`STOP`, promesses) |
| `POST /api/webhooks/payment` | Signature HMAC-SHA256 (`PAYMENT_WEBHOOK_SECRET`) | Paiement créance idempotent (rejette `metadata.type === "subscription"`) |
| `POST /api/webhooks/subscription-payment` | Signature HMAC-SHA256 (`PAYMENT_WEBHOOK_SECRET`) | Activation abonnement uniquement sur montant exact + trace `auditLogs` |
| `POST /api/cron/run-reminders` | `requireCronSecret` (`x-cron-secret`, `503` si vide) | Relances automatiques (verrou 15 min `cronLocks`, budget 50 s, concurrence 5) |
| `POST /api/cron/subscriptions` | `requireCronSecret` (`x-cron-secret`, `503` si vide) | Rappels J-5, grâce 3 jours puis retour au forfait Gratuit |
| `POST /api/reports/send-monthly` | `requireCronSecret` (`x-cron-secret`, `503` si vide) | Envoi planifié des rapports mensuels (Pro/Business, HTML échappé) |

---

## Règles de sécurité Firestore (`firestore.rules`)

| Collection | Lecture (`get` / `list`) | Écriture client (`create` / `update` / `delete`) |
| --- | --- | --- |
| `/userProfiles/{uid}` | Utilisateur lui-même (`uid == request.auth.uid`, email vérifié) | Création/MAJ limitée à son propre `uid` |
| `/tenantInvites/{inviteId}` | Propriétaire du tenant ou invité correspondant | Création/MAJ/suppression par le propriétaire uniquement |
| `/tenants/{tenantId}` | Membres actifs (`isTenantMember`) | Création gratuite atomique avec `users/{uid}` ; MAJ par le propriétaire **sans toucher aux champs privilégiés** (`plan`, `maxDebtors`, `maxRemindersPerMonth`, `maxRemindersPerDay`, `planExpiresAt`, `planStatus`, `remindersUsedThisMonth`, `quotaResetMonth`) ; suppression interdite |
| `/tenants/{tenantId}/users/{uid}` | Membres actifs | Propriétaire (ou création initiale par `ownerId`) ; rétrogradation/suppression du propriétaire interdite |
| `/tenants/{tenantId}/debtors/{debtorId}` | Membres actifs | Membres actifs ; création soumise au format E.164 et à la preuve de consentement ; `optOut` irréversible (`true -> false` refusé) |
| `/tenants/{tenantId}/debts/{debtId}` | Membres actifs | Membres actifs (montants cohérents, `debtorId` existant dans le même tenant) ; champs serveur `appliedRuleOffsets` / `ruleReminderCounts` / `ruleLastSentAt` protégés |
| `/tenants/{tenantId}/payments/{paymentId}` | Membres actifs | Création par membres actifs (montant > 0), modification/suppression client interdites |
| `/tenants/{tenantId}/reminderRules/{ruleId}` | Membres actifs | Propriétaire uniquement (`isTenantOwnerAfter` lors de l'initialisation) |
| `/tenants/{tenantId}/messageTemplates/{templateId}` | Membres actifs | Propriétaire uniquement (`isTenantOwnerAfter` lors de l'initialisation) |
| `/tenants/{tenantId}/reminders/{reminderId}` | Membres actifs | **Interdite côté client** (écriture serveur `firebase-admin` uniquement) |
| `/tenants/{tenantId}/messageLogs/{logId}` | Membres actifs | **Interdite côté client** (écriture serveur `firebase-admin` uniquement) |
| `/tenants/{tenantId}/suppressions/{phoneHash}` | **Interdite côté client** | **Interdite côté client** (liste d'opposition STOP HMAC serveur uniquement) |
| `/tenants/{tenantId}/debtorSendState/{debtorId}` | Membres actifs | **Interdite côté client** (état glissant 7 jours écrit atomiquement par le serveur) |
| `/tenants/{tenantId}/billing/{paymentRef}` | Propriétaire uniquement | **Interdite côté client** (serveur uniquement) |
| `/tenants/{tenantId}/paymentAnomalies/{anomalyId}` | Propriétaire uniquement | **Interdite côté client** (serveur uniquement) |
| `/tenants/{tenantId}/auditLogs/{logId}` | Propriétaire uniquement | **Interdite côté client** (serveur uniquement) |
| `/tenantSecurity/{tenantId}` | `get` par membres actifs (`list` interdit) | **Interdite côté client** (`dailyUsage`, `phoneVerified`, `phoneVerifiedAt`, `phoneVerifiedNumber` uniquement) |
| `/tenantSecurityPrivate/{tenantId}` | **Interdite côté client** | **Interdite côté client** (secrets OTP, sel/hash, compteurs anti SMS-pumping, états abonnement) |
| `/otpDestinations/{phoneDestHash}` | **Interdite côté client** | **Interdite côté client** (plafond global cross-tenant 3/h et 5/24h par numéro, TTL `expiresAt` à `+2 jours`) |
| `/cronLocks/{lockId}` | **Interdite côté client** | **Interdite côté client** (verrous + curseur d'équité avec TTL `expiresAt` à 7 jours) |

---

## Journalisation, confidentialité et anti-abus

- **Journalisation structurée (`server/logger.ts`, Pino)** : aucun `console.*` côté serveur ; les numéros de téléphone sont automatiquement masqués (`***456`) et les jetons/secrets (`authorization`, `cronSecret`, signatures, `apiKey`, `devCode`) sont remplacés par `[REDACTED]`.
- **Gestion d'erreurs JSON stricte** : toute erreur HTTP (`400` JSON malformé, `413` > 100 Ko, `404` `/api/*`, `500` interne) renvoie du JSON avec `errorId` sans jamais exposer de HTML ni de pile d'exécution.
- **Moteur unifié de relances (`server/services/reminderService.ts`)** : applique atomiquement dans une transaction Firestore le délai 24 h par dette, le plafond 3 relances / 7 jours par débiteur (`debtorSendState`), la liste d'opposition irréversible (`suppressions`), le plafond journalier, le quota mensuel (avec rollback complet en cas d'échec fournisseur), `phoneVerified && phoneVerifiedNumber === tenant.phone`, et la mention `"Répondez STOP pour ne plus recevoir de messages."` sur tout SMS/repli.
- **Validation des modèles (`src/utils/templateValidation.ts`)** : bloque URLs externes, variables inconnues et termes d'intimidation côté client et serveur.
- **Tâches planifiées (Cloud Scheduler)** : exécutées via `CRON_SECRET` avec comparaison en temps constant, requête optimisée `collectionGroup('debts')`, rattrapage initial J+0..J+3 puis répétitions espacées d'au moins 48 h jusqu'à `maxReminders` (`appliedRuleOffsets` / `ruleReminderCounts` / `ruleLastSentAt`), curseur d'équité (`run-reminders-cursor`), verrous `cronLocks` (TTL 7 j) et budget d'exécution de 50 s.

---

## Vérification automatisée

```bash
npm run lint        # TypeScript + ESLint firestore.rules
npm test            # Tests unitaires & tests d'intégration routes Express
npm run test:rules  # Tests réels sur émulateur Firestore (Java 21 requis)
npm run test:all    # Exécution complète
```
