'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import { Plus, X, Edit, RotateCcw, Shield, Check, Search, Trash2 } from 'lucide-react';
import type { Staff } from '@/lib/types';
import { useI18n } from '@/hooks/useI18n';
import { useAuthStore } from '@/store/auth';
import { useConfirm } from '@/hooks/use-confirm';

const VALID_ROLES = ['owner', 'admin', 'manager', 'cashier', 'office_hr', 'office_inventory', 'waiter', 'chef'];

const roleColorKey: Record<string, string> = {
  owner: 'staff.roleOwner',
  admin: 'staff.roleAdmin',
  manager: 'staff.roleManager',
  cashier: 'staff.roleCashier',
  office_hr: 'staff.roleOfficeHR',
  office_inventory: 'staff.roleOfficeInventory',
  waiter: 'staff.roleWaiter',
  chef: 'staff.roleChef',
};

const roleLabelFallback: Record<string, string> = {
  owner: 'Pemilik',
  admin: 'Admin',
  manager: 'Manager',
  cashier: 'Kasir',
  office_hr: 'Staf HR',
  office_inventory: 'Staf Gudang',
  waiter: 'Pelayan',
  chef: 'Koki',
};

const roleColors: Record<string, string> = {
  owner: 'bg-red-100 text-red-800',
  admin: 'bg-indigo-100 text-indigo-800',
  manager: 'bg-purple-100 text-purple-800',
  cashier: 'bg-blue-100 text-blue-800',
  office_hr: 'bg-teal-100 text-teal-800',
  office_inventory: 'bg-amber-100 text-amber-800',
  waiter: 'bg-green-100 text-green-800',
  chef: 'bg-orange-100 text-orange-800',
};

// Available permission sections that can be granted
const ALL_PERMISSIONS: { key: string; label: string; description: string; icon: string }[] = [
  { key: 'pos', label: 'POS / Kasir', description: 'Akses halaman kasir (Point of Sale)', icon: '🛒' },
  { key: 'dashboard', label: 'Dashboard', description: 'Ringkasan penjualan & statistik', icon: '📊' },
  { key: 'orders', label: 'Pesanan', description: 'Lihat & kelola pesanan', icon: '📋' },
  { key: 'products', label: 'Produk', description: 'Kelola katalog produk', icon: '📦' },
  { key: 'addon_groups', label: 'Grup Add-on', description: 'Kelola promo / paket bundling', icon: '🎁' },
  { key: 'customers', label: 'Member / Pelanggan', description: 'Data anggota koperasi', icon: '👥' },
  { key: 'stock_movements', label: 'Stok & Opname', description: 'Mutasi & penyesuaian stok', icon: '📈' },
  { key: 'salary_deductions', label: 'Potong Gaji', description: 'Konfirmasi potongan gaji anggota', icon: '💰' },
  { key: 'reports', label: 'Laporan', description: 'Akses laporan penjualan & stok', icon: '📑' },
  { key: 'whatsapp', label: 'WhatsApp', description: 'Kampanye & notifikasi WhatsApp', icon: '💬' },
  { key: 'staff', label: 'Manajemen Staf', description: 'Kelola akun pengguna & akses', icon: '👤' },
  { key: 'settings', label: 'Pengaturan', description: 'Konfigurasi sistem', icon: '⚙️' },
  { key: 'db_backup', label: 'Backup Database', description: 'Ekspor & impor database', icon: '💾' },
];

function getDefaultPermissionsForRole(role: string): string[] {
  switch (role) {
    case 'owner':
      return ALL_PERMISSIONS.map(p => p.key);
    case 'admin':
    case 'manager':
      return ['pos', 'dashboard', 'orders', 'products', 'addon_groups', 'customers', 'reports', 'whatsapp', 'staff', 'salary_deductions', 'stock_movements'];
    case 'office_hr':
      return ['dashboard', 'customers', 'salary_deductions', 'reports'];
    case 'office_inventory':
      return ['products', 'stock_movements', 'reports'];
    case 'cashier':
    case 'waiter':
      return ['pos', 'orders', 'customers'];
    case 'chef':
      return ['pos', 'orders'];
    default:
      return ['pos'];
  }
}

