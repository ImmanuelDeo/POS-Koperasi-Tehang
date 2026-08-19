import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../db';
import { getJwtSecret } from '../config/security';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Middleware to verify JWT tokens and attach the current active user from SQLite.
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as any;
    const userId = decoded.userId || decoded.id;

    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }

    const db = getDatabase();
    const user = db.prepare(
      'SELECT id, name, email, role, is_active FROM users WHERE id = ?'
    ).get(userId) as any;

    if (!user || user.is_active !== 1) {
      return res.status(401).json({ error: 'User account is inactive or no longer exists' });
    }

    // Attach latest authenticated user from database
    req.user = {
      id: String(user.id),
      name: String(user.name),
      email: String(user.email),
      role: String(user.role),
    };

    next();
  } catch (err: any) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware to enforce role-based access control (RBAC).
 * Owner role always bypasses all restrictions.
 * Legacy roles 'manager' and 'waiter' are mapped to 'admin' and 'cashier' respectively.
 */
export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role;

    // Owner always has full access
    if (userRole === 'owner') {
      return next();
    }

    // Map legacy roles for backward compatibility
    const effectiveRoles = [userRole];
    if (userRole === 'manager') effectiveRoles.push('admin');
    if (userRole === 'waiter') effectiveRoles.push('cashier');

    const hasPermission = effectiveRoles.some((role) => allowedRoles.includes(role));

    if (!hasPermission) {
      return res.status(403).json({
        error: `Forbidden: Role '${userRole}' does not have sufficient permissions`,
      });
    }

    next();
  };
}

/**
 * Middleware to enforce method-specific RBAC within a single route mount.
 */
export function requireMethodRoles(methodMap: Record<string, string[]>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role;
    if (userRole === 'owner') {
      return next();
    }

    const method = req.method.toUpperCase();
    const allowedRoles = methodMap[method] || methodMap['ALL'] || ['owner', 'admin'];

    const effectiveRoles = [userRole];
    if (userRole === 'manager') effectiveRoles.push('admin');
    if (userRole === 'waiter') effectiveRoles.push('cashier');

    const hasPermission = effectiveRoles.some((role) => allowedRoles.includes(role));

    if (!hasPermission) {
      return res.status(403).json({
        error: `Forbidden: Role '${userRole}' does not have permission for ${method} on this endpoint`,
      });
    }

    next();
  };
}
