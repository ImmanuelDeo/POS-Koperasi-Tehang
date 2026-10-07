'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useI18n } from '@/hooks/useI18n';

export default function MenuActionHandler() {
  const { t } = useI18n();
  const router = useRouter();

  async function runBackup() {
    if (!window.electronAPI?.backupDatabase) {
      toast.error(t('common.notAvailable'));
      return { success: false, error: t('common.notAvailable') };
    }

    toast.loading(t('backup.creating'), { id: 'backup' });
    const result = await window.electronAPI.backupDatabase();
    toast.remove('backup');

    if (result.success) {
      toast.success(t('backup.savedTo', { path: result.path ?? '' }));
    } else if (result.error !== 'Cancelled') {
      toast.error(t('backup.failedWith', { error: result.error ?? '' }));
    }
    return result;
  }

  async function runRestore() {
    if (!window.electronAPI?.restoreBackup) {
      toast.error(t('common.notAvailable'));
      return { success: false, error: t('common.notAvailable') };
    }

    const result = await window.electronAPI.restoreBackup();
    if (result.success) {
      toast.success(t('restore.success'));
      setTimeout(() => window.location.reload(), 1500);
    } else if (result.error !== 'Cancelled') {
      toast.error(t('restore.failedWith', { error: result.error ?? '' }));
    }
    return result;
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onMenuAction) return;

    const unsubscribe = window.electronAPI.onMenuAction((action: string) => {
      console.log('[Menu] Action received:', action);

      switch (action) {
        case 'new-order':
          router.push('/pos');
          break;
        case 'quick-search':
          router.push('/pos');
          break;
        case 'view-orders':
          router.push('/orders');
          break;
        case 'report-daily':
        case 'report-sales':
        case 'report-x':
        case 'report-z':
          router.push('/reports');
          break;
        case 'settings-business':
        case 'settings-tax':
        case 'settings-printer':
        case 'settings-kitchen':
          router.push('/settings');
          break;
        case 'backup-database':
          runBackup();
          break;
        case 'restore-backup':
          runRestore();
          break;
        case 'menu-db-health-check':
          router.push('/settings?tab=data&action=health-check');
          break;
        case 'menu-db-initialize':
          router.push('/settings?tab=data&action=initialize-db');
          break;
        case 'menu-master-pin':
          router.push('/settings?tab=data&action=master-pin');
          break;
        default:
          console.log('[Menu] Unknown action:', action);
      }
    });

    return () => { unsubscribe?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return null;
}
