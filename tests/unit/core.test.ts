import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  getQuarterHourSlotKeyDouala,
  isWithinQuietHours,
  verifyWebhookHmac,
} from '../../server/app';
import { hmacPhoneCode, hmacPhoneNumber, resolveOtpPepper } from '../../server/config';
import { maskPhoneNumber, sanitizeLogValue, sanitizeStringForLogs } from '../../server/logger';
import { appendSmsStopNotice, SMS_MAX_LENGTH, SMS_STOP_NOTICE } from '../../server/services/reminderService';
import {
  formatFcfa,
  formatPercent,
  getCurrentDoualaMonth,
  getDaysOverdue,
  isValidCameroonPhone,
  isValidInternationalPhone,
  normalizeCameroonPhone,
  pickEscalatedTone,
  renderTemplateMessage,
} from '../../src/utils/formatters';
import { PLANS, UNLIMITED_QUOTA } from '../../src/utils/plans';
import { validateTemplateBody } from '../../src/utils/templateValidation';

describe('Formatters & validation téléphones (Africa/Douala)', () => {
  it('formate les montants FCFA avec espace insécable et sans décimales', () => {
    expect(formatFcfa(15000)).toBe('15\u00A0000\u00A0FCFA');
    expect(formatFcfa(0)).toBe('0\u00A0FCFA');
    expect(formatFcfa(1250499.6)).toBe('1\u00A0250\u00A0500\u00A0FCFA');
  });

  it('formate les pourcentages en français avec virgule et espace insécable', () => {
    expect(formatPercent(23)).toBe('23,0\u00A0%');
    expect(formatPercent(87.46)).toBe('87,5\u00A0%');
    expect(formatPercent(92, 0)).toBe('92\u00A0%');
  });

  it('normalise et valide les numéros camerounais et internationaux', () => {
    expect(normalizeCameroonPhone('677 12 34 56')).toBe('+237677123456');
    expect(normalizeCameroonPhone('00237 699-00-11-22')).toBe('+237699001122');
    expect(isValidCameroonPhone('+237677123456')).toBe(true);
    expect(isValidCameroonPhone('+237222123456')).toBe(true);
    expect(isValidCameroonPhone('+237123456789')).toBe(false);
    expect(isValidInternationalPhone('+33612345678')).toBe(true);
    expect(isValidInternationalPhone('677123456')).toBe(false);
  });

  it('calcule correctement les jours de retard et le mois courant à Douala', () => {
    expect(getDaysOverdue('2026-11-20', '2026-11-25')).toBe(5);
    expect(getDaysOverdue('2026-11-30', '2026-11-25')).toBe(-5);
    expect(getCurrentDoualaMonth(new Date('2026-11-30T23:30:00Z'))).toBe('2026-12'); // UTC+1 = 00h30 le 1er déc.
  });

  it('choisit le bon ton avec escalade automatique', () => {
    expect(pickEscalatedTone(0, true)).toBe('amical');
    expect(pickEscalatedTone(2, true)).toBe('amical');
    expect(pickEscalatedTone(5, true)).toBe('ferme');
    expect(pickEscalatedTone(11, true)).toBe('dernier_avis');
    expect(pickEscalatedTone(20, false)).toBe('amical');
  });

  it('interpole les variables dans un modèle de message', () => {
    const rendered = renderTemplateMessage(
      'Bonjour {nom}, solde {montant_restant} échéance {echeance} ({entreprise}) {lien_paiement}',
      {
        nom: 'Jean',
        montant_restant: 25000,
        echeance: '2026-11-25',
        entreprise: 'Boutique Étoile',
        lien_paiement: 'https://pay.test/123',
      }
    );
    expect(rendered).toContain('Bonjour Jean');
    expect(rendered).toContain('25\u00A0000\u00A0FCFA');
    expect(rendered).toContain('Boutique Étoile');
    expect(rendered).toContain('https://pay.test/123');
  });
});

describe('Validation des modèles de relance', () => {
  it('accepte un modèle conforme SMS et WhatsApp', () => {
    expect(
      validateTemplateBody(
        'Bonjour {nom}, merci de régler {montant_restant} avant le {echeance} pour {entreprise}. {lien_paiement}',
        'sms'
      ).ok
    ).toBe(true);
    expect(
      validateTemplateBody('Bonjour {nom}, merci pour votre confiance. {lien_paiement}', 'whatsapp').ok
    ).toBe(true);
  });

  it('refuse un dépassement de longueur (480 SMS, 1000 WhatsApp)', () => {
    expect(validateTemplateBody('A'.repeat(481), 'sms').ok).toBe(false);
    expect(validateTemplateBody('A'.repeat(481), 'whatsapp').ok).toBe(true);
    expect(validateTemplateBody('A'.repeat(1001), 'whatsapp').ok).toBe(false);
  });

  it('refuse les URLs externes autres que {lien_paiement}', () => {
    expect(validateTemplateBody('Bonjour {nom}, payez sur https://evil.cm/pay svp.', 'sms').ok).toBe(false);
    expect(validateTemplateBody('Bonjour {nom}, visitez www.arnaque.com merci.', 'whatsapp').ok).toBe(false);
    expect(validateTemplateBody('Bonjour {nom}, visitez boutique.cm/promo merci.', 'sms').ok).toBe(false);
  });

  it('refuse les mots d’intimidation insensibles à la casse et aux accents', () => {
    expect(validateTemplateBody('Bonjour {nom}, nous appelons la POLICE demain.', 'sms').ok).toBe(false);
    expect(validateTemplateBody('Bonjour {nom}, un huissier va arrêter votre compte.', 'whatsapp').ok).toBe(false);
    expect(validateTemplateBody('Bonjour {nom}, merci pour votre règlement rapide.', 'sms').ok).toBe(true);
  });

  it('refuse les variables non autorisées', () => {
    expect(validateTemplateBody('Bonjour {nom}, votre code est {secret_admin}.', 'sms').ok).toBe(false);
  });
});

