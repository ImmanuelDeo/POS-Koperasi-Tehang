/**
 * WhatsApp Provider Abstraction Service
 * POS Koperasi Tehang
 *
 * Implements vendor-neutral interface for Official WhatsApp Business Platform
 * (Meta Cloud API & Official BSPs), with Mock Sandbox Provider for offline development.
 */

import * as crypto from 'crypto';

export interface WhatsAppTemplateDto {
  id: string;
  templateName: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paused';
  headerType?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'NONE';
  bodyText: string;
  footerText?: string;
  buttons?: Array<{ type: string; text: string }>;
  variableSchema?: string[];
}

export interface SendTemplateMessageInput {
  recipientPhoneE164: string;
  templateName: string;
  languageCode: string;
  headerValues?: string[];
  bodyValues?: string[];
  buttonPayload?: string;
}

export interface SendTemplateMessageResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  httpStatus?: number;
}

export interface WhatsAppProvider {
  readonly providerId: string;
  readonly providerName: string;

  validateConfiguration(): Promise<{
    valid: boolean;
    error?: string;
    accountName?: string;
    verifiedNumber?: string;
    qualityRating?: string;
  }>;

  listApprovedTemplates(): Promise<WhatsAppTemplateDto[]>;

  sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult>;

  verifyWebhookSignature(signatureHeader: string, rawBody: string | Buffer): boolean;
}

/**
 * Mock WhatsApp Provider for test suites, sandbox demonstrations, and local development.
 * Simulates official API behavior without connecting to Meta or sending real SMS/WA.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly providerId = 'mock_sandbox';
  readonly providerName = 'Mock WhatsApp Sandbox Provider';

  private failRate = 0;
  private rateLimitSimulated = false;

  constructor(options?: { failRate?: number; simulateRateLimit?: boolean }) {
    if (options?.failRate) this.failRate = options.failRate;
    if (options?.simulateRateLimit) this.rateLimitSimulated = options.simulateRateLimit;
  }

  async validateConfiguration() {
    return {
      valid: true,
      accountName: 'Koperasi Karyawan Tehang (Sandbox)',
      verifiedNumber: '+62 812-3456-7890',
      qualityRating: 'GREEN',
    };
  }

  async listApprovedTemplates(): Promise<WhatsAppTemplateDto[]> {
    return [
      {
        id: 'tpl-mock-1',
        templateName: 'koperasi_promo_sembako',
        category: 'MARKETING',
        language: 'id',
        status: 'approved',
        headerType: 'TEXT',
        bodyText: 'Halo {{1}}, ada kabar gembira dari {{2}}! Nikmati promo {{3}} khusus anggota aktif. Promo berlaku hingga {{4}}.',
        footerText: 'Balas STOP untuk berhenti menerima info promo.',
        buttons: [{ type: 'QUICK_REPLY', text: 'Lihat Promo' }, { type: 'QUICK_REPLY', text: 'STOP' }],
        variableSchema: ['recipient_name', 'business_name', 'promo_title', 'valid_until'],
      },
      {
        id: 'tpl-mock-2',
        templateName: 'koperasi_bazar_hemat',
        category: 'MARKETING',
        language: 'id',
        status: 'approved',
        headerType: 'TEXT',
        bodyText: 'Salam hangat {{1}}, {{2}} mengadakan program {{3}} dengan penawaran spesial. Berlaku sampai {{4}}.',
        footerText: 'Balas STOP untuk berhenti berlangganan.',
        buttons: [{ type: 'QUICK_REPLY', text: 'Info Lengkap' }, { type: 'QUICK_REPLY', text: 'STOP' }],
        variableSchema: ['recipient_name', 'business_name', 'promo_title', 'valid_until'],
      },
    ];
  }

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult> {
    // Check if phone number is valid
    if (!input.recipientPhoneE164.startsWith('+')) {
      return {
        success: false,
        errorCode: 'INVALID_PHONE_NUMBER',
        errorMessage: 'Recipient phone number must be in E.164 format',
      };
    }

    if (this.rateLimitSimulated) {
      return {
        success: false,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        errorMessage: 'Simulated 429 Too Many Requests from WhatsApp Graph API',
        httpStatus: 429,
      };
    }

    if (this.failRate > 0 && Math.random() < this.failRate) {
      return {
        success: false,
        errorCode: 'RECIPIENT_NOT_ON_WHATSAPP',
        errorMessage: 'The destination phone number is not registered on WhatsApp',
        httpStatus: 400,
      };
    }

    const mockId = 'wamid.' + crypto.randomBytes(12).toString('hex');
    return {
      success: true,
      providerMessageId: mockId,
      httpStatus: 200,
    };
  }

  verifyWebhookSignature(signatureHeader: string, rawBody: string | Buffer): boolean {
    if (!signatureHeader) return false;
    return signatureHeader.startsWith('sha256=') || signatureHeader === 'mock_valid_signature';
  }
}

/**
 * Meta WhatsApp Cloud API Official Implementation.
 */
