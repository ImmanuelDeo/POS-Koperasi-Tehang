import { useAuthStore } from '@/store/auth';
import { formatCurrencyForTenant } from '@/lib/countries';

export function useFormatCurrency() {
  const country = useAuthStore((s) => s.currentTenant?.country ?? 'ID');
  const currency = useAuthStore((s) => s.currentTenant?.currency ?? 'IDR');
  return (n: number) => formatCurrencyForTenant(n, country, currency);
}
