/**
 * WhatsApp Webhook Inbound Handler
 * POS Koperasi Tehang
 *
 * Implements secure HMAC-SHA256 signature verification, inbound STOP/BERHENTI opt-out processing,
 * consent history recording, queued campaign recipient cancellation, and audit logging.
 */

import { getDatabase } from '../db';
import { getWhatsAppProvider } from './whatsapp-provider';
import { normalizeE164Phone, maskPhoneE164 } from './whatsapp-privacy';
import { createAuditLog } from './audit';

export const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'berhenti',
  'unsubscribe',
  'batal',
  'off',
  'keluar',
]);

export interface WebhookProcessResult {
  success: boolean;
  actionTaken: 'opt_out_processed' | 'status_updated' | 'ignored' | 'unregistered_number';
  phoneMasked?: string;
  customerId?: string;
  error?: string;
}

/**
 * Process inbound WhatsApp webhook event payload.
 */
export async function processInboundWebhookEvent(
  signatureHeader: string,
  rawBody: string | Buffer,
  parsedJson: any
): Promise<WebhookProcessResult> {
  const provider = getWhatsAppProvider();

  // 1. Verify provider signature
  const isSignatureValid = provider.verifyWebhookSignature(signatureHeader, rawBody);
  if (!isSignatureValid) {
    return {
      success: false,
      actionTaken: 'ignored',
      error: 'Invalid webhook signature',
    };
  }

  const db = getDatabase();

  // 2. Handle status updates (e.g. delivered, read, failed)
  const statusUpdate = parsedJson?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];
  if (statusUpdate) {
    const providerMessageId = statusUpdate.id;
    const status = statusUpdate.status; // 'delivered' | 'read' | 'failed'
    const timestamp = statusUpdate.timestamp ? new Date(parseInt(statusUpdate.timestamp, 10) * 1000).toISOString() : new Date().toISOString();

    if (providerMessageId && ['delivered', 'read', 'failed'].includes(status)) {
      if (status === 'delivered') {
        db.prepare(`
          UPDATE whatsapp_campaign_recipients
          SET status = 'delivered', delivered_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE provider_message_id = ?
        `).run(timestamp, providerMessageId);

        // Update campaign counter
        const recipient = db.prepare(`SELECT campaign_id FROM whatsapp_campaign_recipients WHERE provider_message_id = ?`).get(providerMessageId) as any;
        if (recipient?.campaign_id) {
          db.prepare(`UPDATE whatsapp_campaigns SET delivered_count = delivered_count + 1 WHERE id = ?`).run(recipient.campaign_id);
        }
      } else if (status === 'read') {
        db.prepare(`
          UPDATE whatsapp_campaign_recipients
          SET status = 'read', read_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE provider_message_id = ?
        `).run(timestamp, providerMessageId);

        const recipient = db.prepare(`SELECT campaign_id FROM whatsapp_campaign_recipients WHERE provider_message_id = ?`).get(providerMessageId) as any;
        if (recipient?.campaign_id) {
          db.prepare(`UPDATE whatsapp_campaigns SET read_count = read_count + 1 WHERE id = ?`).run(recipient.campaign_id);
        }
      }

      return {
        success: true,
        actionTaken: 'status_updated',
      };
    }
  }

  // 3. Handle inbound text messages (Opt-out keywords like STOP, BERHENTI)
  const inboundMessage = parsedJson?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (inboundMessage) {
    const rawFrom = inboundMessage.from; // e.g. '6281234567890'
    const bodyText = (inboundMessage.text?.body || inboundMessage.button?.text || '').trim().toLowerCase();

    const normalized = normalizeE164Phone(rawFrom);
    if (!normalized.valid || !normalized.e164) {
      return {
        success: true,
        actionTaken: 'ignored',
      };
    }

    const phoneE164 = normalized.e164;
    const masked = maskPhoneE164(phoneE164);

    if (OPT_OUT_KEYWORDS.has(bodyText)) {
      // Find customer in database by phone
      // Customers table might store phone in various formats, compare normalized
      const customers = db.prepare(`
        SELECT id, name, phone, country_code, whatsapp_marketing_opt_in
        FROM customers
        WHERE is_active = 1
      `).all() as any[];

      const matchedCustomer = customers.find((c) => {
        const cNorm = normalizeE164Phone(c.phone, c.country_code);
        return cNorm.valid && cNorm.e164 === phoneE164;
      });

      if (matchedCustomer) {
        const now = new Date().toISOString();

        // 1. Update customer opt_in = 0, record opt_out metadata
        db.prepare(`
          UPDATE customers
          SET whatsapp_marketing_opt_in = 0,
              whatsapp_marketing_opt_out_at = ?,
              whatsapp_marketing_opt_out_reason = 'inbound_keyword_stop',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(now, matchedCustomer.id);

        // 2. Insert consent audit record
        db.prepare(`
          INSERT INTO customer_consent_logs (
            customer_id, event_type, source, reason, created_at
          ) VALUES (?, 'OPT_OUT', 'inbound_whatsapp_stop', 'Inbound keyword STOP received from user', ?)
        `).run(matchedCustomer.id, now);

        // 3. Mark any currently queued campaign recipients for this customer as opted_out
        db.prepare(`
          UPDATE whatsapp_campaign_recipients
          SET status = 'opted_out', error_category = 'inbound_opt_out_received', updated_at = CURRENT_TIMESTAMP
          WHERE customer_id = ? AND status = 'queued'
        `).run(matchedCustomer.id);

        // 4. Audit log event
        createAuditLog(db, {
          actor_user_id: 'system_webhook',
          actor_role: 'system',
          action: 'whatsapp.consent.opted_out',
          target_type: 'customer',
          target_id: matchedCustomer.id,
          details: JSON.stringify({
            customer_id: matchedCustomer.id,
            masked_phone: masked,
            trigger: 'inbound_stop',
          }),
        });

        console.log(`[WhatsApp Webhook] Processed opt-out for customer ${matchedCustomer.id} (${masked})`);

        return {
          success: true,
          actionTaken: 'opt_out_processed',
          phoneMasked: masked,
          customerId: matchedCustomer.id,
        };
      } else {
        return {
          success: true,
          actionTaken: 'unregistered_number',
          phoneMasked: masked,
        };
      }
    }
  }

  return {
    success: true,
    actionTaken: 'ignored',
  };
}