export class MetaWhatsAppCloudProvider implements WhatsAppProvider {
  readonly providerId = 'meta_cloud';
  readonly providerName = 'Meta WhatsApp Cloud API';

  private phoneNumberId: string;
  private wabaId: string;
  private apiToken: string;
  private appSecret: string;
  private apiVersion: string;

  constructor(config: {
    phoneNumberId?: string;
    wabaId?: string;
    apiToken?: string;
    appSecret?: string;
    apiVersion?: string;
  }) {
    this.phoneNumberId = config.phoneNumberId || process.env.WA_PHONE_NUMBER_ID || '';
    this.wabaId = config.wabaId || process.env.WA_WABA_ID || '';
    this.apiToken = config.apiToken || process.env.WA_API_TOKEN || '';
    this.appSecret = config.appSecret || process.env.WA_APP_SECRET || '';
    this.apiVersion = config.apiVersion || 'v20.0';
  }

  async validateConfiguration() {
    if (!this.phoneNumberId || !this.apiToken) {
      return {
        valid: false,
        error: 'WA_PHONE_NUMBER_ID and WA_API_TOKEN must be configured in server environment',
      };
    }

    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { valid: false, error: (err as any)?.error?.message || `HTTP ${res.status}` };
      }

      const data = (await res.json()) as any;
      return {
        valid: true,
        accountName: data.verified_name || data.display_phone_number || 'Koperasi Tehang',
        verifiedNumber: data.display_phone_number || '',
        qualityRating: data.quality_rating || 'UNKNOWN',
      };
    } catch (err: any) {
      return { valid: false, error: err.message || 'Network connection to Meta Graph API failed' };
    }
  }

  async listApprovedTemplates(): Promise<WhatsAppTemplateDto[]> {
    if (!this.wabaId || !this.apiToken) {
      return [];
    }

    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${this.wabaId}/message_templates?limit=100`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });

      if (!res.ok) return [];

      const json = (await res.json()) as any;
      const templates: WhatsAppTemplateDto[] = [];

      for (const item of json.data || []) {
        if (item.status === 'APPROVED') {
          const bodyComponent = item.components?.find((c: any) => c.type === 'BODY');
          const footerComponent = item.components?.find((c: any) => c.type === 'FOOTER');
          const buttonComponent = item.components?.find((c: any) => c.type === 'BUTTONS');

          templates.push({
            id: item.id,
            templateName: item.name,
            category: item.category || 'MARKETING',
            language: item.language || 'id',
            status: 'approved',
            bodyText: bodyComponent?.text || '',
            footerText: footerComponent?.text,
            buttons: buttonComponent?.buttons,
          });
        }
      }

      return templates;
    } catch {
      return [];
    }
  }

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendTemplateMessageResult> {
    if (!this.phoneNumberId || !this.apiToken) {
      return {
        success: false,
        errorCode: 'UNCONFIGURED',
        errorMessage: 'Meta WhatsApp Cloud API credentials not configured',
      };
    }

    const cleanTo = input.recipientPhoneE164.replace(/\+/g, '');
    const bodyParameters = (input.bodyValues || []).map((val) => ({
      type: 'text',
      text: val,
    }));

    const components: any[] = [];
    if (bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyParameters,
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.languageCode || 'id' },
        components: components.length > 0 ? components : undefined,
      },
    };

    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as any;

      if (!res.ok) {
        return {
          success: false,
          errorCode: data?.error?.code ? String(data.error.code) : 'GRAPH_API_ERROR',
          errorMessage: data?.error?.message || `HTTP ${res.status}`,
          httpStatus: res.status,
        };
      }

      const messageId = data?.messages?.[0]?.id;
      return {
        success: true,
        providerMessageId: messageId,
        httpStatus: res.status,
      };
    } catch (err: any) {
      return {
        success: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: err.message || 'Failed to connect to Meta WhatsApp Graph API',
      };
    }
  }

  verifyWebhookSignature(signatureHeader: string, rawBody: string | Buffer): boolean {
    if (!this.appSecret || !signatureHeader) return false;

    try {
      const expectedSig = crypto
        .createHmac('sha256', this.appSecret)
        .update(rawBody)
        .digest('hex');
      const cleanHeader = signatureHeader.replace(/^sha256=/, '');
      return crypto.timingSafeEqual(Buffer.from(cleanHeader), Buffer.from(expectedSig));
    } catch {
      return false;
    }
  }
}

let activeProviderInstance: WhatsAppProvider | null = null;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (!activeProviderInstance) {
    if (process.env.NODE_ENV === 'test' || !process.env.WA_API_TOKEN) {
      activeProviderInstance = new MockWhatsAppProvider();
    } else {
      activeProviderInstance = new MetaWhatsAppCloudProvider({
        phoneNumberId: process.env.WA_PHONE_NUMBER_ID,
        wabaId: process.env.WA_WABA_ID,
        apiToken: process.env.WA_API_TOKEN,
        appSecret: process.env.WA_APP_SECRET,
      });
    }
  }
  return activeProviderInstance;
}

export function setCustomWhatsAppProvider(provider: WhatsAppProvider | null): void {
  activeProviderInstance = provider;
}
