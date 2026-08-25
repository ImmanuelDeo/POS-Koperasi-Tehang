import { Router, Response } from 'express';
import { getDatabase } from '../db';
import { AuthenticatedRequest } from '../middleware/auth';
import { getDashboardAnalytics } from '../services/analytics';

const router = Router();

/**
 * GET /api/dashboard/analytics
 * Returns comprehensive POS Koperasi analytics including KPIs, payment breakdown,
 * salary deduction audit, sales trend, and top products for the selected period.
 */
router.get('/analytics', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { period, date, startDate, endDate } = req.query as {
      period?: string;
      date?: string;
      startDate?: string;
      endDate?: string;
    };

    // Server-side validation for custom range
    if (period === 'custom') {
      if (startDate && endDate && startDate > endDate) {
        return res.status(400).json({ error: 'startDate tidak boleh lebih besar dari endDate' });
      }
    }

    const db = getDatabase();
    const analytics = getDashboardAnalytics(db, {
      period,
      date,
      startDate,
      endDate,
    });

    res.json(analytics);
  } catch (error: any) {
    console.error('[Dashboard Analytics Error]', error);
    res.status(500).json({ error: error.message || 'Gagal memuat analitik dashboard' });
  }
});

export const dashboardRoutes = router;
