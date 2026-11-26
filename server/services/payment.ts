/**
 * Interface abstraite PaymentProvider pour MTN MoMo / Orange Money / agrégateurs locaux
 * (CinetPay, NotchPay, Monetbil, Campay) + implémentation de démonstration.
 */
export interface PaymentLinkRequest {
  tenantId: string;
  debtId?: string;
  paymentRef?: string;
  amountFcfa: number;
  customerPhone: string;
  customerName: string;
  description: string;
  metadata?: {
    type: 'debt' | 'subscription';
    tenantId: string;
    debtId?: string;
    paymentRef?: string;
    planId?: string;
  };
}

export interface PaymentLinkResult {
  paymentUrl: string;
  transactionRef: string;
  simulated: boolean;
}

export interface PaymentProvider {
  readonly name: string;
  createPaymentLink(req: PaymentLinkRequest): Promise<PaymentLinkResult>;
}

export class HttpMobileMoneyProvider implements PaymentProvider {
  readonly name = 'HttpMobileMoneyProvider';
  private readonly endpointUrl: string;
  private readonly apiKey: string;
  private readonly fallbackBaseUrl: string;

  constructor(params: { endpointUrl: string; apiKey: string; fallbackBaseUrl: string }) {
    this.endpointUrl = params.endpointUrl;
    this.apiKey = params.apiKey;
    this.fallbackBaseUrl = params.fallbackBaseUrl.replace(/\/$/, '');
  }

  async createPaymentLink(req: PaymentLinkRequest): Promise<PaymentLinkResult> {
    const ref =
      req.paymentRef ||
      `MOMO-${(req.debtId || req.tenantId).slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-5)}`;

    const response = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        amount: req.amountFcfa,
        currency: 'XAF',
        reference: ref,
        description: req.description,
        customer: {
          name: req.customerName,
          phone: req.customerPhone,
        },
        metadata: req.metadata || {
          type: 'debt',
          tenantId: req.tenantId,
          ...(req.debtId ? { debtId: req.debtId } : {}),
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erreur fournisseur paiement HTTP ${response.status}: ${errText.slice(0, 180)}`);
    }

    const data = (await response.json().catch(() => ({}))) as {
      paymentUrl?: string;
      payment_url?: string;
      url?: string;
      transactionRef?: string;
      reference?: string;
    };

    const paymentUrl =
      data.paymentUrl ||
      data.payment_url ||
      data.url ||
      `${this.fallbackBaseUrl}/abonnement?ref=${encodeURIComponent(ref)}&montant=${req.amountFcfa}`;

    return {
      paymentUrl,
      transactionRef: data.transactionRef || data.reference || ref,
      simulated: false,
    };
  }
}

export class DemoMobileMoneyProvider implements PaymentProvider {
  readonly name = 'DemoMobileMoneyProvider';
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async createPaymentLink(req: PaymentLinkRequest): Promise<PaymentLinkResult> {
    if (req.metadata?.type === 'subscription' || req.paymentRef) {
      const ref = req.paymentRef || `ABO-${req.tenantId.slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-5)}`;
      const planParam = req.metadata?.planId ? `&plan=${encodeURIComponent(req.metadata.planId)}` : '';
      const paymentUrl = `${this.baseUrl}/abonnement?payer_abo=${encodeURIComponent(ref)}${planParam}&montant=${req.amountFcfa}`;
      return {
        paymentUrl,
        transactionRef: ref,
        simulated: true,
      };
    }

    const debtId = req.debtId || 'debt';
    const ref = `MOMO-${debtId.slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-5)}`;
    const paymentUrl = `${this.baseUrl}/dettes?payer=${encodeURIComponent(debtId)}&ref=${encodeURIComponent(ref)}&montant=${req.amountFcfa}`;
    return {
      paymentUrl,
      transactionRef: ref,
      simulated: true,
    };
  }
}

export function createPaymentProvider(config: {
  paymentProviderUrl: string;
  paymentApiKey: string;
  appBaseUrl: string;
}): PaymentProvider {
  if (config.paymentProviderUrl && config.paymentApiKey) {
    return new HttpMobileMoneyProvider({
      endpointUrl: config.paymentProviderUrl,
      apiKey: config.paymentApiKey,
      fallbackBaseUrl: config.appBaseUrl,
    });
  }
  return new DemoMobileMoneyProvider(config.appBaseUrl);
}
