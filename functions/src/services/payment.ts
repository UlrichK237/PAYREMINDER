/**
 * Interface abstraite PaymentProvider pour MTN MoMo / Orange Money / agrégateurs locaux
 * (CinetPay, NotchPay, Monetbil, Campay) + implémentation de démonstration.
 */
export interface PaymentLinkRequest {
  tenantId: string;
  debtId: string;
  amountFcfa: number;
  customerPhone: string;
  customerName: string;
  description: string;
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

export class DemoMobileMoneyProvider implements PaymentProvider {
  readonly name = 'DemoMobileMoneyProvider';
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async createPaymentLink(req: PaymentLinkRequest): Promise<PaymentLinkResult> {
    const ref = `MOMO-${req.debtId.slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-5)}`;
    const paymentUrl = `${this.baseUrl}/dettes?payer=${encodeURIComponent(req.debtId)}&ref=${encodeURIComponent(ref)}&montant=${req.amountFcfa}`;
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
  // En production, brancher ici votre agrégateur (NotchPay / CinetPay / Campay) si paymentApiKey est configurée
  return new DemoMobileMoneyProvider(config.appBaseUrl);
}
