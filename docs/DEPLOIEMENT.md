# Guide de déploiement — PayReminder

PayReminder repose sur une architecture unifiée : **une application React (Vite)** servie par **un serveur Express unique (`server.ts`)** connecté à **Firebase Auth + Firestore (Admin SDK)**. Le moteur de relances, la facturation et les webhooks sont centralisés sur ce serveur.

---

## 1. Variables d'environnement requises

Configurez ces variables sur votre plateforme d'hébergement (Cloud Run, VPS Node.js, Railway, Render…) — **ne préfixez jamais ces variables par `VITE_`** et ne les placez jamais dans `src/`.

| Variable | Obligatoire | Rôle |
| :--- | :--- | :--- |
| `NODE_ENV` | Oui (en prod) | Fixée à `production` par `npm run start` (`NODE_ENV=production tsx server.ts`). |
| `PORT` | Non | Port HTTP d'écoute du serveur (défaut `3000`). |
| `APP_URL` | Oui | URL publique HTTPS de l'application (ex. `https://app.payreminder.cm`). |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Recommandée | JSON complet du compte de service Firebase Admin (repli sur `applicationDefault` si vide sur GCP/Cloud Run). |
| `CRON_SECRET` | **Oui** | Secret aléatoire fort (>= 32 octets) exigé dans l'en-tête `x-cron-secret` des tâches planifiées. Retourne `503` si vide. |
| `OTP_PEPPER` | **Oui (en prod)** | Secret HMAC-SHA256 (>= 32 octets) pour le hachage des codes OTP et des numéros en liste d'opposition (`suppressions`). Retourne `503` si vide en production. |
| `ALLOWED_PHONE_PREFIXES` | Non (`+237`) | Liste d'indicatifs autorisés (séparés par virgule) pour l'envoi de codes SMS OTP anti-pumping (défaut `+237`). |
| `TRUST_PROXY_HOPS` | Non (`1` prod / `0` dev) | Nombre entier exact de proxys inverses devant l'application (`app.set('trust proxy', n)`). À régler selon l'infrastructure réelle (ex. `1` derrière Cloud Run / Nginx), **jamais à `true`**. |
| `WHATSAPP_ACCESS_TOKEN` | Optionnel | Jeton d'accès Meta WhatsApp Cloud API (mode simulation si vide). |
| `WHATSAPP_PHONE_NUMBER_ID` | Optionnel | ID du numéro WhatsApp Business Meta. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Oui (si WhatsApp) | Jeton de vérification GET `/api/webhooks/whatsapp`. |
| `WHATSAPP_APP_SECRET` | **Oui (en prod)** | Secret Meta utilisé pour vérifier `X-Hub-Signature-256` (HMAC-SHA256) sur `/api/webhooks/whatsapp`. |
| `SMS_PROVIDER_URL` | Optionnel | Endpoint REST de l'agrégateur SMS Cameroun (Camoo, Nexah, Orange SMS, etc.). |
| `SMS_API_KEY` | Optionnel | Clé API de l'agrégateur SMS. |
| `SMS_SENDER_ID` | Optionnel | Nom d'expéditeur affiché (`PayReminder`). |
| `PAYMENT_PROVIDER_URL` | Optionnel | Endpoint REST Mobile Money (NotchPay, CinetPay, Campay, Monetbil…). |
| `PAYMENT_API_KEY` | Optionnel | Clé API Mobile Money pour générer les liens de paiement dettes & abonnements. |
| `PAYMENT_WEBHOOK_SECRET` | **Oui (en prod)** | Secret HMAC-SHA256 vérifiant `/api/webhooks/payment` et `/api/webhooks/subscription-payment`. |
| `EMAIL_PROVIDER_API_KEY` | Optionnel | Clé API Resend pour les rapports mensuels et rappels d'expiration d'abonnement. |
| `EMAIL_FROM_ADDRESS` | Optionnel | Adresse d'expédition (ex. `rapports@payreminder.cm`). |
| `ENABLE_SIMULATION_ROUTES` | Non (`false`) | Doit rester absent ou `"false"` en production (`404` sur `/api/simulate/*`). |
| `ALLOW_PLAN_CHANGE_WITHOUT_PAYMENT` | Non | Ignoré en production (`/api/billing/change-plan` retourne `404` dès que `NODE_ENV=production` ou `K_SERVICE` est défini). |

---

## 2. Configuration des tâches planifiées (Cron)

Le serveur Express expose **3 routes HTTP POST** protégées par `x-cron-secret: <CRON_SECRET>`. Configurez-les via **Google Cloud Scheduler** (recommandé) ou **cron-job.org** avec le fuseau horaire **`Africa/Douala`**.

