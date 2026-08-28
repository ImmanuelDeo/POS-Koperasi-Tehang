'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, Send, Play, Pause, X,
  Clock, RefreshCw, ShieldCheck, UserCheck, MessageSquare, Plus, Info, Check, Eye
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';

interface ProviderStatus {
  configured: boolean;
  providerId: string;
  providerName: string;
  accountName: string;
  verifiedNumber: string;
  qualityRating: string;
  totalOptInMembers: number;
  error?: string;
}

interface WhatsAppTemplate {
  id: string;
  template_name: string;
  category: 'MARKETING' | 'UTILITY';
  language: string;
  status: string;
  body_text: string;
  footer_text?: string;
  buttons?: Array<{ type: string; text: string }>;
  variable_schema?: string[];
}

interface WhatsAppCampaign {
  id: string;
  name: string;
  template_id: string;
  template_name: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  scheduled_at_utc: string | null;
  scheduled_at_wib_label: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by: string;
  creator_name: string;
  approved_by: string | null;
  approver_name: string | null;
  recipient_count_estimate: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  skipped_count: number;
  created_at: string;
  template_variables?: Record<string, string>;
  target_criteria?: Record<string, any>;
}

interface EstimateResult {
  totalMembers: number;
  eligibleCount: number;
  excludedNoPhone: number;
  excludedInvalidPhone: number;
  excludedNoOptIn: number;
  excludedOptedOut: number;
  requiresOwnerApproval: boolean;
  samplePlaceholderPreview?: {
    recipient_name: string;
    business_name: string;
    formatted_body: string;
    footer?: string;
  };
}

