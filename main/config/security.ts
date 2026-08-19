import * as crypto from 'crypto';

let runtimeDevSecret: string | null = null;
let securityValidated = false;

/**
 * Validate security configuration on application startup.
 * Must be called once before server starts accepting requests or issuing tokens.
 */
export function validateSecurityConfig(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET?.trim();

  if (isProduction) {
    if (!secret) {
      console.error('================================================================');
      console.error('[SECURITY ERROR] JWT_SECRET is required in production mode!');
      console.error('Please define a secure random JWT_SECRET (>= 32 chars) in .env');
      console.error('================================================================');
      process.exit(1);
    }

    if (secret.length < 32) {
      console.error('================================================================');
      console.error('[SECURITY ERROR] JWT_SECRET must be at least 32 characters long in production!');
      console.error(`Current length is ${secret.length} characters.`);
      console.error('================================================================');
      process.exit(1);
    }

    console.log('[Security] Production JWT_SECRET validated successfully (>= 32 chars)');
  } else {
    // Development mode
    if (!secret || secret.length < 32) {
      if (!runtimeDevSecret) {
        runtimeDevSecret = crypto.randomBytes(32).toString('hex');
      }
      console.warn('================================================================');
      console.warn('[Security Warning] Running in development mode without JWT_SECRET in .env.');
      console.warn('A temporary in-memory secret has been generated for this process.');
      console.warn('All issued tokens will be invalidated upon application restart.');
      console.warn('================================================================');
    } else {
      console.log('[Security] Development JWT_SECRET loaded from environment');
    }
  }

  securityValidated = true;
}

/**
 * Returns the active validated JWT secret string.
 */
export function getJwtSecret(): string {
  if (!securityValidated) {
    validateSecurityConfig();
  }

  const secret = process.env.JWT_SECRET?.trim();
  if (secret && secret.length >= 32) {
    return secret;
  }

  if (runtimeDevSecret) {
    return runtimeDevSecret;
  }

  // Fallback generation if called before validation in dev
  runtimeDevSecret = crypto.randomBytes(32).toString('hex');
  return runtimeDevSecret;
}

/**
 * Checks whether the upstream auto-updater is enabled.
 * Default is FALSE for POS Koperasi.
 */
export function isAutoUpdaterEnabled(): boolean {
  return process.env.ENABLE_AUTO_UPDATER === 'true';
}

/**
 * Checks whether cloud synchronization is enabled.
 * Default is FALSE for POS Koperasi.
 */
export function isCloudSyncEnabled(): boolean {
  return process.env.ENABLE_CLOUD_SYNC === 'true';
}

/**
 * Validates whether an incoming HTTP Origin is permitted by CORS.
 */
export function isOriginAllowed(origin: string | undefined, port: number = 3001): boolean {
  // Allow requests without Origin (e.g. Electron internal webContents, curl, server-to-server)
  if (!origin) {
    return true;
  }

  // Standard local origins
  const standardOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `https://localhost:${port}`,
    `https://127.0.0.1:${port}`,
  ];

  if (standardOrigins.includes(origin)) {
    return true;
  }

  // Same-port LAN origins (e.g., http://192.168.x.x:3001 or http://flo.local:3001)
  try {
    const url = new URL(origin);
    const originPort = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (String(originPort) === String(port)) {
      return true;
    }
  } catch {
    // Malformed URL
    return false;
  }

  // Explicit allowed LAN origins from environment variable
  const envOrigins = process.env.ALLOWED_LAN_ORIGINS
    ? process.env.ALLOWED_LAN_ORIGINS.split(',').map((s) => s.trim().toLowerCase())
    : [];

  if (envOrigins.includes(origin.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Checks whether production kiosk mode is enabled.
 * Only activates when BOTH NODE_ENV === 'production' AND ENABLE_KIOSK_MODE === 'true'.
 * In development, kiosk mode is ALWAYS disabled.
 */
export function isKioskModeEnabled(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.ENABLE_KIOSK_MODE === 'true';
}

/**
 * Validates whether a URL or origin originates from the local embedded application server.
 * Used for IPC sender verification and will-navigate restrictions.
 */
export function isLocalAppOrigin(urlStr: string | undefined, port: number = 3001): boolean {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname;
    const urlPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const isMatchingPort = String(urlPort) === String(port);

    return isLocalHost && isMatchingPort;
  } catch {
    return false;
  }
}

