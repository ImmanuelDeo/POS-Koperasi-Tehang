import Database from 'better-sqlite3';
import { sanitizeAuditDetails } from './privacy';

export interface AuditLogPayload {
  actor_user_id?: string | null;
  actor_role?: string | null;
  action: string;
  target_type: string;
  target_id?: string | null;
  details?: any;
  ip_address?: string | null;
}

/**
 * Inserts an immutable audit log record into SQLite.
 * Automatically sanitizes details to prevent raw NIK exposure.
 */
export function createAuditLog(db: Database.Database, payload: AuditLogPayload): void {
  try {
    const sanitizedDetails = payload.details
      ? JSON.stringify(sanitizeAuditDetails(payload.details))
      : null;

    db.prepare(`
      INSERT INTO audit_logs (
        actor_user_id, actor_role, action, target_type, target_id, details, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      payload.actor_user_id || null,
      payload.actor_role || 'system',
      payload.action,
      payload.target_type,
      payload.target_id || null,
      sanitizedDetails,
      payload.ip_address || null
    );
  } catch (err) {
    console.error('[AuditLog] Failed to record audit log:', err);
  }
}