export default function WhatsAppCampaignsPage() {
  const { currentTenant } = useAuthStore();
  const userRole = currentTenant?.role || 'cashier';
  const isOwner = userRole === 'owner';
  const isAdminOrOwner = isOwner || userRole === 'admin';

  const [activeTab, setActiveTab] = useState('campaigns');
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingTemplates, setSyncingTemplates] = useState(false);

  // Wizard state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [campaignName, setCampaignName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [promoTitle, setPromoTitle] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [targetDepartment, setTargetDepartment] = useState('all');
  const [scheduleType, setScheduleType] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');

  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Detail Modal state
  const [selectedCampaign, setSelectedCampaign] = useState<WhatsAppCampaign | null>(null);
  const [campaignStats, setCampaignStats] = useState<Record<string, number> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchStatusAndData = useCallback(async () => {
    try {
      setLoading(true);
      const [statusRes, campRes, tplRes] = await Promise.all([
        api.get('/whatsapp-campaigns/provider/status').catch(() => ({ data: null })),
        api.get('/whatsapp-campaigns').catch(() => ({ data: { campaigns: [] } })),
        api.get('/whatsapp-campaigns/templates').catch(() => ({ data: { templates: [] } })),
      ]);

      if (statusRes.data) setProviderStatus(statusRes.data);
      if (campRes.data?.campaigns) setCampaigns(campRes.data.campaigns);
      if (tplRes.data?.templates) setTemplates(tplRes.data.templates);
    } catch (err: any) {
      toast.error('Gagal memuat data kampanye WhatsApp');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatusAndData();
  }, [fetchStatusAndData]);

  // Recalculate estimate whenever target / template changes
  const runEstimate = useCallback(async () => {
    if (!selectedTemplateId) return;
    try {
      setEstimating(true);
      const res = await api.post('/whatsapp-campaigns/estimate', {
        template_id: selectedTemplateId,
        department: targetDepartment,
        template_variables: {
          business_name: 'Koperasi Tehang',
          promo_title: promoTitle || 'Promo Sembako Spesial',
          promo_code: promoCode,
          valid_until: validUntil || 'Akhir Bulan Ini',
        },
      });
      setEstimate(res.data);
    } catch {
      // ignore
    } finally {
      setEstimating(false);
    }
  }, [selectedTemplateId, targetDepartment, promoTitle, promoCode, validUntil]);

  useEffect(() => {
    if (isCreateOpen && wizardStep >= 2) {
      runEstimate();
    }
  }, [isCreateOpen, wizardStep, runEstimate]);

  const handleSyncTemplates = async () => {
    try {
      setSyncingTemplates(true);
      const res = await api.post('/whatsapp-campaigns/templates/sync');
      toast.success(`Berhasil sinkronisasi ${res.data.synced_count} template resmi`);
      fetchStatusAndData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal sinkronisasi template');
    } finally {
      setSyncingTemplates(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!campaignName.trim()) {
      toast.error('Nama kampanye wajib diisi');
      return;
    }
    if (!selectedTemplateId) {
      toast.error('Template wajib dipilih');
      return;
    }

    let scheduledIso: string | undefined = undefined;
    if (scheduleType === 'scheduled') {
      if (!scheduleDate) {
        toast.error('Tanggal jadwal pengiriman wajib diisi');
        return;
      }
      const localDateTimeStr = `${scheduleDate}T${scheduleTime || '09:00'}:00`;
      const dateObj = new Date(localDateTimeStr);
      if (isNaN(dateObj.getTime()) || dateObj <= new Date()) {
        toast.error('Jadwal pengiriman harus berupa waktu di masa depan');
        return;
      }
      scheduledIso = dateObj.toISOString();
    }

    try {
      setSubmitting(true);
      const res = await api.post('/whatsapp-campaigns', {
        name: campaignName.trim(),
        template_id: selectedTemplateId,
        template_variables: {
          business_name: 'Koperasi Tehang',
          promo_title: promoTitle.trim() || 'Promo Sembako',
          promo_code: promoCode.trim(),
          valid_until: validUntil.trim() || 'Waktu Terbatas',
        },
        target_criteria: {
          department: targetDepartment,
          opt_in_only: true,
        },
        schedule_type: scheduleType,
        scheduled_at_iso: scheduledIso,
      });

      toast.success(
        res.data.requiresOwnerApproval
          ? 'Draft kampanye berhasil dibuat. Membutuhkan persetujuan Owner (>100 penerima).'
          : 'Kampanye WhatsApp berhasil diproses!'
      );

      setIsCreateOpen(false);
      resetWizard();
      fetchStatusAndData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal membuat kampanye');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = async (id: string, action: 'start' | 'pause' | 'resume' | 'cancel' | 'approve') => {
    try {
      await api.post(`/whatsapp-campaigns/${id}/${action}`);
      toast.success(`Aksi ${action} berhasil diterapkan`);
      fetchStatusAndData();
      if (selectedCampaign?.id === id) {
        openDetailModal(id);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || `Gagal menjalankan aksi ${action}`);
    }
  };

  const openDetailModal = async (campaignId: string) => {
    try {
      setDetailLoading(true);
      const res = await api.get(`/whatsapp-campaigns/${campaignId}`);
      setSelectedCampaign(res.data.campaign);
      setCampaignStats(res.data.stats);
    } catch {
      toast.error('Gagal memuat detail kampanye');
    } finally {
      setDetailLoading(false);
    }
  };

  const resetWizard = () => {
    setWizardStep(1);
    setCampaignName('');
    setSelectedTemplateId(templates[0]?.id || '');
    setPromoTitle('');
    setPromoCode('');
    setValidUntil('');
    setTargetDepartment('all');
    setScheduleType('immediate');
    setScheduleDate('');
    setScheduleTime('09:00');
    setEstimate(null);
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline" className="bg-slate-100 text-slate-700">Draft</Badge>;
      case 'scheduled':
        return <Badge className="bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-1"><Clock className="w-3 h-3" /> Terjadwal</Badge>;
      case 'running':
        return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white animate-pulse flex items-center gap-1"><Play className="w-3 h-3" /> Berjalan</Badge>;
      case 'paused':
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1"><Pause className="w-3 h-3" /> Dijeda</Badge>;
      case 'completed':
        return <Badge className="bg-primary hover:bg-primary/90 text-white flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Selesai</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Dibatalkan</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Kampanye Promosi WhatsApp</h1>
            <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-0.5">
              Official WhatsApp Business Platform
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Broadcast promo dan penawaran resmi khusus anggota yang telah memberikan izin (Opt-In).
          </p>
        </div>

        {isAdminOrOwner && (
          <Button
            onClick={() => {
              resetWizard();
              setIsCreateOpen(true);
            }}
            className="bg-primary hover:bg-primary/90 text-white font-medium flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Buat Kampanye Baru
          </Button>
        )}
      </div>

      {/* Provider Info Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-primary shadow-sm bg-gradient-to-br from-white to-slate-50/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status Provider</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200 animate-pulse" />
                <p className="font-bold text-slate-900">{providerStatus?.providerName || 'Meta Cloud API'}</p>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{providerStatus?.accountName}</p>
            </div>
            <ShieldCheck className="w-8 h-8 text-primary/80" />
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 shadow-sm bg-gradient-to-br from-white to-slate-50/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Nomor Resmi Terverifikasi</p>
              <p className="font-bold text-slate-900 text-lg mt-1">{providerStatus?.verifiedNumber || '+62 812-****-8890'}</p>
              <Badge variant="outline" className="text-[10px] text-emerald-700 bg-emerald-50 border-emerald-200 mt-0.5">
                Rating: {providerStatus?.qualityRating || 'GREEN'}
              </Badge>
            </div>
            <CheckCircle2 className="w-8 h-8 text-emerald-500/80" />
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 shadow-sm bg-gradient-to-br from-white to-slate-50/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Anggota Opt-In Promo</p>
              <p className="font-bold text-slate-900 text-lg mt-1">{providerStatus?.totalOptInMembers ?? 0} Orang</p>
              <p className="text-[11px] text-blue-600 mt-0.5">Izin pemasaran tercatat</p>
            </div>
            <UserCheck className="w-8 h-8 text-blue-500/80" />
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-indigo-500 shadow-sm bg-gradient-to-br from-white to-slate-50/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Kampanye</p>
              <p className="font-bold text-slate-900 text-lg mt-1">{campaigns.length} Kampanye</p>
              <p className="text-[11px] text-indigo-600 mt-0.5">{campaigns.filter(c => c.status === 'completed').length} Selesai dikirim</p>
            </div>
            <MessageSquare className="w-8 h-8 text-indigo-500/80" />
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-slate-100 p-1 border">
          <TabsTrigger value="campaigns" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Daftar Kampanye ({campaigns.length})
          </TabsTrigger>
          <TabsTrigger value="templates" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Template Resmi ({templates.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Campaigns Table */}
        <TabsContent value="campaigns" className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="p-4 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-slate-800">Riwayat & Jadwal Kampanye</CardTitle>
                <CardDescription className="text-xs">Kelola pengiriman promosi, status pengiriman, jeda, dan laporan.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={fetchStatusAndData} disabled={loading}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                Segarkan
              </Button>
            </CardHeader>

            <CardContent className="p-0">
              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                  <p className="text-sm">Memuat daftar kampanye...</p>
                </div>
              ) : campaigns.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <MessageSquare className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                  <p className="text-sm font-medium text-slate-600">Belum ada kampanye WhatsApp yang dibuat</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                    Klik tombol <strong>"Buat Kampanye Baru"</strong> di atas untuk merancang promo sembako dan broadcast resmi kepada anggota koperasi.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead className="font-semibold text-slate-700">Nama Kampanye</TableHead>
                      <TableHead className="font-semibold text-slate-700">Template</TableHead>
                      <TableHead className="font-semibold text-slate-700">Jadwal (WIB)</TableHead>
                      <TableHead className="font-semibold text-slate-700">Status</TableHead>
                      <TableHead className="font-semibold text-slate-700">Progres Pengiriman</TableHead>
                      <TableHead className="text-right font-semibold text-slate-700">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((camp) => {
                      const totalTarget = camp.recipient_count_estimate || 1;
                      const progressPct = Math.min(100, Math.round(((camp.sent_count + camp.failed_count + camp.skipped_count) / totalTarget) * 100));

                      return (
                        <TableRow key={camp.id} className="hover:bg-slate-50/50">
                          <TableCell>
                            <p className="font-semibold text-slate-900">{camp.name}</p>
                            <p className="text-xs text-slate-400">Dibuat oleh: {camp.creator_name || 'Admin'}</p>
                          </TableCell>
                          <TableCell>
                            <code className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                              {camp.template_name}
                            </code>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-slate-700">
                              {camp.scheduled_at_wib_label || 'Kirim Langsung'}
                            </span>
                          </TableCell>
                          <TableCell>
                            {renderStatusBadge(camp.status)}
                            {camp.recipient_count_estimate > 100 && !camp.approved_by && camp.status === 'scheduled' && (
                              <p className="text-[10px] text-amber-600 font-medium mt-1">Perlu Persetujuan Owner</p>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 w-44">
                              <div className="flex justify-between text-xs font-medium text-slate-600">
                                <span>{camp.sent_count} / {camp.recipient_count_estimate} terkirim</span>
                                <span>{progressPct}%</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-1.5 rounded-full transition-all duration-300 ${
                                    camp.status === 'completed' ? 'bg-primary' : 'bg-emerald-500'
                                  }`}
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                              {camp.failed_count > 0 && (
                                <p className="text-[10px] text-rose-600">{camp.failed_count} gagal dikirim</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDetailModal(camp.id)}
                              title="Lihat Detail & Laporan"
                            >
                              <Eye className="w-4 h-4 text-slate-600" />
                            </Button>

                            {/* Pause button */}
                            {camp.status === 'running' && isAdminOrOwner && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAction(camp.id, 'pause')}
                                className="text-amber-600 border-amber-200 hover:bg-amber-50"
                                title="Jeda Sementara"
                              >
                                <Pause className="w-3.5 h-3.5 mr-1" />
                                Jeda
                              </Button>
                            )}

                            {/* Resume button */}
                            {camp.status === 'paused' && isAdminOrOwner && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAction(camp.id, 'resume')}
                                className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                                title="Lanjutkan Pengiriman"
                              >
                                <Play className="w-3.5 h-3.5 mr-1" />
                                Lanjut
                              </Button>
                            )}

                            {/* Owner Approval button */}
                            {isOwner && !camp.approved_by && camp.recipient_count_estimate > 100 && (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => handleAction(camp.id, 'approve')}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                              >
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Setujui
                              </Button>
                            )}

                            {/* Cancel button */}
                            {['scheduled', 'running', 'paused', 'draft'].includes(camp.status) && isAdminOrOwner && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleAction(camp.id, 'cancel')}
                                className="text-rose-600 hover:bg-rose-50"
                                title="Batalkan Kampanye"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Templates */}
        <TabsContent value="templates" className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="p-4 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-slate-800">Template Pesan Resmi Terverifikasi</CardTitle>
                <CardDescription className="text-xs">
                  Hanya template kategori MARKETING yang telah disetujui resmi oleh Meta WhatsApp Platform yang dapat digunakan untuk kampanye.
                </CardDescription>
              </div>
              {isAdminOrOwner && (
                <Button variant="outline" size="sm" onClick={handleSyncTemplates} disabled={syncingTemplates}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncingTemplates ? 'animate-spin' : ''}`} />
                  Sinkronisasi dari Meta
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              {templates.map((tpl) => (
                <div key={tpl.id} className="border rounded-lg p-4 bg-slate-50/50 space-y-3 relative flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-semibold text-sm text-slate-900 truncate">{tpl.template_name}</h4>
                      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                        {tpl.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">Bahasa: {tpl.language} | Kategori: {tpl.category}</p>

                    <div className="bg-white p-3 rounded border text-xs text-slate-700 mt-3 whitespace-pre-wrap font-sans leading-relaxed shadow-sm">
                      {tpl.body_text}
                    </div>

                    {tpl.footer_text && (
                      <p className="text-[11px] text-slate-400 mt-1 italic">{tpl.footer_text}</p>
                    )}
                  </div>

                  {tpl.buttons && tpl.buttons.length > 0 && (
                    <div className="pt-2 border-t flex flex-wrap gap-1.5">
                      {tpl.buttons.map((b, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">
                          🔘 {b.text}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal: Wizard Buat Kampanye Baru */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg text-slate-900">Buat Kampanye WhatsApp Baru</h3>
                <p className="text-xs text-slate-500">Langkah {wizardStep} dari 5</p>
              </div>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Step 1: Info Dasar */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-1">
                      Nama Internal Kampanye <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      placeholder="Contoh: Promo Sembako Gajian September 2026"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      className="text-sm"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Nama ini hanya terlihat oleh pengurus koperasi di dashboard.</p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-1">
                      Pilih Template Resmi Approved <span className="text-rose-500">*</span>
                    </label>
                    <div className="space-y-2 max-h-56 overflow-y-auto border rounded-lg p-2 bg-slate-50">
                      {templates.map((tpl) => (
                        <div
                          key={tpl.id}
                          onClick={() => setSelectedTemplateId(tpl.id)}
                          className={`p-3 rounded-lg border cursor-pointer transition-all ${
                            selectedTemplateId === tpl.id
                              ? 'bg-primary/5 border-primary ring-1 ring-primary'
                              : 'bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-slate-900">{tpl.template_name}</span>
                            <Badge variant="outline" className="text-[9px]">ID: {tpl.language}</Badge>
                          </div>
                          <p className="text-xs text-slate-600 mt-1 line-clamp-2">{tpl.body_text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Parameter Promo */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 flex items-start gap-2">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-600" />
                    <span>
                      Masukkan variabel promo. Sesuai kebijakan privasi, sistem melarang keras penggunaan NIK, limit saldo, slip gaji, atau data keuangan anggota dalam pesan promosi.
                    </span>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Judul Promo / Penawaran <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      placeholder="Contoh: Diskon Minyak Goreng 2L & Beras 5kg"
                      value={promoTitle}
                      onChange={(e) => setPromoTitle(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Kode Voucher / Promo (Opsional)
                    </label>
                    <Input
                      placeholder="Contoh: SEMBAKOHEMAT"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Masa Berlaku Promo <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      placeholder="Contoh: 31 Agustus 2026"
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Step 3: Segmentasi Target */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-1">
                      Filter Departemen / Unit Kerja
                    </label>
                    <select
                      value={targetDepartment}
                      onChange={(e) => setTargetDepartment(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="all">Semua Departemen (Semua Anggota)</option>
                      <option value="Produksi">Produksi</option>
                      <option value="Gudang">Gudang & Logistik</option>
                      <option value="Keuangan & HR">Keuangan & HR</option>
                      <option value="Umum">Umum</option>
                    </select>
                  </div>

                  {/* Estimation Breakdown Card */}
                  <div className="bg-slate-50 border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Hasil Estimasi Penerima</h4>
                      {estimating && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white p-3 rounded border">
                        <p className="text-[11px] text-slate-500">Penerima Memenuhi Syarat (Opt-In)</p>
                        <p className="text-xl font-bold text-emerald-600 mt-0.5">{estimate?.eligibleCount ?? 0} Orang</p>
                      </div>
                      <div className="bg-white p-3 rounded border">
                        <p className="text-[11px] text-slate-500">Total Anggota Terdaftar</p>
                        <p className="text-xl font-bold text-slate-700 mt-0.5">{estimate?.totalMembers ?? 0} Orang</p>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t text-xs text-slate-600">
                      <div className="flex justify-between">
                        <span>• Dikecualikan (Belum Opt-In Promosi):</span>
                        <span className="font-semibold text-slate-700">{estimate?.excludedNoOptIn ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>• Dikecualikan (Telah Berhenti / Opt-Out):</span>
                        <span className="font-semibold text-rose-600">{estimate?.excludedOptedOut ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>• Dikecualikan (Nomor HP Tidak Valid / Kosong):</span>
                        <span className="font-semibold text-slate-700">{(estimate?.excludedNoPhone ?? 0) + (estimate?.excludedInvalidPhone ?? 0)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Jadwal Pengiriman */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-1">
                    Waktu Pengiriman
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <div
                      onClick={() => setScheduleType('immediate')}
                      className={`p-4 rounded-lg border cursor-pointer transition-all ${
                        scheduleType === 'immediate'
                          ? 'bg-primary/5 border-primary ring-1 ring-primary'
                          : 'bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Send className="w-4 h-4 text-primary" />
                        <span className="font-semibold text-sm text-slate-900">Kirim Sekarang</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Broadcast langsung dieksekusi setelah dikonfirmasi.</p>
                    </div>

                    <div
                      onClick={() => setScheduleType('scheduled')}
                      className={`p-4 rounded-lg border cursor-pointer transition-all ${
                        scheduleType === 'scheduled'
                          ? 'bg-primary/5 border-primary ring-1 ring-primary'
                          : 'bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-blue-600" />
                        <span className="font-semibold text-sm text-slate-900">Jadwalkan Waktu (WIB)</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Pengiriman otomatis pada tanggal & jam yang ditentukan.</p>
                    </div>
                  </div>

                  {scheduleType === 'scheduled' && (
                    <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded border mt-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700 block mb-1">Tanggal Pengiriman</label>
                        <Input
                          type="date"
                          value={scheduleDate}
                          onChange={(e) => setScheduleDate(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700 block mb-1">Jam (WIB)</label>
                        <Input
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 5: Konfirmasi Final & Bubble Preview */}
              {wizardStep === 5 && (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Simulasi Pesan WhatsApp</h4>

                  {/* Simulated WhatsApp Chat Bubble */}
                  <div className="bg-[#E5DDD5] p-4 rounded-xl shadow-inner border border-slate-300 max-w-md mx-auto">
                    <div className="bg-white p-3 rounded-lg shadow-sm text-xs text-slate-800 space-y-2 relative rounded-tl-none">
                      <p className="font-bold text-emerald-800 text-[11px]">Koperasi Tehang Official</p>
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {estimate?.samplePlaceholderPreview?.formatted_body || 'Memuat preview pesan...'}
                      </p>
                      <div className="pt-2 border-t text-[10px] text-slate-400 italic">
                        {estimate?.samplePlaceholderPreview?.footer || 'Balas STOP untuk berhenti menerima info promo.'}
                      </div>
                    </div>
                  </div>

                  {/* Warning if >100 recipients and not owner */}
                  {estimate?.requiresOwnerApproval && !isOwner && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <span>
                        <strong>Perhatian:</strong> Karena penerima melebihi 100 orang ({estimate.eligibleCount} penerima), kampanye ini akan disimpan sebagai draft terverifikasi dan memerlukan persetujuan dari <strong>Owner</strong> sebelum pengiriman dimulai.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t bg-slate-50 flex items-center justify-between">
              {wizardStep > 1 ? (
                <Button variant="outline" size="sm" onClick={() => setWizardStep((s) => s - 1)}>
                  Kembali
                </Button>
              ) : (
                <div />
              )}

              {wizardStep < 5 ? (
                <Button
                  size="sm"
                  onClick={() => setWizardStep((s) => s + 1)}
                  disabled={wizardStep === 1 && !campaignName.trim()}
                >
                  Lanjut
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleCreateCampaign}
                  disabled={submitting}
                  className="bg-primary hover:bg-primary/90 text-white"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  ) : (
                    <Check className="w-4 h-4 mr-1.5" />
                  )}
                  {scheduleType === 'immediate' ? 'Kirim Kampanye' : 'Jadwalkan Kampanye'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Detail Kampanye & Status Per-Penerima */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg text-slate-900">{selectedCampaign.name}</h3>
                <p className="text-xs text-slate-500">ID: {selectedCampaign.id}</p>
              </div>
              <button onClick={() => setSelectedCampaign(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded border text-xs">
                  <p className="text-slate-400">Status Kampanye</p>
                  <div className="mt-1">{renderStatusBadge(selectedCampaign.status)}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded border text-xs">
                  <p className="text-slate-400">Waktu Mulai / Selesai</p>
                  <p className="font-semibold text-slate-800 mt-1">
                    {selectedCampaign.started_at ? new Date(selectedCampaign.started_at).toLocaleString('id-ID') : '-'}
                  </p>
                </div>
              </div>

              {campaignStats && (
                <div className="border rounded-lg p-4 bg-slate-50/50 space-y-3">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Statistik Pengiriman Pesan</h4>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-white p-2.5 rounded border">
                      <p className="text-slate-400">Terkirim</p>
                      <p className="font-bold text-emerald-600 text-base">{campaignStats.sent || 0}</p>
                    </div>
                    <div className="bg-white p-2.5 rounded border">
                      <p className="text-slate-400">Diterima</p>
                      <p className="font-bold text-blue-600 text-base">{campaignStats.delivered || 0}</p>
                    </div>
                    <div className="bg-white p-2.5 rounded border">
                      <p className="text-slate-400">Dibaca</p>
                      <p className="font-bold text-indigo-600 text-base">{campaignStats.read || 0}</p>
                    </div>
                    <div className="bg-white p-2.5 rounded border">
                      <p className="text-slate-400">Gagal</p>
                      <p className="font-bold text-rose-600 text-base">{campaignStats.failed || 0}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t bg-slate-50 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setSelectedCampaign(null)}>
                Tutup
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
