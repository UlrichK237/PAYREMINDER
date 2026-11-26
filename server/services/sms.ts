/**
 * Interface abstraite SmsProvider pour brancher tout agrégateur SMS camerounais
 * (Camoo, Nexah, Orange SMS API, MboaSMS, Twilio, etc.).
 */
export interface SmsSendPayload {
  to: string;
  message: string;
  senderId?: string;
}

export interface SmsSendResult {
  success: boolean;
  simulated: boolean;
  providerMessageId: string;
  status: 'simule' | 'envoyee' | 'echouee';
  errorMessage?: string;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(payload: SmsSendPayload): Promise<SmsSendResult>;
}

export class HttpSmsProvider implements SmsProvider {
  readonly name = 'HttpGenericCameroonSms';
  private readonly endpointUrl: string;
  private readonly apiKey: string;
  private readonly defaultSenderId: string;

  constructor(params: { endpointUrl: string; apiKey: string; defaultSenderId: string }) {
    this.endpointUrl = params.endpointUrl;
    this.apiKey = params.apiKey;
    this.defaultSenderId = params.defaultSenderId;
  }

  async sendSms(payload: SmsSendPayload): Promise<SmsSendResult> {
    try {
      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          to: payload.to,
          from: payload.senderId || this.defaultSenderId,
          message: payload.message,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          success: false,
          simulated: false,
          providerMessageId: `err_sms_${Date.now()}`,
          status: 'echouee',
          errorMessage: `HTTP ${response.status}: ${text.slice(0, 180)}`,
        };
      }

      const data = (await response.json().catch(() => ({}))) as { messageId?: string; id?: string };
      return {
        success: true,
        simulated: false,
        providerMessageId: data.messageId || data.id || `sms_${Date.now()}`,
        status: 'envoyee',
      };
    } catch (error) {
      return {
        success: false,
        simulated: false,
        providerMessageId: `err_sms_${Date.now()}`,
        status: 'echouee',
        errorMessage: error instanceof Error ? error.message : 'Erreur réseau SMS',
      };
    }
  }
}

export class SimulatedSmsProvider implements SmsProvider {
  readonly name = 'SimulatedSmsProvider';

  async sendSms(_payload: SmsSendPayload): Promise<SmsSendResult> {
    return {
      success: true,
      simulated: true,
      providerMessageId: `sim_sms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      status: 'simule',
    };
  }
}

export function createSmsProvider(config: {
  smsProviderUrl: string;
  smsApiKey: string;
  smsSenderId: string;
}): SmsProvider {
  if (config.smsProviderUrl && config.smsApiKey) {
    return new HttpSmsProvider({
      endpointUrl: config.smsProviderUrl,
      apiKey: config.smsApiKey,
      defaultSenderId: config.smsSenderId,
    });
  }
  return new SimulatedSmsProvider();
}
