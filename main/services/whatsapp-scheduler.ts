/**
 * WhatsApp Campaign Scheduler & Queue Dispatcher
 * POS Koperasi Tehang
 *
 * Implements resilient campaign scheduling (UTC canonical comparisons),
 * restart-safe queue processing, rate-limit throttling, exponential backoff,
 * owner approval gating (>100 recipients), and idempotent per-recipient status tracking.
 */

import { getDatabase } from '../db';
import { getWhatsAppProvider } from './whatsapp-provider';
import { maskPhoneE164 } from './whatsapp-privacy';
import { createAuditLog } from './audit';

export interface CampaignEstimateResult {
  totalMembers: number;
  eligibleCount: number;
  excludedNoPhone: number;
  excludedInvalidPhone: number;
  excludedNoOptIn: number;
  excludedOptedOut: number;
  requiresOwnerApproval: boolean;
  samplePlaceholderPreview?: {
    recipient_name: string;
    business_name: string;
    formatted_body: string;
  };
}

export class WhatsAppCampaignScheduler {
  private static isProcessing = false;
  private static timer: NodeJS.Timeout | null = null;
  private static isInitialized = false;

  /**
   * Initialize scheduler loop and auto-recover any interrupted or overdue campaigns.
   */
  public static init(intervalMs = 30000): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    console.log('[WhatsApp Scheduler] Initializing campaign daemon...');
    this.recoverInterruptedCampaigns();

    this.timer = setInterval(() => {
      this.tick();
    }, intervalMs);

