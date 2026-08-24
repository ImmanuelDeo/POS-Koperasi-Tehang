import { useEffect, useRef } from 'react';

/**
 * Hardened detector for USB HID Keyboard / USB-KBW barcode scanners
 * (e.g. Blueprint Lite-Series BP-LITE X2D).
 *
 * Characteristics:
 * - Scanners type rapid keystrokes (< 50ms interval) terminated by Enter/CR.
 * - Human typing is slower (> 80ms interval).
 * - Focus guards prevent capturing scans when typing in regular text/NIK/payment inputs.
 */
const MAX_INTER_KEY_MS = 50;
const MIN_CODE_LENGTH = 4;
const MAX_CODE_LENGTH = 128;
const BUFFER_TIMEOUT_MS = 120;
const REPEAT_SCAN_COOLDOWN_MS = 100;

export function useBarcodeScanner(onScan: (code: string) => void, enabled: boolean = true) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const lastScanTimeRef = useRef(0);
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) {
      bufferRef.current = '';
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      return;
    }

    const resetBufferWithTimeout = () => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = setTimeout(() => {
        bufferRef.current = '';
      }, BUFFER_TIMEOUT_MS);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // Ignore shortcut combinations
      if (e.ctrlKey || e.metaKey || e.altKey) {
        bufferRef.current = '';
        return;
      }

      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);

        const target = e.target as HTMLElement | null;
        const isEditable =
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.tagName === 'SELECT' ||
          target?.isContentEditable;

        const isDedicatedBarcodeInput = target?.getAttribute('data-barcode-scan') === 'true';

        // Ignore global capture if focused on regular form inputs (NIK, notes, payment, etc.)
        if (isEditable && !isDedicatedBarcodeInput) {
          return;
        }

        // Validate length constraints
        if (code.length >= MIN_CODE_LENGTH && code.length <= MAX_CODE_LENGTH) {
          // Check cooldown to avoid duplicate rapid scan triggers
          if (now - lastScanTimeRef.current < REPEAT_SCAN_COOLDOWN_MS) {
            return;
          }
          lastScanTimeRef.current = now;

          // Prevent default form submission on enter
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      // Single printable character keys only
      if (e.key.length !== 1) {
        return;
      }

      // Reject non-printable / control characters
      if (/[\x00-\x1F\x7F]/.test(e.key)) {
        bufferRef.current = '';
        return;
      }

      // Reset buffer if typing is too slow (human typing) or append if fast (scanner transmission)
      if (gap > MAX_INTER_KEY_MS) {
        bufferRef.current = e.key;
      } else {
        bufferRef.current += e.key;
      }

      // Guard against buffer overflow
      if (bufferRef.current.length > MAX_CODE_LENGTH) {
        bufferRef.current = '';
        return;
      }

      resetBufferWithTimeout();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    };
  }, [enabled]);
}
