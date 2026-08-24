import { useEffect, useRef } from 'react';

/**
 * Hardened detector for USB HID Keyboard / USB-KBW 2D & 1D barcode scanners
 * (e.g. Blueprint BP-LITE X2D, HaoYin VID_34EB&PID_1502, Honeywell, Datalogic).
 *
 * Characteristics:
 * - Scanners type rapid keystrokes (< 45ms interval) terminated by Enter/CR.
 * - Human typing is significantly slower (> 80ms interval).
 * - Zero-Click Auto-Fill: Intercepts scans and routes them to the designated barcode field
 *   even when another input is focused or when no input is focused.
 */

const MAX_INTER_KEY_MS = 50;
const MIN_CODE_LENGTH = 3;
const MAX_CODE_LENGTH = 128;
const BUFFER_TIMEOUT_MS = 150;
const REPEAT_SCAN_COOLDOWN_MS = 100;

export interface UseBarcodeScannerOptions {
  enabled?: boolean;
  targetInputId?: string; // HTML element ID of the barcode input (e.g. 'product-barcode-input')
  interceptEditable?: boolean; // If true, intercepts scanner even when cursor is in another input
}

export function useBarcodeScanner(
  onScan: (code: string) => void,
  enabledOrOptions: boolean | UseBarcodeScannerOptions = true,
  extraOptions?: UseBarcodeScannerOptions
) {
  const options: UseBarcodeScannerOptions =
    typeof enabledOrOptions === 'boolean'
      ? { enabled: enabledOrOptions, ...extraOptions }
      : { enabled: true, ...enabledOrOptions };

  const isEnabled = options.enabled !== false;
  const targetInputId = options.targetInputId;
  const interceptEditable = options.interceptEditable ?? true;

  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const lastScanTimeRef = useRef(0);
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const onScanRef = useRef(onScan);
  const targetInputIdRef = useRef(targetInputId);
  const interceptEditableRef = useRef(interceptEditable);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    targetInputIdRef.current = targetInputId;
  }, [targetInputId]);

  useEffect(() => {
    interceptEditableRef.current = interceptEditable;
  }, [interceptEditable]);

  useEffect(() => {
    if (!isEnabled) {
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

      // Ignore standard modifier shortcuts (Ctrl+C, Alt+Tab, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        bufferRef.current = '';
        return;
      }

      const target = e.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      const isDedicatedBarcodeInput =
        target?.getAttribute('data-barcode-scan') === 'true' ||
        (targetInputIdRef.current && target?.id === targetInputIdRef.current);

      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);

        // Check if buffer contains a valid barcode burst
        if (code.length >= MIN_CODE_LENGTH && code.length <= MAX_CODE_LENGTH) {
          // Check cooldown to avoid duplicate rapid scan triggers
          if (now - lastScanTimeRef.current < REPEAT_SCAN_COOLDOWN_MS) {
            return;
          }
          lastScanTimeRef.current = now;

          // Prevent default form submission or newline
          e.preventDefault();
          e.stopPropagation();

          // If the focus was in a non-barcode input, clean up any scanner leakage if needed
          if (isEditable && !isDedicatedBarcodeInput && target instanceof HTMLInputElement) {
            // If the input value ends with the scanned code or partial code, strip it
            if (target.value && target.value.endsWith(code)) {
              target.value = target.value.slice(0, -code.length);
              target.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }

          // Auto-focus target input element if specified
          if (targetInputIdRef.current) {
            const targetEl = document.getElementById(targetInputIdRef.current) as HTMLInputElement | null;
            if (targetEl) {
              targetEl.focus();
              targetEl.select();
            }
          }

          // Fire callback
          onScanRef.current(code);
          return;
        }

        // If editable and regular Enter (not scanner burst), let it pass normally
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

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    };
  }, [isEnabled]);
}