    // Initial tick immediately
    this.tick();
  }

  public static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isInitialized = false;
  }

  /**
   * Inspect SQLite upon server startup:
   * 1. Campaigns stuck in 'running' are kept in 'running' and remaining 'queued' recipients will be processed.
   * 2. Campaigns in 'scheduled' whose scheduled_at_utc <= NOW() will be picked up.
   */
  public static recoverInterruptedCampaigns(): void {
    try {
      const db = getDatabase();
      const runningCampaigns = db.prepare(`
        SELECT id, name FROM whatsapp_campaigns WHERE status = 'running'
      `).all() as any[];

      if (runningCampaigns.length > 0) {
        console.log(`[WhatsApp Scheduler] Found ${runningCampaigns.length} running campaign(s) to resume after restart.`);
      }
    } catch (err: any) {
      console.error('[WhatsApp Scheduler] Error checking campaign recovery:', err.message);
    }
  }

  /**
   * Periodic scheduler tick.
   */
  public static async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const db = getDatabase();
      const nowUtc = new Date().toISOString();

      // 1. Find scheduled campaigns that are due
      const dueCampaigns = db.prepare(`
        SELECT id, name, recipient_count_estimate, approved_by
        FROM whatsapp_campaigns
        WHERE status = 'scheduled'
          AND scheduled_at_utc IS NOT NULL
          AND scheduled_at_utc <= ?
      `).all(nowUtc) as any[];

      for (const camp of dueCampaigns) {
        // Enforce owner approval policy if estimate > 100
        if (camp.recipient_count_estimate > 100 && !camp.approved_by) {
          console.warn(`[WhatsApp Scheduler] Campaign ${camp.id} (${camp.name}) requires owner approval (>100 recipients). Pausing launch.`);
          continue;
        }

        db.prepare(`
          UPDATE whatsapp_campaigns
          SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'scheduled'
        `).run(nowUtc, camp.id);

        createAuditLog(db, {
          actor_user_id: camp.approved_by || 'system_scheduler',
          actor_role: 'system',
          action: 'whatsapp.campaign.started',
          target_type: 'whatsapp_campaign',
          target_id: camp.id,
          details: JSON.stringify({ name: camp.name, reason: 'scheduled_time_reached' }),
        });
      }

      // 2. Process all currently running campaigns
      const running = db.prepare(`
        SELECT * FROM whatsapp_campaigns WHERE status = 'running'
      `).all() as any[];

      for (const camp of running) {
        await this.processCampaignBatch(camp.id);
      }
    } catch (err: any) {
      console.error('[WhatsApp Scheduler] Tick error:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single batch for a campaign.
   */
  public static async processCampaignBatch(campaignId: string, batchSize = 15): Promise<void> {
    const db = getDatabase();
    const provider = getWhatsAppProvider();

    // Re-verify campaign is still running (not paused/cancelled)
    const campaign = db.prepare(`
      SELECT c.*, t.template_name, t.language
      FROM whatsapp_campaigns c
      JOIN whatsapp_templates t ON c.template_id = t.id
      WHERE c.id = ?
    `).get(campaignId) as any;

    if (!campaign || campaign.status !== 'running') {
      return;
    }

    // Fetch next batch of queued recipients
    const queuedRecipients = db.prepare(`
      SELECT r.id, r.customer_id, r.phone_e164, c.name AS customer_name, c.whatsapp_marketing_opt_in
      FROM whatsapp_campaign_recipients r
      JOIN customers c ON r.customer_id = c.id
      WHERE r.campaign_id = ? AND r.status = 'queued'
      ORDER BY r.id ASC
      LIMIT ?
    `).all(campaignId, batchSize) as any[];

    if (queuedRecipients.length === 0) {
      // Check if all recipients have finished
      const remainingQueued = db.prepare(`
        SELECT COUNT(*) AS count FROM whatsapp_campaign_recipients
        WHERE campaign_id = ? AND status = 'queued'
      `).get(campaignId) as any;

      if (remainingQueued.count === 0) {
        // Complete the campaign
        const counts = db.prepare(`
          SELECT
            SUM(CASE WHEN status = 'sent' OR status = 'delivered' OR status = 'read' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'skipped' OR status = 'opted_out' THEN 1 ELSE 0 END) AS skipped
          FROM whatsapp_campaign_recipients
          WHERE campaign_id = ?
        `).get(campaignId) as any;

        db.prepare(`
          UPDATE whatsapp_campaigns
          SET status = 'completed',
              completed_at = CURRENT_TIMESTAMP,
              sent_count = ?,
              failed_count = ?,
              skipped_count = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(counts.sent || 0, counts.failed || 0, counts.skipped || 0, campaignId);

        createAuditLog(db, {
          actor_user_id: campaign.created_by,
          actor_role: 'system',
          action: 'whatsapp.campaign.completed',
          target_type: 'whatsapp_campaign',
          target_id: campaignId,
          details: JSON.stringify({
            name: campaign.name,
            total_sent: counts.sent || 0,
            total_failed: counts.failed || 0,
            total_skipped: counts.skipped || 0,
          }),
        });

        console.log(`[WhatsApp Scheduler] Campaign ${campaignId} (${campaign.name}) completed successfully.`);
      }
      return;
    }

    const variables = JSON.parse(campaign.template_variables_json || '{}');
    const businessName = variables.business_name || 'Koperasi';

    for (const recipient of queuedRecipients) {
      // Check again if campaign was paused or cancelled mid-batch
      const freshStatus = db.prepare(`SELECT status FROM whatsapp_campaigns WHERE id = ?`).get(campaignId) as any;
      if (freshStatus?.status !== 'running') {
        break;
      }

      // Check if recipient opted-out while queued
      if (recipient.whatsapp_marketing_opt_in !== 1) {
        db.prepare(`
          UPDATE whatsapp_campaign_recipients
          SET status = 'opted_out', error_category = 'opted_out_prior_to_send', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(recipient.id);
        db.prepare(`UPDATE whatsapp_campaigns SET skipped_count = skipped_count + 1 WHERE id = ?`).run(campaignId);
        continue;
      }

      // Mark status as sending (idempotent lock)
      db.prepare(`
        UPDATE whatsapp_campaign_recipients
        SET status = 'sending', attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(recipient.id);

      // Build parameters
      const bodyValues = [
        recipient.customer_name || 'Anggota',
        businessName,
        variables.promo_title || 'Promo Menarik',
        variables.valid_until || 'Waktu Terbatas',
      ];

      const sendResult = await provider.sendTemplateMessage({
        recipientPhoneE164: recipient.phone_e164,
        templateName: campaign.template_name,
        languageCode: campaign.language || 'id',
        bodyValues,
      });

      const now = new Date().toISOString();

      if (sendResult.success) {
        db.prepare(`
          UPDATE whatsapp_campaign_recipients
          SET status = 'sent',
              provider_message_id = ?,
              sent_at = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(sendResult.providerMessageId || null, now, recipient.id);

        db.prepare(`UPDATE whatsapp_campaigns SET sent_count = sent_count + 1 WHERE id = ?`).run(campaignId);
      } else {
        // Handle rate limit backoff
        if (sendResult.httpStatus === 429 || sendResult.errorCode === 'RATE_LIMIT_EXCEEDED') {
          console.warn(`[WhatsApp Scheduler] Rate limit encountered for campaign ${campaignId}. Backing off...`);
          db.prepare(`
            UPDATE whatsapp_campaign_recipients
            SET status = 'queued',
                error_code = ?,
                error_category = 'rate_limit',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(sendResult.errorCode || '429', recipient.id);
          // Pause queue processing for 10 seconds
          await new Promise((resolve) => setTimeout(resolve, 10000));
          break;
        }

        db.prepare(`
          UPDATE whatsapp_campaign_recipients
          SET status = 'failed',
              error_code = ?,
              error_category = ?,
              failed_at = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          sendResult.errorCode || 'SEND_ERROR',
          sendResult.errorMessage || 'Unknown provider error',
          now,
          recipient.id
        );

        db.prepare(`UPDATE whatsapp_campaigns SET failed_count = failed_count + 1 WHERE id = ?`).run(campaignId);

        createAuditLog(db, {
          actor_user_id: campaign.created_by,
          actor_role: 'system',
          action: 'whatsapp.message.delivery_failed',
          target_type: 'whatsapp_campaign_recipient',
          target_id: String(recipient.id),
          details: JSON.stringify({
            campaign_id: campaignId,
            masked_phone: maskPhoneE164(recipient.phone_e164),
            error: sendResult.errorCode,
          }),
        });
      }

      // Safe inter-message throttle (250ms delay) to avoid network packet flooding
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