describe('Vérification HMAC webhooks, HTML escape, fenêtres horaires et quotas', () => {
  it('vérifie la signature HMAC-SHA256 avec préfixe sha256= et hex brut', () => {
    const secret = 'super_webhook_secret';
    const rawBody = Buffer.from(JSON.stringify({ amount: 5000, debtId: 'd1' }), 'utf8');
    const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    expect(
      verifyWebhookHmac({ rawBody, signatureHeader: `sha256=${hex}`, secret, secretEnvName: 'S', isProduction: true }).ok
    ).toBe(true);
    expect(
      verifyWebhookHmac({ rawBody, signatureHeader: hex, secret, secretEnvName: 'S', isProduction: true }).ok
    ).toBe(true);
    expect(
      verifyWebhookHmac({ rawBody, signatureHeader: 'sha256=deadbeef', secret, secretEnvName: 'S', isProduction: true }).ok
    ).toBe(false);
    expect(
      verifyWebhookHmac({ rawBody, signatureHeader: undefined, secret, secretEnvName: 'S', isProduction: true }).ok
    ).toBe(false);
    expect(
      verifyWebhookHmac({ rawBody, signatureHeader: undefined, secret: '', secretEnvName: 'S', isProduction: true }).ok
    ).toBe(false);
    expect(
      verifyWebhookHmac({ rawBody, signatureHeader: undefined, secret: '', secretEnvName: 'S', isProduction: false }).ok
    ).toBe(true);
  });

  it('échappe les caractères HTML dangereux contre XSS', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'test'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;test&#39;'
    );
  });

  it('détecte correctement les heures calmes nocturnes et diurnes', () => {
    expect(isWithinQuietHours(21, 20, 7)).toBe(true);
    expect(isWithinQuietHours(6, 20, 7)).toBe(true);
    expect(isWithinQuietHours(10, 20, 7)).toBe(false);
    expect(isWithinQuietHours(13, 12, 14)).toBe(true);
  });

  it('calcule des créneaux de 15 minutes dans Africa/Douala', () => {
    const slot = getQuarterHourSlotKeyDouala(new Date('2026-11-25T10:19:00Z')); // 11h19 à Douala
    expect(slot).toBe('2026-11-25-11-15');
  });

  it('définit des quotas cohérents par forfait', () => {
    expect(PLANS.free.maxDebtors).toBe(5);
    expect(PLANS.free.whatsappEnabled).toBe(false);
    expect(PLANS.starter.maxRemindersPerDay).toBe(40);
    expect(PLANS.pro.whatsappEnabled).toBe(true);
    expect(PLANS.business.maxDebtors).toBe(UNLIMITED_QUOTA);
  });
});

describe('Mention STOP SMS & masquage PII dans les logs', () => {
  it('ajoute la mention STOP si absente et évite les doublons', () => {
    const withStop = appendSmsStopNotice('Bonjour Paul, solde 5 000 FCFA.');
    expect(withStop.endsWith(SMS_STOP_NOTICE)).toBe(true);
    expect(withStop.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);

    const already = appendSmsStopNotice(`Bonjour Paul. ${SMS_STOP_NOTICE}`);
    expect(already.split('STOP').length - 1).toBe(1);

    const longInput = 'A'.repeat(475);
    const truncated = appendSmsStopNotice(longInput);
    expect(truncated.endsWith(SMS_STOP_NOTICE)).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });

  it('masque les numéros de téléphone et les secrets dans les logs', () => {
    expect(maskPhoneNumber('+237677123456')).toBe('***456');
    expect(sanitizeStringForLogs('Envoi vers +237677123456 avec Bearer eyJhbGciOi.abc.def')).toBe(
      'Envoi vers ***456 avec Bearer [REDACTED]'
    );
    expect(
      sanitizeLogValue({
        phone: '+237699112233',
        customerPhone: '+237677445566',
        cronSecret: 'top-secret',
        nested: { apiKey: 'key-123', ok: true },
      })
    ).toEqual({
      phone: '***233',
      customerPhone: '***566',
      cronSecret: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', ok: true },
    });
  });
});

describe('D1 — Helpers HMAC OTP & liste d’opposition', () => {
  it('exige OTP_PEPPER en production et calcule des empreintes HMAC déterministes', () => {
    expect(() =>
      resolveOtpPepper(
        {
          whatsappAccessToken: '',
          whatsappPhoneNumberId: '',
          whatsappWebhookVerifyToken: '',
          whatsappAppSecret: '',
          smsProviderUrl: '',
          smsApiKey: '',
          smsSenderId: 'PayReminder',
          paymentProviderUrl: '',
          paymentApiKey: '',
          paymentWebhookSecret: '',
          emailProviderApiKey: '',
          emailFromAddress: '',
          cronSecret: '',
          otpPepper: '',
          allowedPhonePrefixes: '+237',
          allowPlanChangeWithoutPayment: false,
          appBaseUrl: 'http://localhost:3000',
        },
        true
      )
    ).toThrow(/OTP_PEPPER/);

    const h1 = hmacPhoneNumber('pepper-1', '+237677123456');
    const h2 = hmacPhoneNumber('pepper-1', '+237677123456');
    const h3 = hmacPhoneNumber('pepper-2', '+237677123456');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toHaveLength(64);

    const c1 = hmacPhoneCode('pepper-1', 'salt-abc', '654321');
    const c2 = hmacPhoneCode('pepper-1', 'salt-abc', '654322');
    expect(c1).toHaveLength(64);
    expect(c1).not.toBe(c2);
  });
});

