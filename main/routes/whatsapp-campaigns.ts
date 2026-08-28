/**
 * WhatsApp Campaigns & Promotion Broadcast Routes
 * POS Koperasi Tehang
 *
 * Implements REST endpoints for managing marketing campaigns, template listings,
 * recipient estimation calculations, campaign lifecycle controls, and approval gating.
 */

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db';
import { AuthenticatedRequest, requireRole } from '../middleware/auth';
import { getWhatsAppProvider } from '../services/whatsapp-provider';
import { normalizeE164Phone, sanitizeTemplateVariables } from '../services/whatsapp-privacy';
import { createAuditLog } from '../services/audit';
import { WhatsAppCampaignScheduler } from '../services/whatsapp-scheduler';

const router = Router();

/**
 * GET /api/whatsapp-campaigns/provider/status
 * Get masked provider configuration status (no credentials leaked).
 */
router.get('/provider/status', requireRole(['owner', 'admin']), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = getWhatsAppProvider();
    const configStatus = await provider.validateConfiguration();

    const db = getDatabase();
    const optInCount = (db.prepare(`
      SELECT COUNT(*) AS count FROM customers
      WHERE is_active = 1 AND whatsapp_marketing_opt_in = 1 AND whatsapp_marketing_opt_out_at IS NULL
    `).get() as any)?.count || 0;

    return res.json({
      configured: configStatus.valid,
      providerId: provider.providerId,
      providerName: provider.providerName,
      accountName: configStatus.accountName || 'POS Koperasi Tehang',
      verifiedNumber: configStatus.verifiedNumber ? `${configStatus.verifiedNumber.slice(0, 7)}****` : 'Not verified',
      qualityRating: configStatus.qualityRating || 'UNKNOWN',
      totalOptInMembers: optInCount,
      error: configStatus.error,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/whatsapp-campaigns/templates
 * List approved WhatsApp templates.
 */
router.get('/templates', requireRole(['owner', 'admin', 'manager']), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const templates = db.prepare(`
      SELECT * FROM whatsapp_templates
      WHERE status = 'approved'
      ORDER BY template_name ASC
    `).all() as any[];

    const formatted = templates.map((t) => ({
      ...t,
      buttons: t.buttons_json ? JSON.parse(t.buttons_json) : [],
      variable_schema: t.variable_schema_json ? JSON.parse(t.variable_schema_json) : [],
    }));

    return res.json({ templates: formatted });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp-campaigns/templates/sync
 * Sync approved templates from official provider.
 */
router.post('/templates/sync', requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = getWhatsAppProvider();
    const remoteTemplates = await provider.listApprovedTemplates();

    const db = getDatabase();
    const insertOrUpdate = db.prepare(`
      INSERT INTO whatsapp_templates (
        id, provider_template_id, template_name, category, language, status,
        header_type, body_text, footer_text, buttons_json, variable_schema_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(template_name) DO UPDATE SET
        provider_template_id = excluded.provider_template_id,
        category = excluded.category,
        language = excluded.language,
        status = excluded.status,
        header_type = excluded.header_type,
        body_text = excluded.body_text,
        footer_text = excluded.footer_text,
        buttons_json = excluded.buttons_json,
        variable_schema_json = excluded.variable_schema_json,
        synced_at = CURRENT_TIMESTAMP
    `);

    let count = 0;
    for (const t of remoteTemplates) {
      insertOrUpdate.run(
        t.id || uuidv4(),
        t.id || null,
        t.templateName,
        t.category || 'MARKETING',
        t.language || 'id',
        t.status || 'approved',
        t.headerType || 'NONE',
        t.bodyText,
        t.footerText || null,
        t.buttons ? JSON.stringify(t.buttons) : null,
        t.variableSchema ? JSON.stringify(t.variableSchema) : null
      );
      count++;
    }

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'whatsapp.templates.synced',
      target_type: 'whatsapp_templates',
      details: JSON.stringify({ synced_count: count }),
    });

    return res.json({ ok: true, synced_count: count });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp-campaigns/estimate
 * Calculate recipient counts and exclusion breakdown without exposing raw customer lists.
 */
router.post('/estimate', requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { department, template_id, template_variables } = req.body || {};
    const db = getDatabase();

    const allMembers = db.prepare(`
      SELECT id, name, phone, country_code, is_active, department, whatsapp_marketing_opt_in, whatsapp_marketing_opt_out_at
      FROM customers
    `).all() as any[];

    let totalMembers = 0;
    let eligibleCount = 0;
    let excludedNoPhone = 0;
    let excludedInvalidPhone = 0;
    let excludedNoOptIn = 0;
    let excludedOptedOut = 0;

    const eligibleCustomerIds: string[] = [];

    for (const m of allMembers) {
      if (m.is_active !== 1) continue;
      if (department && department !== 'all' && m.department !== department) continue;

      totalMembers++;

      if (!m.phone || !m.phone.trim()) {
        excludedNoPhone++;
        continue;
      }

      const phoneNorm = normalizeE164Phone(m.phone, m.country_code);
      if (!phoneNorm.valid || !phoneNorm.e164) {
        excludedInvalidPhone++;
        continue;
      }

      if (m.whatsapp_marketing_opt_out_at) {
        excludedOptedOut++;
        continue;
      }

      if (m.whatsapp_marketing_opt_in !== 1) {
        excludedNoOptIn++;
        continue;
      }

      eligibleCount++;
      eligibleCustomerIds.push(m.id);
    }

    // Build sample bubble preview
    let samplePlaceholderPreview: any = null;
    if (template_id) {
      const tpl = db.prepare(`SELECT * FROM whatsapp_templates WHERE id = ?`).get(template_id) as any;
      if (tpl) {
        const vars = template_variables || {};
        const bizName = vars.business_name || 'Koperasi';
        const promoTitle = vars.promo_title || 'Promo Diskon Sembako';
        const validUntil = vars.valid_until || '31 Agustus 2026';

        let body = tpl.body_text
          .replace(/\{\{1\}\}/g, 'Bpk/Ibu Anggota')
          .replace(/\{\{2\}\}/g, bizName)
          .replace(/\{\{3\}\}/g, promoTitle)
          .replace(/\{\{4\}\}/g, validUntil)
          .replace(/\{\{5\}\}/g, validUntil);

        samplePlaceholderPreview = {
          recipient_name: 'Bpk/Ibu Anggota',
          business_name: bizName,
          formatted_body: body,
          footer: tpl.footer_text || 'Balas STOP untuk berhenti berlangganan.',
        };
      }
    }

    return res.json({
      totalMembers,
      eligibleCount,
      excludedNoPhone,
      excludedInvalidPhone,
      excludedNoOptIn,
      excludedOptedOut,
      requiresOwnerApproval: eligibleCount > 100,
      samplePlaceholderPreview,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/whatsapp-campaigns
 * List all campaigns with real-time statistics.
 */
router.get('/', requireRole(['owner', 'admin', 'manager']), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const campaigns = db.prepare(`
      SELECT c.*, t.template_name, u.name AS creator_name, a.name AS approver_name
      FROM whatsapp_campaigns c
      JOIN whatsapp_templates t ON c.template_id = t.id
      JOIN users u ON c.created_by = u.id
      LEFT JOIN users a ON c.approved_by = a.id
      ORDER BY c.created_at DESC
    `).all() as any[];

    const formatted = campaigns.map((c) => ({
      ...c,
      template_variables: JSON.parse(c.template_variables_json || '{}'),
      target_criteria: JSON.parse(c.target_criteria_json || '{}'),
    }));

    return res.json({ campaigns: formatted });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/whatsapp-campaigns/:id
 * Get single campaign detail with recipient statistics.
 */
router.get('/:id', requireRole(['owner', 'admin', 'manager']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const campaign = db.prepare(`
      SELECT c.*, t.template_name, t.body_text, t.footer_text, u.name AS creator_name, a.name AS approver_name
      FROM whatsapp_campaigns c
      JOIN whatsapp_templates t ON c.template_id = t.id
      JOIN users u ON c.created_by = u.id
      LEFT JOIN users a ON c.approved_by = a.id
      WHERE c.id = ?
    `).get(req.params.id) as any;

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const recipientStats = db.prepare(`
      SELECT
        status,
        COUNT(*) AS count
      FROM whatsapp_campaign_recipients
      WHERE campaign_id = ?
      GROUP BY status
    `).all(req.params.id) as any[];

    const statsMap: Record<string, number> = {
      queued: 0,
      sending: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      skipped: 0,
      opted_out: 0,
    };

    for (const r of recipientStats) {
      statsMap[r.status] = r.count;
    }

    return res.json({
      campaign: {
        ...campaign,
        template_variables: JSON.parse(campaign.template_variables_json || '{}'),
        target_criteria: JSON.parse(campaign.target_criteria_json || '{}'),
      },
      stats: statsMap,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp-campaigns
 * Create a new campaign (draft or scheduled).
 */
router.post('/', requireRole(['owner', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, template_id, template_variables, target_criteria, schedule_type, scheduled_at_iso } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Campaign name is required' });
    }
    if (!template_id) {
      return res.status(400).json({ error: 'Template selection is required' });
    }

    const db = getDatabase();
    const template = db.prepare(`SELECT * FROM whatsapp_templates WHERE id = ? AND status = 'approved'`).get(template_id) as any;
    if (!template) {
      return res.status(400).json({ error: 'Selected template is invalid or not approved by provider' });
    }

    // Sanitize template variables against sensitive data injection
    const varSanitize = sanitizeTemplateVariables(template_variables || {});
    if (!varSanitize.valid) {
      return res.status(400).json({
        error: `Variables contain forbidden or sensitive keys: ${varSanitize.rejectedKeys.join(', ')}`,
      });
    }

    // Evaluate eligible recipients
    const department = target_criteria?.department || 'all';
    const allMembers = db.prepare(`
      SELECT id, name, phone, country_code, is_active, department, whatsapp_marketing_opt_in, whatsapp_marketing_opt_out_at
      FROM customers
      WHERE is_active = 1
    `).all() as any[];

    const eligibleList: Array<{ customer_id: string; phone_e164: string }> = [];

    for (const m of allMembers) {
      if (department !== 'all' && m.department !== department) continue;
      if (m.whatsapp_marketing_opt_in !== 1 || m.whatsapp_marketing_opt_out_at) continue;

      const norm = normalizeE164Phone(m.phone, m.country_code);
      if (norm.valid && norm.e164) {
        eligibleList.push({ customer_id: m.id, phone_e164: norm.e164 });
      }
    }

    if (eligibleList.length === 0) {
      return res.status(400).json({ error: 'No eligible opt-in members found matching criteria' });
    }

    const campaignId = uuidv4();
    const isOwner = req.user?.role === 'owner';
    const requiresOwnerApproval = eligibleList.length > 100 && !isOwner;

    let initialStatus: 'draft' | 'scheduled' | 'running' = 'draft';
    let scheduledUtc: string | null = null;
    let scheduledWibLabel: string | null = null;

    if (schedule_type === 'scheduled' && scheduled_at_iso) {
      const schedDate = new Date(scheduled_at_iso);
      if (isNaN(schedDate.getTime()) || schedDate <= new Date()) {
        return res.status(400).json({ error: 'Scheduled time must be a valid future datetime' });
      }
      scheduledUtc = schedDate.toISOString();
      scheduledWibLabel = schedDate.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
      initialStatus = 'scheduled';
    } else if (schedule_type === 'immediate') {
      if (!requiresOwnerApproval) {
        initialStatus = 'running';
      }
    }

    const createTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO whatsapp_campaigns (
          id, name, template_id, template_variables_json, target_criteria_json,
          status, scheduled_at_utc, scheduled_at_wib_label, created_by,
          approved_by, recipient_count_estimate, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        campaignId,
        name.trim(),
        template_id,
        JSON.stringify(varSanitize.sanitized),
        JSON.stringify(target_criteria || {}),
        initialStatus,
        scheduledUtc,
        scheduledWibLabel,
        req.user?.id,
        isOwner ? req.user?.id : null,
        eligibleList.length,
        initialStatus === 'running' ? new Date().toISOString() : null
      );

      const insertRecipient = db.prepare(`
        INSERT INTO whatsapp_campaign_recipients (
          campaign_id, customer_id, phone_e164, status
        ) VALUES (?, ?, ?, 'queued')
      `);

      for (const item of eligibleList) {
        insertRecipient.run(campaignId, item.customer_id, item.phone_e164);
      }
    });

    createTransaction();

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'whatsapp.campaign.created',
      target_type: 'whatsapp_campaign',
      target_id: campaignId,
      details: JSON.stringify({
        name,
        template_name: template.template_name,
        target_count: eligibleList.length,
        status: initialStatus,
        requiresOwnerApproval,
      }),
    });

    if (initialStatus === 'running') {
      // Trigger background tick
      WhatsAppCampaignScheduler.tick().catch(() => {});
    }

    return res.status(201).json({
      ok: true,
      campaignId,
      status: initialStatus,
      recipientCount: eligibleList.length,
      requiresOwnerApproval,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp-campaigns/:id/approve
 * Owner approves a campaign for launch.
 */
router.post('/:id/approve', requireRole(['owner']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const campaign = db.prepare(`SELECT * FROM whatsapp_campaigns WHERE id = ?`).get(req.params.id) as any;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    db.prepare(`
      UPDATE whatsapp_campaigns
      SET approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.user?.id, req.params.id);

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'whatsapp.campaign.approved',
      target_type: 'whatsapp_campaign',
      target_id: req.params.id,
      details: JSON.stringify({ name: campaign.name }),
    });

    return res.json({ ok: true, approved: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp-campaigns/:id/start
 * Immediately trigger campaign execution.
 */
router.post('/:id/start', requireRole(['owner', 'admin']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const campaign = db.prepare(`SELECT * FROM whatsapp_campaigns WHERE id = ?`).get(req.params.id) as any;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    if (campaign.recipient_count_estimate > 100 && !campaign.approved_by && req.user?.role !== 'owner') {
      return res.status(403).json({ error: 'Owner approval required for campaigns with > 100 recipients' });
    }

    db.prepare(`
      UPDATE whatsapp_campaigns
      SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'whatsapp.campaign.started',
      target_type: 'whatsapp_campaign',
      target_id: req.params.id,
      details: JSON.stringify({ name: campaign.name, trigger: 'manual_start' }),
    });

    WhatsAppCampaignScheduler.tick().catch(() => {});

    return res.json({ ok: true, status: 'running' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp-campaigns/:id/pause
 * Pause an active running campaign.
 */
router.post('/:id/pause', requireRole(['owner', 'admin']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const campaign = db.prepare(`SELECT * FROM whatsapp_campaigns WHERE id = ?`).get(req.params.id) as any;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    db.prepare(`
      UPDATE whatsapp_campaigns
      SET status = 'paused', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'running'
    `).run(req.params.id);

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'whatsapp.campaign.paused',
      target_type: 'whatsapp_campaign',
      target_id: req.params.id,
      details: JSON.stringify({ name: campaign.name }),
    });

    return res.json({ ok: true, status: 'paused' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp-campaigns/:id/resume
 * Resume a paused campaign.
 */
router.post('/:id/resume', requireRole(['owner', 'admin']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const campaign = db.prepare(`SELECT * FROM whatsapp_campaigns WHERE id = ?`).get(req.params.id) as any;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    db.prepare(`
      UPDATE whatsapp_campaigns
      SET status = 'running', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'paused'
    `).run(req.params.id);

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'whatsapp.campaign.resumed',
      target_type: 'whatsapp_campaign',
      target_id: req.params.id,
      details: JSON.stringify({ name: campaign.name }),
    });

    WhatsAppCampaignScheduler.tick().catch(() => {});

    return res.json({ ok: true, status: 'running' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp-campaigns/:id/cancel
 * Cancel a campaign.
 */
router.post('/:id/cancel', requireRole(['owner', 'admin']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const campaign = db.prepare(`SELECT * FROM whatsapp_campaigns WHERE id = ?`).get(req.params.id) as any;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    db.prepare(`
      UPDATE whatsapp_campaigns
      SET status = 'cancelled', cancelled_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('draft', 'scheduled', 'running', 'paused')
    `).run(req.user?.id, req.params.id);

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'whatsapp.campaign.cancelled',
      target_type: 'whatsapp_campaign',
      target_id: req.params.id,
      details: JSON.stringify({ name: campaign.name }),
    });

    return res.json({ ok: true, status: 'cancelled' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
