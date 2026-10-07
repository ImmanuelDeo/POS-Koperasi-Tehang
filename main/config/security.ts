import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';

let runtimeDevSecret: string | null = null;
let securityValidated = false;

function getOrCreatePackagedJwtSecret(): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure OS storage is unavailable; refusing to start the packaged app without a protected JWT secret.');
  }

  const secretPath = path.join(app.getPath('userData'), 'jwt-secret.bin');
  if (fs.existsSync(secretPath)) {
    const secret = safeStorage.decryptString(fs.readFileSync(secretPath));
    if (secret.length < 32) {
      throw new Error(`Stored JWT secret is invalid: ${secretPath}`);
    }
    return secret;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  const encryptedSecret = safeStorage.encryptString(secret);
  const temporaryPath = `${secretPath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, encryptedSecret, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, secretPath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      console.error('[Security] Failed to remove temporary JWT secret file:', cleanupError);
    }
    throw error;
  }

  return secret;
}

/**
 * Automatically loads .env file into process.env if present.
 */
export function loadEnv(): void {
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.env'),
  ];
  for (const envFile of possiblePaths) {
    if (fs.existsSync(envFile)) {
      try {
        const content = fs.readFileSync(envFile, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) {
              const key = trimmed.slice(0, eqIdx).trim();
              const val = trimmed.slice(eqIdx + 1).trim();
              if (process.env[key] === undefined) {
                process.env[key] = val;
              }
            }
          }
        }
        break;
      } catch {
        // Ignore read errors
      }
    }
  }
}

// Ensure .env is loaded early
loadEnv();

/**
 * Validate security configuration on application startup.
 * Must be called once before server starts accepting requests or issuing tokens.
 */
export function validateSecurityConfig(): void {
  loadEnv();
  const isProduction = app.isPackaged || process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET?.trim();

  if (isProduction) {
    if (secret && secret.length < 32) {
      console.error('================================================================');
      console.error('[SECURITY ERROR] JWT_SECRET must be at least 32 characters long in production!');
      console.error(`Current length is ${secret.length} characters.`);
      console.error('================================================================');
      process.exit(1);
    }

    if (!secret && !app.isPackaged) {
      console.error('================================================================');
      console.error('[SECURITY ERROR] JWT_SECRET is required in production mode!');
      console.error('Please define a secure random JWT_SECRET (>= 32 chars) in .env');
      console.error('================================================================');
      process.exit(1);
    }

    if (secret) {
      console.log('[Security] Production JWT_SECRET validated successfully (>= 32 chars)');
    } else {
      runtimeDevSecret = getOrCreatePackagedJwtSecret();
      console.log('[Security] Packaged JWT secret loaded from OS-protected user storage');
    }
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
