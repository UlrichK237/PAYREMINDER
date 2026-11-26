import type { PaymentProvider } from './services/payment';
import type { SmsProvider } from './services/sms';
import type { WhatsAppSendResult } from './services/whatsapp';
import type { LoggerLike } from './logger';

export interface DocSnapshotLike {
  readonly id: string;
  readonly exists: boolean;
  readonly ref: DocRefLike;
  data(): Record<string, unknown> | undefined;
}

export interface QuerySnapshotLike {
  readonly empty: boolean;
  readonly size: number;
  readonly docs: DocSnapshotLike[];
}

export interface DocRefLike {
  readonly id: string;
  readonly path: string;
  get(): Promise<DocSnapshotLike>;
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface QueryLike {
  where(field: string, op: '==' | 'in', value: unknown): QueryLike;
  limit(n: number): QueryLike;
  get(): Promise<QuerySnapshotLike>;
}

export interface CollectionRefLike extends QueryLike {
  doc(id?: string): DocRefLike;
}

export interface TransactionLike {
  get(ref: DocRefLike): Promise<DocSnapshotLike>;
  set(ref: DocRefLike, data: Record<string, unknown>, options?: { merge?: boolean }): TransactionLike;
  update(ref: DocRefLike, data: Record<string, unknown>): TransactionLike;
  delete(ref: DocRefLike): TransactionLike;
}

export interface WriteBatchLike {
  set(ref: DocRefLike, data: Record<string, unknown>, options?: { merge?: boolean }): WriteBatchLike;
  update(ref: DocRefLike, data: Record<string, unknown>): WriteBatchLike;
  delete(ref: DocRefLike): WriteBatchLike;
  commit(): Promise<unknown>;
}

export interface FirestoreLike {
  doc(path: string): DocRefLike;
  collection(path: string): CollectionRefLike;
  collectionGroup(collectionId: string): QueryLike;
  runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T>;
  batch(): WriteBatchLike;
}

export interface FieldValueLike {
  serverTimestamp(): unknown;
  increment(n: number): unknown;
  delete(): unknown;
}

export interface ServerSecrets {
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  whatsappWebhookVerifyToken: string;
  whatsappAppSecret: string;
  smsProviderUrl: string;
  smsApiKey: string;
  smsSenderId: string;
  paymentProviderUrl: string;
  paymentApiKey: string;
  paymentWebhookSecret: string;
  emailProviderApiKey: string;
  emailFromAddress: string;
  cronSecret: string;
  otpPepper: string;
  allowedPhonePrefixes: string;
  allowPlanChangeWithoutPayment: boolean;
  appBaseUrl: string;
}

export interface DecodedAuthToken {
  uid: string;
  email?: string;
  email_verified?: boolean;
}

export interface EmailSendParams {
  to: string;
  subject: string;
  html: string;
  from: string;
  apiKey: string;
}

export interface AppProviders {
  createPaymentProvider?: (secrets: ServerSecrets) => PaymentProvider;
  createSmsProvider?: (secrets: ServerSecrets) => SmsProvider;
  sendWhatsAppTemplateMessage?: (params: {
    accessToken: string;
    phoneNumberId: string;
    to: string;
    templateName: string;
    variables: string[];
    fallbackBody: string;
  }) => Promise<WhatsAppSendResult>;
  sendEmail?: (params: EmailSendParams) => Promise<{ ok: boolean; status: number; bodyText?: string }>;
}

export interface AppDeps {
  verifyIdToken: (idToken: string) => Promise<DecodedAuthToken>;
  db: FirestoreLike;
  fieldValue: FieldValueLike;
  now?: () => number;
  getSecrets?: () => ServerSecrets;
  isProduction?: boolean;
  simulationRoutesEnabled?: boolean;
  providers?: AppProviders;
  logger?: LoggerLike;
  cronTimeBudgetMs?: number;
  cronMaxConcurrency?: number;
}
