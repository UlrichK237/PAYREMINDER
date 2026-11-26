import { analyzeInboundMessage, type InboundIntentAnalysis } from '../../src/utils/inboundAnalysis';

export { analyzeInboundMessage, type InboundIntentAnalysis };

export interface WhatsAppSendResult {
  success: boolean;
  simulated: boolean;
  providerMessageId: string;
  status: 'simule' | 'envoyee' | 'echouee';
  errorMessage?: string;
}

export async function sendWhatsAppTemplateMessage(params: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  variables: string[];
  fallbackBody: string;
}): Promise<WhatsAppSendResult> {
  if (!params.accessToken || !params.phoneNumberId) {
    return {
      success: true,
      simulated: true,
      providerMessageId: `sim_wa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      status: 'simule',
    };
  }

  try {
    const cleanPhone = params.to.replace(/[^0-9]/g, '');
    const url = `https://graph.facebook.com/v21.0/${params.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
          name: params.templateName,
          language: { code: 'fr' },
          components: [
            {
              type: 'body',
              parameters: params.variables.map((v) => ({ type: 'text', text: v })),
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false,
        simulated: false,
        providerMessageId: `err_wa_${Date.now()}`,
        status: 'echouee',
        errorMessage: `Meta API ${response.status}: ${errText.slice(0, 180)}`,
      };
    }

    const data = (await response.json()) as { messages?: { id: string }[] };
    return {
      success: true,
      simulated: false,
      providerMessageId: data.messages?.[0]?.id || `wa_${Date.now()}`,
      status: 'envoyee',
    };
  } catch (error) {
    return {
      success: false,
      simulated: false,
      providerMessageId: `err_wa_${Date.now()}`,
      status: 'echouee',
      errorMessage: error instanceof Error ? error.message : 'Erreur réseau WhatsApp',
    };
  }
}
