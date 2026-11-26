# PayReminder — Suivi des dettes clients & relances automatisées (Cameroun)

**PayReminder** est une plateforme SaaS multi-tenant en français conçue pour les commerçants, écoles et PME au Cameroun afin de suivre les créances en **FCFA (XAF)**, automatiser les relances **WhatsApp** et **SMS**, encaisser par **Mobile Money** (MTN MoMo / Orange Money) et éditer des reçus et rapports PDF.

---

## Architecture globale

```
+----------------------------+        HTTPS (Bearer ID Token)       +-----------------------------------+
|   Navigateur (React SPA)   | -----------------------------------> |  Serveur Express (server/app.ts)  |
|   Vite + Tailwind + Auth   | <----------------------------------- |  Helmet · Rate Limit · Pino · HMAC|
+----------------------------+        JSON (sans clés API)          +-----------------------------------+
              |                                                                   |          |
              | SDK Client (règles Firestore strictes)                            |          |
              v                                                                   v          v
+--------------------------------------------------------+       +---------------------+  +-----------------------+
|              Firebase Auth & Firestore                 |       | Fournisseurs API    |  | Planificateur externe |
|  tenants/{tenantId}/(debtors, debts, payments, ...)    |       | WhatsApp Cloud API  |  | Cloud Scheduler / Cron|
|  tenantSecurity · auditLogs · billing · cronLocks      |       | Agrégateur SMS      |  | (x-cron-secret)       |
+--------------------------------------------------------+       | Mobile Money / Email|  +-----------------------+
                                                                 +---------------------+
```

---

## Prérequis & Installation

- **Node.js 22+**
- **Java 21+** (uniquement pour exécuter l'émulateur Firestore lors de `npm run test:rules`)

```bash
npm install
cp .env.example .env
```

---

## Variables d'environnement principales

Toutes les clés secrètes restent exclusivement côté serveur (aucun préfixe `VITE_` pour les secrets). Consultez [`.env.example`](.env.example) :

| Variable | Rôle |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Compte de service Firebase Admin JSON (sinon `applicationDefault()`) |
| `CRON_SECRET` | Secret obligatoire (`x-cron-secret`) pour les routes `/api/cron/*` et `/api/reports/send-monthly` |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Envoi WhatsApp Cloud API + signature HMAC webhooks Meta |
| `SMS_PROVIDER_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` | Agrégateur SMS Cameroun (repli automatique ou canal principal) |
| `PAYMENT_PROVIDER_URL`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | Génération de liens Mobile Money + signature HMAC webhooks paiement |
| `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS` | Rapports mensuels et notifications cycle de vie abonnement |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | Observabilité Sentry optionnelle (serveur et navigateur) |

> Si les clés WhatsApp/SMS/Paiement sont laissées vides, PayReminder fonctionne automatiquement en **mode simulation** sans appel externe réel.

---

## Lancement

```bash
# Développement (Express + Vite middlewares sur le port 3000)
npm run dev

# Build production (client Vite)
npm run build

# Démarrage production
npm start
```

---

## Tests & Qualité

```bash
# Vérification TypeScript + lint des règles Firestore
npm run lint

# Tests unitaires et tests d'intégration API Express (Vitest + Supertest)
npm test

# Tests des règles de sécurité Firestore sur émulateur local (nécessite Java 21)
npm run test:rules

# Suite complète (lint + build + tests unitaires/API + tests règles Firestore)
npm run test:all
```

---

## Documentation complémentaire

- [Guide de déploiement & tâches planifiées](docs/DEPLOIEMENT.md)
- [Architecture de sécurité, routes & matrice Firestore](docs/SECURITE.md)
