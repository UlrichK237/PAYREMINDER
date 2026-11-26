import pino from 'pino';

export interface LoggerLike {
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}

const SENSITIVE_KEYS = new Set([
  'authorization',
  'token',
  'idtoken',
  'secret',
  'cronsecret',
  'apikey',
  'password',
  'phonehash',
  'phonesalt',
  'devcode',
  'code',
  'x-cron-secret',
  'x-hub-signature-256',
  'x-payment-signature',
  'whatsappaccesstoken',
  'whatsappappsecret',
  'smsapikey',
  'paymentapikey',
  'paymentwebhooksecret',
  'emailproviderapikey',
  'firebaseserviceaccountjson',
]);

const PHONE_KEY_REGEX = /phone|mobile|tel|from|to/i;
const PHONE_VALUE_REGEX = /(\+?[1-9][0-9]{6,15})/g;

export function maskPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 3) return '***';
  return `***${digits.slice(-3)}`;
}

export function sanitizeStringForLogs(input: string): string {
  let out = input.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  out = out.replace(PHONE_VALUE_REGEX, (match) => maskPhoneNumber(match));
  return out;
}

export function sanitizeLogValue(value: unknown, keyHint?: string, depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;

  if (keyHint) {
    const normalizedKey = keyHint.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      return '[REDACTED]';
    }
    if (PHONE_KEY_REGEX.test(keyHint) && typeof value === 'string') {
      return maskPhoneNumber(value);
    }
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeStringForLogs(value.message),
    };
  }

  if (typeof value === 'string') {
    return sanitizeStringForLogs(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeLogValue(item, keyHint, depth + 1));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      sanitized[k] = sanitizeLogValue(v, k, depth + 1);
    }
    return sanitized;
  }

  return String(value);
}

export function createLogger(options?: { level?: string; destination?: pino.DestinationStream }): LoggerLike {
  const baseLogger = pino(
    {
      level: options?.level || process.env.LOG_LEVEL || 'info',
      base: { service: 'payreminder' },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-cron-secret"]',
          'req.headers["x-hub-signature-256"]',
          'req.headers["x-payment-signature"]',
          '*.token',
          '*.secret',
          '*.apiKey',
          '*.password',
        ],
        censor: '[REDACTED]',
      },
    },
    options?.destination
  );

  const emit = (level: 'info' | 'warn' | 'error', obj: Record<string, unknown> | string, msg?: string) => {
    if (typeof obj === 'string') {
      baseLogger[level](sanitizeStringForLogs(obj));
      return;
    }
    const clean = sanitizeLogValue(obj) as Record<string, unknown>;
    if (msg !== undefined) {
      baseLogger[level](clean, sanitizeStringForLogs(msg));
    } else {
      baseLogger[level](clean);
    }
  };

  return {
    info: (obj, msg) => emit('info', obj, msg),
    warn: (obj, msg) => emit('warn', obj, msg),
    error: (obj, msg) => emit('error', obj, msg),
  };
}

export const logger = createLogger();