export default function StaffPage() {
  const { t } = useI18n();
  const { user, currentTenant } = useAuthStore();
  const currentRole = currentTenant?.role || user?.role || 'cashier';
  const canManagePermissions = ['owner', 'admin', 'manager'].includes(currentRole);
  const { confirm, ConfirmDialog } = useConfirm();

  const [staff, setStaff] = useState<Staff[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetPwStaff, setResetPwStaff] = useState<Staff | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);
  const [permStaff, setPermStaff] = useState<Staff | null>(null);
  const [permSelections, setPermSelections] = useState<string[]>([]);
  const [savingPerms, setSavingPerms] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'cashier',
    pin: '',
    permissions: [] as string[],
  });
  const [newPassword, setNewPassword] = useState('');

  const fetchStaff = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data } = await api.get('/staff');
      setStaff(data.staff || []);
    } catch (err: any) {
      console.error('[StaffPage] Error fetching staff:', err);
      const msg = err?.response?.data?.error || t('staff.failedToLoad');
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchStaff(); }, []);

  const openAdd = () => {
    setEditingStaff(null);
    const defaultRole = 'cashier';
    setForm({
      name: '', email: '', password: '', role: defaultRole, pin: '',
      permissions: getDefaultPermissionsForRole(defaultRole),
    });
    setShowForm(true);
  };

  const openEdit = (s: Staff) => {
    setEditingStaff(s);
    setForm({
      name: s.name,
      email: s.email || '',
      password: '',
      role: s.role,
      pin: '',
      permissions: s.permissions || getDefaultPermissionsForRole(s.role),
    });
    setShowForm(true);
  };

  const openPermissions = (s: Staff) => {
    setPermStaff(s);
    setPermSelections(s.permissions || getDefaultPermissionsForRole(s.role));
    setShowPermissions(true);
  };

  const openResetPw = (s: Staff) => {
    setResetPwStaff(s);
    setNewPassword('');
    setShowResetPw(true);
  };

  const handleRoleChange = (newRole: string) => {
    setForm({
      ...form,
      role: newRole,
      permissions: getDefaultPermissionsForRole(newRole),
    });
  };

  const toggleFormPermission = (key: string) => {
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter(p => p !== key)
        : [...prev.permissions, key],
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        name: form.name,
        email: form.email || null,
        role: form.role,
        permissions: form.permissions,
        ...(form.password ? { password: form.password } : {}),
        ...(form.pin ? { pin: form.pin } : {}),
      };

      if (editingStaff) {
        await api.put(`/staff/${editingStaff.id}`, payload);
        toast.success(t('staff.updatedToast'));
      } else {
        payload.password = form.password;
        await api.post('/staff', payload);
        toast.success(t('staff.addedToast'));
      }
      setShowForm(false);
      fetchStaff();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || t('staff.failedToSave'));
    }
  };

  const handleSavePermissions = async () => {
    if (!permStaff) return;
    setSavingPerms(true);
    try {
      await api.put(`/staff/${permStaff.id}`, { permissions: permSelections });
      toast.success('Hak akses berhasil diperbarui');
      setShowPermissions(false);
      fetchStaff();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Gagal menyimpan hak akses');
    } finally {
      setSavingPerms(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPwStaff || !newPassword) return;
    try {
      await api.put(`/staff/${resetPwStaff.id}`, { password: newPassword });
      toast.success(t('staff.resetPasswordToast'));
      setShowResetPw(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || t('staff.failedToReset'));
    }
  };

  const toggleActive = async (s: Staff) => {
    try {
      await api.post(`/staff/${s.id}/${s.is_active ? 'deactivate' : 'reactivate'}`);
      fetchStaff();
    } catch {
      toast.error(t('staff.failedToUpdate'));
    }
  };

  const handleDeleteStaff = async (s: Staff) => {
    if (String(s.id) === String(user?.id)) {
      toast.error('Tidak dapat menghapus akun yang sedang Anda gunakan.');
      return;
    }
    const confirmed = await confirm(
      `Apakah Anda yakin ingin menghapus permanen akun staf "${s.name}"?`,
      {
        title: 'Hapus Akun Staf',
        confirmLabel: 'Hapus Akun',
        destructive: true,
      }
    );
    if (!confirmed) return;
    try {
      await api.delete(`/staff/${s.id}`);
      toast.success('Akun staf berhasil dihapus');
      fetchStaff();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus akun staf');
    }
  };

  const getRoleLabel = (role: string) => {
    const key = roleColorKey[role];
    if (key) {
      const translated = t(key);
      // If translation key is returned as-is, use fallback
      if (translated === key) return roleLabelFallback[role] || role;
      return translated;
    }
    return roleLabelFallback[role] || role;
  };

  const filteredStaff = staff.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      s.name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.role?.toLowerCase().includes(q) ||
      (getRoleLabel(s.role) || '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('staff.title')}</h1>
        <Button onClick={openAdd}><Plus size={16} className="mr-1" /> {t('staff.addButton')}</Button>
      </div>

      {/* ── Staff Search Bar ── */}
      <div className="relative mb-6">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Cari berdasarkan nama staf, email, atau jabatan..."
          className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none text-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
            title="Hapus pencarian"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Error state */}
      {errorMsg && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
          <div className="text-sm text-red-700">
            <strong>Gagal memuat data staf:</strong> {errorMsg}
          </div>
          <Button variant="outline" size="sm" onClick={fetchStaff} className="text-red-700 border-red-300 hover:bg-red-100">
            Coba Lagi
          </Button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl p-5 border border-gray-100 animate-pulse space-y-3">
              <div className="flex justify-between items-start">
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                  <div className="h-3 bg-gray-100 rounded w-1/2"></div>
                </div>
                <div className="h-5 bg-gray-200 rounded-full w-16"></div>
              </div>
              <div className="flex gap-1">
                <div className="h-4 bg-gray-100 rounded w-12"></div>
                <div className="h-4 bg-gray-100 rounded w-14"></div>
              </div>
              <div className="flex gap-2 pt-2">
                <div className="h-8 bg-gray-100 rounded w-16"></div>
                <div className="h-8 bg-gray-100 rounded w-20"></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStaff.map((s) => (
            <div key={s.id} className={`bg-white rounded-xl p-5 border transition-all ${s.is_active ? 'border-gray-100 hover:shadow-md' : 'border-gray-200 opacity-60'}`}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-bold text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-500">{s.email || '—'}</p>
                  {(s.pin || s.pin_hash) && (
                    <p className="text-xs text-green-600 mt-1">{t('staff.pinSet')}</p>
                  )}
                </div>
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${roleColors[s.role] || 'bg-gray-100 text-gray-800'}`}>
                  {getRoleLabel(s.role)}
                </span>
              </div>

              {/* Permission badges */}
              {s.permissions && s.permissions.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {s.permissions.slice(0, 4).map((p) => {
                    const perm = ALL_PERMISSIONS.find(ap => ap.key === p);
                    return (
                      <span key={p} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-gray-50 text-gray-600 border border-gray-100">
                        {perm?.icon || '📌'} {perm?.label || p}
                      </span>
                    );
                  })}
                  {s.permissions.length > 4 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-50 text-gray-500 border border-gray-100">
                      +{s.permissions.length - 4} lainnya
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-3">
                <Button variant="outline" size="sm" onClick={() => openEdit(s)}>
                  <Edit size={14} className="mr-1" /> {t('common.edit')}
                </Button>
                {canManagePermissions && s.role !== 'owner' && (
                  <Button variant="outline" size="sm" onClick={() => openPermissions(s)} className="text-indigo-600 border-indigo-200 hover:bg-indigo-50">
                    <Shield size={14} className="mr-1" /> Hak Akses
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => openResetPw(s)}>
                  <RotateCcw size={14} className="mr-1" /> {t('staff.resetPwButton')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleActive(s)}
                  className={s.is_active ? 'text-amber-600 hover:text-amber-700 hover:bg-amber-50' : 'text-green-600 hover:text-green-700 hover:bg-green-50'}
                >
                  {s.is_active ? t('staff.deactivate') : t('staff.reactivate')}
                </Button>
                {canManagePermissions && s.role !== 'owner' && String(s.id) !== String(user?.id) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteStaff(s)}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    title="Hapus Akun Staf"
                  >
                    <Trash2 size={14} className="mr-1" /> Hapus
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filteredStaff.length === 0 && !errorMsg && (
        <p className="text-center text-gray-500 py-12">
          {searchQuery ? `Tidak ada staf yang cocok dengan "${searchQuery}"` : t('staff.empty')}
        </p>
      )}

      {/* ── Add/Edit Staff Modal ──────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{editingStaff ? t('staff.modalTitleEdit') : t('staff.modalTitleAdd')}</h2>
              <button onClick={() => setShowForm(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <input
                type="text" placeholder={t('staff.namePlaceholder')} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand" required
              />
              <input
                type="email" placeholder={`${t('auth.email')} (${t('common.optional')})`} value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
              />
              <input
                type="password" placeholder={editingStaff ? t('staff.newPasswordPlaceholder') : t('staff.passwordPlaceholder')}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
                required={!editingStaff}
              />
              <div>
                <input
                  type="text" placeholder={editingStaff ? t('staff.pinPlaceholderEdit') : t('staff.pinPlaceholderAdd')}
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  maxLength={6}
                  pattern="[0-9]*"
                  inputMode="numeric"
                />
                <p className="text-xs text-gray-500 mt-1">{t('staff.pinHint')}</p>
              </div>
              <select
                value={form.role} onChange={(e) => handleRoleChange(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
              >
                {VALID_ROLES.map((r) => (
                  <option key={r} value={r}>{getRoleLabel(r)}</option>
                ))}
              </select>

              {/* ── Inline Permission Checkboxes (in form) ─── */}
              {canManagePermissions && form.role !== 'owner' && (
                <div className="border rounded-lg p-3 bg-gray-50/50">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={16} className="text-indigo-600" />
                    <span className="text-sm font-semibold text-gray-700">Hak Akses Section</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {ALL_PERMISSIONS.map((perm) => {
                      const isChecked = form.permissions.includes(perm.key);
                      return (
                        <label
                          key={perm.key}
                          className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all text-sm
                            ${isChecked
                              ? 'bg-indigo-50 border border-indigo-200 text-indigo-800'
                              : 'bg-white border border-gray-100 text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleFormPermission(perm.key)}
                            className="sr-only"
                          />
                          <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all
                            ${isChecked ? 'bg-indigo-600' : 'bg-gray-200'}`}
                          >
                            {isChecked && <Check size={10} className="text-white" />}
                          </div>
                          <span className="text-sm">{perm.icon}</span>
                          <span className="truncate">{perm.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <Button type="submit" className="w-full">{editingStaff ? t('staff.updateButton') : t('staff.addButton')}</Button>
            </form>
          </div>
        </div>
      )}

      {/* ── Standalone Permission Grant Modal ─────────────────────────────── */}
      {showPermissions && permStaff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Shield size={20} className="text-indigo-600" />
                Hak Akses
              </h2>
              <button onClick={() => setShowPermissions(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Atur akses section untuk <strong>{permStaff.name}</strong>{' '}
              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${roleColors[permStaff.role] || 'bg-gray-100 text-gray-800'}`}>
                {getRoleLabel(permStaff.role)}
              </span>
            </p>

            <div className="space-y-1.5 mb-5">
              {ALL_PERMISSIONS.map((perm) => {
                const isChecked = permSelections.includes(perm.key);
                return (
                  <label
                    key={perm.key}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all
                      ${isChecked
                        ? 'bg-indigo-50 border border-indigo-200'
                        : 'bg-gray-50 border border-gray-100 hover:bg-gray-100'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        setPermSelections(prev =>
                          prev.includes(perm.key)
                            ? prev.filter(p => p !== perm.key)
                            : [...prev, perm.key]
                        );
                      }}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all
                      ${isChecked ? 'bg-indigo-600 shadow-sm' : 'bg-gray-200'}`}
                    >
                      {isChecked && <Check size={12} className="text-white" />}
                    </div>
                    <span className="text-base">{perm.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isChecked ? 'text-indigo-800' : 'text-gray-700'}`}>{perm.label}</p>
                      <p className="text-[11px] text-gray-400 truncate">{perm.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setPermSelections(getDefaultPermissionsForRole(permStaff.role));
                }}
              >
                Reset Default
              </Button>
              <Button
                className="flex-1"
                onClick={handleSavePermissions}
                disabled={savingPerms}
              >
                {savingPerms ? 'Menyimpan...' : 'Simpan Hak Akses'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Password Modal ──────────────────────────────────────────── */}
      {showResetPw && resetPwStaff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{t('staff.resetPasswordTitle')}</h2>
              <button onClick={() => setShowResetPw(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">{t('staff.resetPasswordBody', { name: resetPwStaff.name })}</p>
            <div className="space-y-4">
              <input
                type="password" placeholder={t('staff.newPasswordPlaceholder')} value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
              />
              <Button onClick={handleResetPassword} className="w-full">{t('staff.resetPasswordTitle')}</Button>
            </div>
          </div>
        </div>
      )}

      {ConfirmDialog}
    </div>
  );
}