| Tâche | Méthode & URL | Fréquence / Expression Cron | Fuseau horaire | Rôle |
| :--- | :--- | :--- | :--- | :--- |
| **Moteur de relances** | `POST /api/cron/run-reminders` | Toutes les 15 minutes (`*/15 * * * *`) | `Africa/Douala` | Évalue les `reminderRules` actives, respecte heures calmes, quotas et anti-harcèlement (verrou `cronLocks` par quart d'heure, concurrence max 5, arrêt propre à 50 s). |
| **Cycle abonnements** | `POST /api/cron/subscriptions` | Tous les jours à 02h00 (`0 2 * * *`) | `Africa/Douala` | Envoie un rappel 5 j avant expiration, passe en `grace` (3 j) à l'échéance, puis rétrograde vers `free`. |
| **Rapports mensuels** | `POST /api/reports/send-monthly` | Le 1er de chaque mois à 08h00 (`0 8 1 * *`) | `Africa/Douala` | Envoie par email le récapitulatif mensuel aux entreprises `Pro` et `Business`. |

### Exemples de création avec Google Cloud Scheduler (`gcloud`)

```bash
# 1. Relances automatiques toutes les 15 minutes
gcloud scheduler jobs create http payreminder-run-reminders \
  --location=europe-west1 \
  --schedule="*/15 * * * *" \
  --time-zone="Africa/Douala" \
  --uri="https://VOTRE_DOMAINE/api/cron/run-reminders" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-cron-secret=VOTRE_CRON_SECRET" \
  --message-body="{}"

# 2. Gestion des abonnements chaque nuit à 02h00
gcloud scheduler jobs create http payreminder-subscriptions \
  --location=europe-west1 \
  --schedule="0 2 * * *" \
  --time-zone="Africa/Douala" \
  --uri="https://VOTRE_DOMAINE/api/cron/subscriptions" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-cron-secret=VOTRE_CRON_SECRET" \
  --message-body="{}"

# 3. Rapports mensuels le 1er du mois à 08h00
gcloud scheduler jobs create http payreminder-monthly-reports \
  --location=europe-west1 \
  --schedule="0 8 1 * *" \
  --time-zone="Africa/Douala" \
  --uri="https://VOTRE_DOMAINE/api/reports/send-monthly" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-cron-secret=VOTRE_CRON_SECRET" \
  --message-body="{}"
```

### Exemples de test manuel avec `curl`

```bash
# 1. Déclencher le moteur de relances
curl -X POST "https://VOTRE_DOMAINE/api/cron/run-reminders" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: VOTRE_CRON_SECRET" \
  -d "{}"

# 2. Déclencher la vérification quotidienne des abonnements
curl -X POST "https://VOTRE_DOMAINE/api/cron/subscriptions" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: VOTRE_CRON_SECRET" \
  -d "{}"

# 3. Déclencher l'envoi des rapports mensuels
curl -X POST "https://VOTRE_DOMAINE/api/reports/send-monthly" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: VOTRE_CRON_SECRET" \
  -d "{}"
```

### Politiques TTL Firestore (`cronLocks` et `otpDestinations`)

Les documents `cronLocks/*` (`expiresAt` à `+7 jours`) et `otpDestinations/*` (compteurs globaux anti SMS-pumping par numéro, `expiresAt` à `+2 jours`) incluent un champ `expiresAt` (Timestamp Firestore). Activez une politique **Time-to-live (TTL)** sur chaque collection afin que Firestore purge automatiquement les documents expirés :

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=cronLocks \
  --enable-ttl \
  --database=VOTRE_DATABASE_ID

gcloud firestore fields ttls update expiresAt \
  --collection-group=otpDestinations \
  --enable-ttl \
  --database=VOTRE_DATABASE_ID
```

---

## 3. Configuration des Webhooks

### WhatsApp Cloud API (Meta)
- **URL de callback (GET & POST)** : `https://VOTRE_DOMAINE/api/webhooks/whatsapp`
- **Verify Token (challenge GET)** : valeur exacte de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- **Signature POST** : en-tête `X-Hub-Signature-256` signé avec `WHATSAPP_APP_SECRET` (HMAC-SHA256 sur le corps JSON brut).
- **Champs à abonner** : `messages` (réponses `STOP` / promesses de paiement + statuts `sent`, `delivered`, `read`, `failed`).

### Agrégateur Mobile Money — Paiement des dettes clients
- **URL de webhook (POST)** : `https://VOTRE_DOMAINE/api/webhooks/payment`
- **En-tête de signature** : `x-payment-signature` (ou `x-hub-signature-256`) = `sha256=<HMAC_HEX>` calculé avec `PAYMENT_WEBHOOK_SECRET` sur le corps brut.
- **Corps attendu** : `{ "tenantId": "...", "debtId": "...", "amount": 15000, "method": "mtn_momo", "transactionRef": "TX-..." }`
- *Note* : tout payload avec `metadata.type === "subscription"` est refusé sur cette route.

### Agrégateur Mobile Money — Paiement des abonnements SaaS
- **URL de webhook (POST)** : `https://VOTRE_DOMAINE/api/webhooks/subscription-payment`
- **En-tête de signature** : `x-payment-signature` (ou `x-hub-signature-256`) = `sha256=<HMAC_HEX>` calculé avec `PAYMENT_WEBHOOK_SECRET` sur le corps brut.
- **Corps attendu** : `{ "tenantId": "...", "paymentRef": "abo_...", "amount": 5000, "method": "mtn_momo", "transactionRef": "TX-ABO-...", "metadata": { "type": "subscription" } }`

---

## 4. Build et démarrage en production

```bash
npm install --no-audit --no-fund
npm run build
npm run start
```

