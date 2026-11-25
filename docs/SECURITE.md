# Architecture de sécurité — PayReminder

## Principe directeur : Zéro confiance côté navigateur

**Règle absolue : le client n'envoie jamais `plan`, `montant`, `numéro` ni `texte de message`.**

Toute décision critique liée à la facturation, aux quotas, à l'envoi de relances, aux liens Mobile Money et à la confirmation des paiements est prise exclusivement côté serveur à partir des données lues dans Firestore via `firebase-admin` (`server/firebaseAdmin.ts`).

---

## Contrôles d'accès et durcissement

1. **Authentification serveur (`requireAuth`)** :
   - Vérifie le jeton Firebase ID passé dans `Authorization: Bearer <idToken>` via `adminAuth.verifyIdToken(...)`.
   - Exige `email_verified === true` (sinon HTTP `401`).
2. **Isolation multi-tenant (`requireTenantMember` / `requireTenantOwner`)** :
   - Lit `tenants/{tenantId}/users/{uid}` via l'Admin SDK.
   - Exige `status === 'active'` (sinon HTTP `403`).
   - Les actions sensibles de facturation exigent `role === 'owner'` (sinon HTTP `403`).
3. **Limitation de débit & en-têtes HTTP (`server.ts`)** :
   - `helmet` actif sur les réponses serveur.
   - Taille des corps JSON limitée à `100 ko`, avec conservation du tampon brut (`rawBody`) pour la vérification HMAC-SHA256 des webhooks.
   - `express-rate-limit` : maximum **30 requêtes par minute et par `uid`** sur les routes d'envoi, facturation, rapports et paiement.
4. **Règles Firestore (`firestore.rules`)** :
   - Le navigateur ne peut plus modifier `plan`, `maxDebtors`, `maxRemindersPerMonth`, `subscriptionDate`, `remindersUsedThisMonth` ni `quotaResetMonth` sur `tenants/{tenantId}`.
   - Lors de la création d'entreprise (`writeBatch`), `reminderRules` et `messageTemplates` valident le propriétaire via `isTenantOwnerAfter(tenantId)`.

---

## Variables d'environnement et routes associées

| Variable d'environnement | Rôle | Route(s) / Module(s) associé(s) |
| :--- | :--- | :--- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON du compte de service Firebase Admin (repli sur `applicationDefault` si vide) | `server/firebaseAdmin.ts` (toutes les routes `/api/*` utilisant Firestore/Auth Admin) |
| `ALLOW_PLAN_CHANGE_WITHOUT_PAYMENT` | Doit valoir `"true"` uniquement en développement ; sinon retourne `402` | `POST /api/billing/change-plan` |
| `WHATSAPP_ACCESS_TOKEN` | Jeton d'accès Meta WhatsApp Cloud API | `POST /api/reminders/dispatch`, `functions/` |
| `WHATSAPP_PHONE_NUMBER_ID` | Identifiant du numéro WhatsApp Business Meta | `POST /api/reminders/dispatch`, `functions/` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Jeton comparé en temps constant (`timingSafeEqual`) lors du challenge Meta | `GET /api/webhooks/whatsapp` |
| `WHATSAPP_APP_SECRET` | Secret Meta utilisé pour vérifier `X-Hub-Signature-256` (HMAC-SHA256 sur `rawBody` ; rejet `401` si invalide, mode dev toléré uniquement si vide hors production) | `POST /api/webhooks/whatsapp` |
| `SMS_PROVIDER_URL` | Endpoint de l'agrégateur SMS Cameroun | `POST /api/reminders/dispatch`, `functions/` |
| `SMS_API_KEY` | Clé secrète de l'agrégateur SMS | `POST /api/reminders/dispatch`, `functions/` |
| `SMS_SENDER_ID` | Nom d'expéditeur SMS (`PayReminder`) | `POST /api/reminders/dispatch`, `functions/` |
| `PAYMENT_PROVIDER_URL` | Endpoint de l'agrégateur Mobile Money | `POST /api/payments/create-link`, `POST /api/reminders/dispatch` |
| `PAYMENT_API_KEY` | Clé API de l'agrégateur Mobile Money | `POST /api/payments/create-link`, `POST /api/reminders/dispatch` |
| `PAYMENT_WEBHOOK_SECRET` | Secret HMAC-SHA256 (`x-payment-signature` / `x-hub-signature-256`) vérifié sur `rawBody` ; idempotence par `transactionRef` et contrôle du montant contre Firestore | `POST /api/webhooks/payment` |
| `EMAIL_PROVIDER_API_KEY` | Clé API Resend/SMTP pour les rapports mensuels | `POST /api/reports/send-monthly`, `POST /api/reports/send-tenant-email` |
| `EMAIL_FROM_ADDRESS` | Adresse d'expédition des rapports | `POST /api/reports/send-monthly`, `POST /api/reports/send-tenant-email` |
| `CRON_SECRET` | Secret requis dans l'en-tête `x-cron-secret` (`timingSafeEqual`) ; retourne `503` si vide | `POST /api/reports/send-monthly` |

---

## Vérification des règles de sécurité

```bash
npm run test:rules
```
