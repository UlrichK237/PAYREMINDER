import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, '../firebase-applet-config.json');

interface FirebaseAppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
}

function loadAppletConfig(): FirebaseAppletConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as FirebaseAppletConfig;
}

const appletConfig = loadAppletConfig();

function resolveCredential() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson) as ServiceAccount;
    return cert(parsed);
  }
  return applicationDefault();
}

export const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      credential: resolveCredential(),
      ...(appletConfig.projectId ? { projectId: appletConfig.projectId } : {}),
    });

export const adminAuth = getAuth(adminApp);

const databaseId = appletConfig.firestoreDatabaseId?.trim();
export const adminDb =
  databaseId && databaseId !== '(default)'
    ? getFirestore(adminApp, databaseId)
    : getFirestore(adminApp);

export { FieldValue };
