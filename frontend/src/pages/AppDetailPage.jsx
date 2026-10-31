import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import ConfirmationDialog from '@/components/ConfirmationDialog';
import {
  Play, Square, RotateCcw, Rocket, Trash2, Github, ExternalLink,
  RefreshCw, Globe, Plus, Server, Copy, Check, Database, Network,
  AlertTriangle, Shield, Loader2, FolderOpen, ChevronRight, Clock, Zap,
  Mail, Info, Terminal, FileText, Cpu, Activity, XCircle, ScrollText,
  CreditCard, Star, TrendingUp, Coins, Calendar, Package, Settings, Save
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const stripAnsi = (str) => {
  if (!str) return '';
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
};

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

const recordTypeColor = {
  A: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  AAAA: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  CNAME: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  MX: 'bg-green-500/15 text-green-400 border-green-500/20',
  TXT: 'bg-pink-500/15 text-pink-400 border-pink-500/20',
  NS: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
  SRV: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  CAA: 'bg-red-500/15 text-red-400 border-red-500/20',
};

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handle} className="p-1.5 rounded hover:bg-white/10 transition-colors text-muted-foreground hover:text-white">
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function NavCard({ icon: Icon, title, description, onClick, color = "primary" }) {
  const colorMap = {
    primary: "bg-primary/20 text-primary border-primary/20 hover:border-primary/50",
    blue: "bg-blue-500/20 text-blue-400 border-blue-500/20 hover:border-blue-500/50",
    emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20 hover:border-emerald-500/50",
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/20 hover:border-purple-500/50",
    amber: "bg-amber-500/20 text-amber-400 border-amber-500/20 hover:border-amber-500/50",
  };

  return (
    <div 
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border bg-card/40 p-4 transition-all hover:bg-accent/40 cursor-pointer ${colorMap[color] || colorMap.primary}`}
    >
      <div className="flex items-center gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:scale-110 ${colorMap[color]}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-foreground truncate">{title}</h3>
          <p className="text-[11px] text-muted-foreground truncate">{description}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
      </div>
      {/* Subtle Glow Background */}
      <div className="absolute -right-4 -top-4 h-16 w-16 bg-primary/10 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

export default function AppDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [app, setApp] = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [logs, setLogs] = useState({ app: '', 'server-error': '', 'server-access': '' });
  const [logsLoading, setLogsLoading] = useState({ app: false, 'server-error': false, 'server-access': false });
  const [activeLogTab, setActiveLogTab] = useState('app');
  const [envVars, setEnvVars] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // DNS state
  const [domainData, setDomainData] = useState(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [recordForm, setRecordForm] = useState({ type: 'A', name: '@', value: '', ttl: 3600, priority: '' });
  const [addingRecord, setAddingRecord] = useState(false);
  const [deletingRecord, setDeletingRecord] = useState(null);
  const [parentDomain, setParentDomain] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [pendingAction, setPendingAction] = useState(null);
  const [sslLoading, setSslLoading] = useState(false);
  const [sslDetails, setSslDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Services state
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [serviceActions, setServiceActions] = useState({});
  const [serviceLogs, setServiceLogs] = useState({});
  const [serviceLogsOpen, setServiceLogsOpen] = useState({});
  const [serviceLogsLoading, setServiceLogsLoading] = useState({});
  const [showAddService, setShowAddService] = useState(false);
  const [addServiceForm, setAddServiceForm] = useState({ name: '', command: '', description: '', type: 'custom' });
  const [addingService, setAddingService] = useState(false);
  const [installingRecommended, setInstallingRecommended] = useState(false);
  const [crmLogs, setCrmLogs] = useState([]);
  const [crmLogsLoading, setCrmLogsLoading] = useState(false);
  const [showCrmLogs, setShowCrmLogs] = useState(false);
  const [selectedCrmLog, setSelectedCrmLog] = useState(null);

  // Subscription state
  const [subData, setSubData] = useState(null);
  const [subLoading, setSubLoading] = useState(false);
  const [plans, setPlans] = useState([]);
  const [isActivateOpen, setIsActivateOpen] = useState(false);
  const [activatingPlan, setActivatingPlan] = useState(false);
  const [activateForm, setActivateForm] = useState({ plan_id: '', custom_ends_at: '' });
  const [visiblePlanIds, setVisiblePlanIds] = useState([]);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [isVisibilityDialogOpen, setIsVisibilityDialogOpen] = useState(false);
  
  // PHP Versions state
  const [phpVersions, setPhpVersions] = useState({ active: '', installed: [] });
  const [loadingPhpVersions, setLoadingPhpVersions] = useState(false);
  const [updatingPhpVersion, setUpdatingPhpVersion] = useState(false);
  const [pendingPhpVersion, setPendingPhpVersion] = useState(null);

  const logEndRef = useRef(null);
  const deploymentsTopRef = useRef(null);

  const fetchApp = async () => {
    try {
      const { data } = await api.get(`/apps/${id}`);
      setApp(data);
    } catch (err) {
      if (err.response?.status === 404) navigate('/apps');
    } finally {
      setLoading(false);
    }
  };

  const [settingUpDefaults, setSettingUpDefaults] = useState(false);

  const fetchDomain = async () => {
    setDnsLoading(true);
    try {
      const { data } = await api.get(`/apps/${id}/domain`);
      setDomainData(data);
    } catch { /* domain may not exist yet */ }
    finally { setDnsLoading(false); }
  };

  const fetchParentDomain = async (domainName) => {
    try {
      const { data } = await api.get(`/domains/find-parent?domain=${domainName}`);
      setParentDomain(data);
    } catch {
      setParentDomain(null);
    }
  };

  const handleSetupDefaults = async () => {
    setSettingUpDefaults(true);
    try {
      const { data } = await api.post(`/apps/${id}/domain/setup-defaults`);
      setDomainData(data);
      fetchApp();
      toast.success('Default DNS records created!');
    } catch {
      toast.error('Failed to set up default records');
    } finally {
      setSettingUpDefaults(false);
    }
  };

  useEffect(() => {
    fetchApp();
    loadDeployments();
    const interval = setInterval(() => {
      if (app?.status === 'deploying') {
        fetchApp();
        loadDeployments();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [id, app?.status]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [deployments]);

  useEffect(() => {
    if (activeTab === 'dns') {
      fetchDomain();
    }
    if (activeTab === 'ssl') {
      fetchApp();
      fetchSslDetails();
    }
    if (activeTab === 'services') {
      fetchServices();
    }
    if (activeTab === 'env') {
      loadEnv();
    }
    if (activeTab === 'logs') {
      loadLogs(activeLogTab);
    }
    if (activeTab === 'subscription' && !subData) {
      fetchSubscriptions();
    }
    if (activeTab === 'overview') {
      fetchPhpVersions();
    }
    if (activeTab === 'subscription') {
      fetchPlans();
      if (subData?.domain) fetchVisibility(subData.domain);
    }
  }, [activeTab, activeLogTab, subData?.domain]);

  useEffect(() => {
    const effectiveDomain = domainData ?? app?.domain_record;
    if (activeTab === 'dns' && effectiveDomain && !effectiveDomain.dns_managed) {
      fetchParentDomain(effectiveDomain.domain);
    }
  }, [activeTab, domainData, app?.domain_record]);

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    setActionLoading(true);
    try {
      if (action === 'delete') {
        await api.delete(`/apps/${id}`);
        navigate('/apps');
        return;
      }
      await api.post(`/apps/${id}/${action}`);
      if (action === 'deploy' || action === 'deploy-zero-downtime') {
        setActiveTab('deployments');
        loadDeployments();
      }
      fetchApp();
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to ${action}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleForceStop = async () => {
    try {
      await api.post(`/apps/${id}/force-stop-deployment`);
      toast.success('Deployment force stopped');
      fetchApp(true);
      if (activeTab === 'deployments') loadDeployments();
    } catch (err) {
      toast.error('Failed to stop deployment');
    }
  };

  const handleAction = (action) => {
    setPendingAction(action);
  };

  const handleToggleAutoDeploy = async () => {
    setActionLoading(true);
    try {
      const { data } = await api.post(`/apps/${id}/toggle-auto-deploy`);
      setApp(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to toggle auto-deploy');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConnectGitHub = async () => {
    setActionLoading(true);
    try {
      // Disconnect first to ensure a clean state
      await api.post('/github/disconnect');

      sessionStorage.setItem('gh_auth_return', JSON.stringify({
        path: window.location.pathname + window.location.search,
        time: Date.now()
      }));

      const { data } = await api.get('/github/redirect');
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error('Failed to get GitHub connection URL');
      }
    } catch (err) {
      toast.error('Failed to initiate GitHub connection');
    } finally {
      setActionLoading(false);
    }
  };

  const loadDeployments = async () => {
    const { data } = await api.get(`/apps/${id}/deployments`);
    setDeployments(data);
  };

  const fetchCrmLogs = async () => {
    setCrmLogsLoading(true);
    try {
      const { data } = await api.get(`/apps/${id}/crm-logs`);
      setCrmLogs(data);
    } catch {
      toast.error('Failed to fetch CRM API logs');
    } finally {
      setCrmLogsLoading(false);
    }
  };

  const fetchSubscriptions = async () => {
    setSubLoading(true);
    try {
      const { data } = await api.get(`/apps/${id}/subscriptions`);
      setSubData(data);
    } catch {
      toast.error('Failed to load subscriptions');
    } finally {
      setSubLoading(false);
    }
  };

  const fetchPlans = async () => {
    try {
      const { data } = await api.get('/subscription/admin-plans');
      setPlans(data);
    } catch {
      toast.error('Failed to load plans');
    }
  };

  const fetchVisibility = async (domain) => {
    if (!domain) return;
    setVisibilityLoading(true);
    try {
      const { data } = await api.get(`/subscription/domain-plans/${domain}`);
      setVisiblePlanIds(data);
    } catch {
      console.error('Failed to fetch visibility');
    } finally {
      setVisibilityLoading(false);
    }
  };

  const handleToggleVisibility = async (planId) => {
    if (!subData?.domain) return;
    const isAdding = !visiblePlanIds.includes(planId);
    const newIds = isAdding 
      ? [...visiblePlanIds, planId]
      : visiblePlanIds.filter(id => id !== planId);
    
    // Optimistic update
    setVisiblePlanIds(newIds);
    
    try {
      await api.post(`/subscription/domain-plans/${subData.domain}`, { plan_ids: newIds });
      toast.success(isAdding ? 'Plan made visible' : 'Plan hidden');
    } catch {
      toast.error('Failed to update visibility');
      // Revert on error
      setVisiblePlanIds(visiblePlanIds);
    }
  };

  const handleActivateSubscription = async (e) => {
    e.preventDefault();
    if (!activateForm.plan_id) return toast.error('Please select a plan');
    setActivatingPlan(true);
    try {
      await api.post(`/apps/${id}/subscriptions/activate`, activateForm);
      toast.success('Subscription activated successfully!');
      setIsActivateOpen(false);
      setActivateForm({ plan_id: '', custom_ends_at: '' });
      fetchSubscriptions();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to activate subscription');
    } finally {
      setActivatingPlan(false);
    }
  };

  const loadLogs = async (type = 'app', force = false) => {
    if (!force && logs[type]) return;
    
    setLogsLoading(prev => ({ ...prev, [type]: true }));
    try {
      const { data } = await api.get(`/apps/${id}/logs?type=${type}`);
      setLogs(prev => ({ ...prev, [type]: data.logs }));
    } catch {
      toast.error(`Failed to load ${type} logs`);
    } finally {
      setLogsLoading(prev => ({ ...prev, [type]: false }));
    }
  };

  const loadEnv = async () => {
    const { data } = await api.get(`/apps/${id}/env`);
    setEnvVars(data.env_vars || '');
  };

  const saveEnv = async () => {
    setActionLoading(true);
    try {
      await api.put(`/apps/${id}/env`, { env_vars: envVars });
      toast.success('Environment variables saved!');
    } catch (err) {
      toast.error('Failed to save environment variables.');
    } finally {
      setActionLoading(false);
    }
  };

  const fetchPhpVersions = async () => {
    setLoadingPhpVersions(true);
    try {
      const { data } = await api.get('/server/php-versions');
      setPhpVersions(data);
    } catch {
      toast.error('Failed to fetch installed PHP versions');
    } finally {
      setLoadingPhpVersions(false);
    }
  };

  const handleUpdatePhpVersion = async () => {
    const version = pendingPhpVersion === 'default' ? null : pendingPhpVersion;
    setUpdatingPhpVersion(true);
    try {
      const { data } = await api.post(`/apps/${id}/php-version`, { version });
      toast.success(data.message);
      setPendingPhpVersion(null);
      fetchApp();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update PHP version');
    } finally {
      setUpdatingPhpVersion(false);
    }
  };

  const handleAddRecord = async (e) => {
    e.preventDefault();
    setAddingRecord(true);
    try {
      await api.post(`/apps/${id}/domain/records`, recordForm);
      toast.success('DNS record added!');
      setRecordForm({ type: 'A', name: '@', value: '', ttl: 3600, priority: '' });
      setShowAddRecord(false);
      fetchDomain();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add record');
    } finally {
      setAddingRecord(false);
    }
  };

  const handleDeleteRecord = async (recordId) => {
    setDeletingRecord(recordId);
    try {
      await api.delete(`/apps/${id}/domain/records/${recordId}`);
      toast.success('Record deleted');
      fetchDomain();
    } catch {
      toast.error('Failed to delete record');
    } finally {
      setDeletingRecord(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post(`/apps/${id}/domain/sync`);
      toast.success('DNS zone synced with BIND9!');
      fetchDomain();
    } catch {
      toast.error('Failed to sync DNS zone');
    } finally {
      setSyncing(false);
    }
  };

  const handleSetupSsl = async () => {
    setSslLoading(true);
    try {
      const { data } = await api.post(`/apps/${id}/ssl/setup`);
      toast.success(data.message || 'SSL setup initiated!');
      if (data.app) setApp(data.app);
      else fetchApp();
    } catch (err) {
      toast.error(err.response?.data?.message || 'SSL setup failed. Certbot might be busy or domain not pointing to IP.');
      fetchApp();
    } finally {
      setSslLoading(false);
    }
  };

  const handleRemoveSsl = async () => {
    setSslLoading(true);
    try {
      const { data } = await api.post(`/apps/${id}/ssl/remove`);
      toast.success(data.message || 'SSL removed!');
      if (data.app) setApp(data.app);
      else fetchApp();
    } catch (err) {
      toast.error('Failed to remove SSL');
      fetchApp();
    } finally {
      setSslLoading(false);
    }
  };

  const handleSecurePanel = async () => {
    setSslLoading(true);
    try {
      const { data } = await api.post(`/apps/${id}/ssl/secure-panel`);
      toast.success(data.message || 'Panel secured!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to secure panel. Check if certificate exists.');
    } finally {
      setSslLoading(false);
    }
  };

  const fetchSslDetails = async () => {
    if (!app?.ssl_enabled && app?.ssl_status !== 'failed') return;
    setLoadingDetails(true);
    try {
      const { data } = await api.get(`/apps/${id}/ssl/details`);
      setSslDetails(data);
    } catch { 
      setSslDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleManageDatabase = async (dbId) => {
    try {
      const { data } = await api.get(`/databases/${dbId}/credentials`);
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/adminer/';
      form.target = '_blank';
      const fields = {
        'auth[driver]': 'pgsql',
        'auth[server]': '127.0.0.1',
        'auth[username]': data.db_user,
        'auth[password]': data.db_password,
        'auth[db]': data.db_name,
      };
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
    } catch (err) {
      toast.error('Failed to retrieve credentials for autologin');
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
  if (!app) return null;

  const statusColor = (app.status === 'running' || app.status === 'idle') ? 'bg-emerald-500' : app.status === 'deploying' ? 'bg-amber-500 animate-pulse' : app.status === 'error' ? 'bg-red-500' : 'bg-slate-500';

  // ─── Services handlers ─────────────────────────────────────────────────────

  const fetchServices = async () => {
    setServicesLoading(true);
    try {
      const { data } = await api.get(`/apps/${id}/services`);
      setServices(data);
    } catch { /* may be empty */ }
    finally { setServicesLoading(false); }
  };

  const serviceAction = async (serviceId, action) => {
    setServiceActions(prev => ({ ...prev, [serviceId]: action }));
    try {
      const { data } = await api.post(`/apps/${id}/services/${serviceId}/${action}`);
      setServices(prev => prev.map(s => s.id === serviceId ? data.service : s));
      toast.success(`Service ${action}ed successfully`);
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to ${action} service`);
    } finally {
      setServiceActions(prev => ({ ...prev, [serviceId]: null }));
    }
  };

  const toggleServiceLogs = async (serviceId) => {
    const isOpen = serviceLogsOpen[serviceId];
    setServiceLogsOpen(prev => ({ ...prev, [serviceId]: !isOpen }));
    if (!isOpen) {
      await fetchServiceLogs(serviceId);
    }
  };

  const fetchServiceLogs = async (serviceId) => {
    setServiceLogsLoading(prev => ({ ...prev, [serviceId]: true }));
    try {
      const { data } = await api.get(`/apps/${id}/services/${serviceId}/logs`);
      setServiceLogs(prev => ({ ...prev, [serviceId]: data.logs }));
    } catch { /* ignore */ }
    finally { setServiceLogsLoading(prev => ({ ...prev, [serviceId]: false })); }
  };

  const deleteService = async (serviceId) => {
    if (!window.confirm('Remove this service?')) return;
    try {
      await api.delete(`/apps/${id}/services/${serviceId}`);
      setServices(prev => prev.filter(s => s.id !== serviceId));
      toast.success('Service removed');
    } catch { toast.error('Failed to remove service'); }
  };

  const handleAddService = async (e) => {
    e.preventDefault();
    setAddingService(true);
    try {
      const { data } = await api.post(`/apps/${id}/services`, addServiceForm);
      setServices(prev => [...prev, data]);
      setAddServiceForm({ name: '', command: '', description: '', type: 'custom' });
      setShowAddService(false);
      toast.success('Service added!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add service');
    } finally { setAddingService(false); }
  };

  const handleInstallRecommended = async () => {
    setInstallingRecommended(true);
    try {
      const { data } = await api.post(`/apps/${id}/services/install-recommended`);
      setServices(data);
      toast.success('Recommended services installed!');
    } catch { toast.error('Failed to install recommended services'); }
    finally { setInstallingRecommended(false); }
  };

  const handleToggleSuspend = async () => {
    setActionLoading(true);
    try {
      const { data } = await api.post(`/apps/${id}/toggle-suspend`);
      toast.success(data.message);
      fetchApp();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to toggle suspension');
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold tracking-tight">{app.name}</h2>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              (app.status === 'running' || app.status === 'idle') ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
              app.status === 'deploying' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
              app.status === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
              'bg-slate-500/10 text-slate-400 border-slate-500/20'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
              {(app.status === 'idle' || app.status === 'running') ? 'running' : (app.status === 'deactivated' ? 'stopped' : app.status)}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            <span className="capitalize border-r border-border pr-2">{app.type}</span>
            <a href={`http://${app.domain}`} target="_blank" rel="noreferrer" className="flex items-center hover:text-primary transition-colors">
              <Globe className="h-3.5 w-3.5 mr-1" />
              {app.domain}
              <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {app.type === 'nextjs' && (
            <>
              <Button size="sm" variant="outline" onClick={() => handleAction('start')} disabled={actionLoading || app.status === 'running'}>
                <Play className="mr-2 h-4 w-4" /> Start
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleAction('stop')} disabled={actionLoading || app.status === 'stopped'}>
                <Square className="mr-2 h-4 w-4" /> Stop
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleAction('restart')} disabled={actionLoading}>
                <RotateCcw className="mr-2 h-4 w-4" /> Restart
              </Button>
            </>
          )}
            <Button size="sm" variant="outline" onClick={() => navigate(`/files?path=/${app.domain}`)}>
              <FolderOpen className="mr-2 h-4 w-4" /> File Manager
            </Button>
           <Button
             size="sm"
             variant={app.status === 'error' ? 'destructive' : 'default'}
             onClick={() => handleAction('deploy')}
             disabled={actionLoading || app.status === 'deploying'}
           >
             {app.status === 'deploying'
               ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
               : <Rocket className="mr-2 h-4 w-4" />
             }
             {app.status === 'deploying' ? 'Deploying...' : (app.status === 'error' ? 'Retry Deploy' : 'Deploy')}
           </Button>

           {app.type === 'nextjs' && app.status !== 'deploying' && (
             <Button
               size="sm"
               variant="outline"
               onClick={() => handleAction('deploy-zero-downtime')}
               disabled={actionLoading}
               title="Build in a separate release, then switch traffic once it is healthy"
             >
               <Zap className="mr-2 h-4 w-4" /> Zero-Downtime Deploy
             </Button>
           )}

           {app.status === 'deploying' && (
             <Button 
               size="sm" 
               variant="destructive" 
               className="h-9 px-3 gap-2 bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500 hover:text-white transition-all shadow-lg shadow-rose-500/10"
               onClick={handleForceStop}
               title="Force Stop Deployment"
             >
               <XCircle className="h-4 w-4" />
               <span className="text-xs font-bold uppercase tracking-wider">Stop</span>
             </Button>
           )}
          <Button size="sm" variant="destructive" onClick={() => handleAction('delete')} disabled={actionLoading}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => {
        setActiveTab(v);
        if (v === 'deployments') loadDeployments();
        if (v === 'overview') fetchApp();
        if (v === 'logs') loadLogs();
        if (v === 'dns') fetchDomain();
        if (v === 'services') fetchServices();
        if (v === 'env') loadEnv();
      }}>
        <TabsList className="grid w-full grid-cols-8 md:w-auto md:inline-flex">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="env">Environment</TabsTrigger>
          <TabsTrigger value="dns" className="flex items-center gap-1.5">
            <Network className="h-3.5 w-3.5" /> DNS
          </TabsTrigger>
          <TabsTrigger value="ssl" className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" /> SSL
          </TabsTrigger>
          <TabsTrigger value="services" className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" /> Services
            {services.some(s => s.status === 'running') && (
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="subscription" className="flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" /> Subscription
          </TabsTrigger>
        </TabsList>

        {/* ── Overview ─────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-6 space-y-6">
          
          {!app.hide_guidelines && (
            <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-6 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                    <Shield className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">Application Management Guidelines</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                      Welcome to your new app! To ensure everything works perfectly, please review our UI/UX and operational guidelines. This includes DNS setup, deployment workflows, and performance tips.
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={() => navigate(`/apps/${app.id}/guidelines`)}
                  className="shrink-0 gap-2 shadow-lg shadow-primary/20"
                >
                  View Detailed Guidelines <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {/* Decorative backgrounds */}
              <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-primary/5 rounded-full blur-3xl opacity-50" />
              <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 bg-primary/5 rounded-full blur-3xl opacity-50" />
            </div>
          )}

          {/* Resource Shortcuts Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Zap className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80">Resource Shortcuts</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <NavCard 
                icon={FolderOpen}
                title="File Manager"
                description="Browse app files"
                onClick={() => navigate(`/files?path=/${app.domain}`)}
              />

              <NavCard 
                icon={Terminal}
                title="Terminal"
                description="Shell access"
                color="amber"
                onClick={() => navigate(`/terminal?path=/${app.domain}`)}
              />

              {app.ssl_status !== 'active' && (
                <NavCard 
                  icon={Shield}
                  title="Setup SSL"
                  description="Secure your app"
                  color="blue"
                  onClick={() => setActiveTab('ssl')}
                />
              )}
              
              {app.databases?.length > 0 && (
                <div className="flex items-center justify-between p-4 rounded-xl border bg-card/40 hover:bg-accent/40 transition-all border-white/5">
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-500/20 p-2.5 rounded-xl text-blue-400">
                      <Database className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400/80 mb-0.5">Database</div>
                      <h4 className="font-semibold text-sm truncate">{app.databases[0].db_name}</h4>
                      <div className="text-[11px] text-muted-foreground truncate">
                        User: <span className="font-mono">{app.databases[0].db_user}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={app.databases[0].status === 'active' ? 'success' : 'destructive'} className="text-[10px] h-5">
                      {app.databases[0].status}
                    </Badge>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 text-[11px] gap-1.5 border-blue-500/20 text-blue-400 hover:bg-blue-500/10"
                      onClick={() => handleManageDatabase(app.databases[0].id)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Manage
                    </Button>
                  </div>
                </div>
              )}

              <NavCard 
                icon={Mail}
                title="Emails"
                description="Managing mailboxes"
                color="violet"
                onClick={() => navigate(`/email?q=${app.domain}`)}
              />

              
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* PHP Runtime Card */}
            <div className="lg:col-span-4">
              <Card className="h-full border-primary/20 bg-primary/5 shadow-lg shadow-primary/5 group relative overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between mb-1">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" /> PHP Runtime
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] font-bold h-5 bg-background shadow-xs border-primary/20 text-primary">
                      FPM
                    </Badge>
                  </div>
                  <CardDescription className="text-xs leading-relaxed">
                    Switch between installed PHP versions for this specific application.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">Active Runtime</span>
                      <Badge variant="secondary" className="font-mono text-xs font-bold px-2 py-0.5 bg-background shadow-sm border-white/5">
                        v{app.php_version || phpVersions.active || '...'}
                      </Badge>
                    </div>

                    <div className="space-y-3">
                      <Select 
                        value={pendingPhpVersion || app.php_version || 'default'} 
                        onValueChange={(val) => setPendingPhpVersion(val)}
                        disabled={updatingPhpVersion || loadingPhpVersions}
                      >
                        <SelectTrigger className="w-full h-11 text-sm font-medium bg-background border-primary/30 shadow-sm hover:border-primary/50 transition-all focus:ring-primary/20">
                          <div className="flex items-center gap-2.5">
                            {updatingPhpVersion || loadingPhpVersions ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            ) : (
                              <Server className="h-4 w-4 text-primary" />
                            )}
                            <SelectValue placeholder="Select version" />
                          </div>
                        </SelectTrigger>
                        <SelectContent className="border-primary/20 bg-card/95 backdrop-blur-md">
                          <SelectItem value="default" className="text-xs font-semibold py-2.5">
                            <div className="flex items-center gap-2">
                              System Default <span className="text-[10px] opacity-70 font-mono">(v{phpVersions.active || '...'})</span>
                            </div>
                          </SelectItem>
                          <div className="h-px bg-white/5 my-1" />
                          {phpVersions.installed?.map(v => (
                            <SelectItem key={v} value={v} className="text-xs font-semibold py-2.5">
                              PHP v{v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      {pendingPhpVersion && pendingPhpVersion !== (app.php_version || 'default') && (
                        <Button 
                          className="w-full h-9 text-xs font-bold gap-2 shadow-lg shadow-primary/20 animate-in fade-in slide-in-from-top-2"
                          onClick={handleUpdatePhpVersion}
                          disabled={updatingPhpVersion}
                        >
                          {updatingPhpVersion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save Configuration
                        </Button>
                      )}
                      
                      <div className={`mt-3 p-3 rounded-xl border transition-all duration-300 ${!app.php_version ? 'bg-amber-500/5 border-amber-500/10' : 'bg-emerald-500/5 border-emerald-500/10'}`}>
                        <div className="flex gap-3">
                          {!app.php_version ? (
                            <>
                              <Info className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                              <div className="space-y-1">
                                <p className="text-[11px] font-bold text-amber-400/90 uppercase tracking-wide">Dynamic Resolution</p>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">
                                  This app automatically follows the control panel's global PHP version updates.
                                </p>
                              </div>
                            </>
                          ) : (
                            <>
                              <Shield className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                              <div className="space-y-1">
                                <p className="text-[11px] font-bold text-emerald-400/90 uppercase tracking-wide">Version Locked</p>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">
                                  Configured to use specific PHP <strong>v{app.php_version}</strong> environment.
                                </p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
                
                {/* Decorative Elements */}
                <div className="absolute top-0 right-0 -mr-8 -mt-8 w-24 h-24 bg-primary/5 rounded-full blur-2xl opacity-50 group-hover:bg-primary/10 transition-colors" />
                <div className="absolute bottom-0 left-0 -ml-8 -mb-8 w-24 h-24 bg-primary/5 rounded-full blur-2xl opacity-50 group-hover:bg-primary/10 transition-colors" />
              </Card>
            </div>

            {/* Repository Details (moved into 8 col span) */}
            <div className="lg:col-span-8">
              <Card className="h-full border-white/10 bg-white/[0.02] shadow-sm">
            <CardHeader>
              <CardTitle>Repository Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block mb-1">Git URL</span>
                  <div className="flex items-center gap-2 font-mono bg-muted/50 p-2 rounded">
                    <Github className="h-4 w-4" /> {app.git_url}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground block mb-1">Branch</span>
                  <div className="font-mono bg-muted/50 p-2 rounded">{app.branch}</div>
                </div>
                {app.git_url?.includes('github.com') && (
                  <div className="col-span-2 p-4 border rounded-xl bg-primary/5 border-primary/10 flex items-center justify-between transition-all hover:bg-primary/10">
                    <div className="flex items-center gap-4">
                      <div className="p-2.5 bg-background rounded-xl border shadow-sm">
                        <Github className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-bold flex items-center gap-2">
                          GitHub Auto-Deploy
                          {app.auto_deploy && <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {app.github_full_name ? app.github_full_name : 'Repo details not connected via OAuth'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {!app.github_full_name && !app.settings?.github_connected ? (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-8 text-[11px] border-amber-500/20 text-amber-500 hover:bg-amber-500/10"
                          onClick={handleConnectGitHub}
                          disabled={actionLoading}
                        >
                          Connect Account
                        </Button>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span className={`text-[11px] font-medium ${app.auto_deploy ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                            {app.auto_deploy ? 'Enabled' : 'Disabled'}
                          </span>
                          <Switch 
                            checked={app.auto_deploy}
                            onCheckedChange={handleToggleAutoDeploy}
                            disabled={actionLoading}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground block mb-1">Deploy Path</span>
                  <div className="font-mono bg-muted/50 p-2 rounded text-xs">{app.deploy_path || 'Not deployed yet'}</div>
                </div>
                {app.type === 'nextjs' && (
                  <div>
                    <span className="text-muted-foreground block mb-1">Internal Port</span>
                    <div className="font-mono bg-muted/50 p-2 rounded">{app.port || 'Will be assigned on deploy'}</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </TabsContent>

        {/* ── Deployments ──────────────────────────────────────── */}
        <TabsContent value="deployments" className="mt-6">
          <div ref={deploymentsTopRef} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Deployment History</CardTitle>
                <CardDescription>View recent deployment logs and statuses</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="gap-2 border-primary/20 hover:bg-primary/10"
                  onClick={() => {
                    setShowCrmLogs(true);
                    fetchCrmLogs();
                  }}
                >
                  <ScrollText className="h-4 w-4 text-primary" /> View API Logs
                </Button>
                <Button size="sm" variant="ghost" onClick={loadDeployments}><RefreshCw className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent>
              {deployments.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">No deployments found.</div>
              ) : (
                <div className="space-y-4">
                  {deployments.map((dep, idx) => (
                    <div key={dep.id} className="border rounded-md p-4">
                      <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                          <Badge variant={dep.status === 'success' ? 'success' : dep.status === 'failed' ? 'destructive' : 'warning'}>
                            {dep.status}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {new Date(dep.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                  <div className="bg-black text-green-400 p-4 rounded-md font-mono text-xs overflow-y-auto max-h-64 whitespace-pre-wrap">
                        {stripAnsi(dep.log_output) || 'No output recorded'}
                        <div ref={idx === 0 ? logEndRef : null} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* CRM API Logs Modal */}
          <ConfirmationDialog
            open={showCrmLogs}
            onOpenChange={setShowCrmLogs}
            title="CRM API Integration Logs"
            description="History of external CRM API calls for this application's customer."
            onConfirm={() => setShowCrmLogs(false)}
            confirmText="Close"
            showCancel={false}
            maxWidth="sm:max-w-3xl lg:max-w-4xl"
          >
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              {crmLogsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : crmLogs.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-xl border-white/5 bg-white/[0.02]">
                  <div className="flex justify-center mb-3">
                    <div className="p-3 rounded-full bg-muted/50">
                      <FileText className="h-8 w-8 text-muted-foreground opacity-20" />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground font-medium">No CRM API logs found for this application.</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1 italic">API calls are triggered after successful deployments.</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {crmLogs.map((log) => (
                    <div 
                      key={log.id} 
                      className="group relative border border-white/5 bg-white/[0.02] rounded-xl overflow-hidden transition-all hover:border-primary/20"
                    >
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <Badge variant={log.status_code >= 200 && log.status_code < 300 ? 'success' : 'destructive'} className="font-mono text-xs px-2 py-0.5">
                              {log.status_code}
                            </Badge>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs font-bold uppercase tracking-wider h-6 bg-primary/5 text-primary border-primary/10">
                                {log.method}
                              </Badge>
                              <span className="text-sm font-mono text-muted-foreground truncate max-w-[400px]" title={log.url}>
                                {log.url}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span className="text-xs font-medium whitespace-nowrap">
                              {new Date(log.created_at).toLocaleString()}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                              <Rocket className="h-4 w-4" /> Payload
                            </label>
                            <div className="bg-black/40 rounded-lg p-3 font-mono text-xs text-primary/80 border border-white/5 whitespace-pre-wrap overflow-x-auto max-h-48 shadow-inner">
                              {log.payload || 'No payload'}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                              <Terminal className="h-4 w-4" /> Response
                            </label>
                            <div className={`bg-black/40 rounded-lg p-3 font-mono text-xs border border-white/5 whitespace-pre-wrap overflow-x-auto max-h-48 shadow-inner ${log.status_code >= 400 ? 'text-red-400/80' : 'text-emerald-400/80'}`}>
                              {log.response || 'No response'}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Hover decoration */}
                      <div className="absolute top-0 right-0 w-24 h-24 bg-primary/[0.02] blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ConfirmationDialog>
        </TabsContent>

        {/* ── Environment ──────────────────────────────────────── */}
        <TabsContent value="env" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Environment Variables</CardTitle>
              <CardDescription>Standard .env file format (KEY=VALUE). Injected during deployment.</CardDescription>
            </CardHeader>
            <CardContent>
              <textarea
                value={envVars}
                onChange={(e) => setEnvVars(e.target.value)}
                className="w-full h-64 font-mono text-sm p-4 rounded-md border bg-muted/50 focus:ring-2 focus:ring-primary outline-none"
                placeholder={`APP_ENV=production\nAPI_KEY=your-secret`}
              />
              <div className="mt-4 flex justify-end">
                <Button onClick={saveEnv} disabled={actionLoading}>Save .env Config</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── DNS Management ───────────────────────────────────── */}
        <TabsContent value="dns" className="mt-6 space-y-4">
          {(() => {
            const effectiveDomain = domainData ?? app.domain_record;
            if (dnsLoading) return (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            );
            if (!effectiveDomain) return (
              <Card className="border-dashed border-amber-500/30 bg-amber-500/5">
                <CardContent className="flex items-start gap-4 py-6">
                  <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-400 text-sm">No Domain Linked</p>
                    <p className="text-xs text-muted-foreground mt-1">This app doesn't have a domain record yet. It should have been created automatically — try refreshing.</p>
                    <Button size="sm" className="mt-3" variant="outline" onClick={fetchDomain}>
                      <RefreshCw className="h-3.5 w-3.5 mr-2" /> Refresh
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
            return (
              <>
                {/* Domain Info Card */}
                <Card className="border-white/10 bg-white/[0.02]">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20">
                          <Globe className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-base">{effectiveDomain.domain}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${effectiveDomain.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                            {effectiveDomain.status}
                          </span>
                          {effectiveDomain.dns_managed && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                              <Shield className="h-2.5 w-2.5" /> BIND9 Managed
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                  {effectiveDomain.dns_managed && (
                      <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="shrink-0">
                        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                        Sync Zone
                      </Button>
                    )}
                  </div>

                  {/* Nameservers */}
                  {(effectiveDomain.nameserver_1 || effectiveDomain.nameserver_2) && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">Point Your Domain to These Nameservers</p>
                      <div className="grid grid-cols-2 gap-2">
                        {[1, 2, 3, 4].filter(n => effectiveDomain[`nameserver_${n}`]).map(n => (
                          <div key={n} className="flex items-center justify-between bg-white/[0.03] border border-white/8 rounded-lg px-3 py-2">
                            <span className="text-xs text-muted-foreground mr-2">NS{n}</span>
                            <code className="text-xs font-mono text-white flex-1">{effectiveDomain[`nameserver_${n}`]}</code>
                            <CopyBtn value={effectiveDomain[`nameserver_${n}`]} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* DNS Records or Documentation */}
              {!effectiveDomain.dns_managed ? (
                <div className="flex justify-center pt-2 pb-12">
                  <div className="w-full max-w-[55%] bg-blue-500/5 border border-blue-500/10 rounded-2xl p-8 relative overflow-hidden group">
                    {/* Decorative background element */}
                    <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors duration-700" />
                    
                    <div className="flex items-center gap-4 mb-6">
                      <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 shadow-lg shadow-blue-500/5">
                        <Shield className="h-6 w-6 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white tracking-tight">DNS Management Policy</h3>
                        <p className="text-[11px] text-blue-400 font-medium uppercase tracking-wider mt-0.5">Subdomain Configuration</p>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-3">
                        <p className="text-sm text-gray-300 leading-relaxed font-medium">
                          This domain is managed under a parent DNS zone.
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          To maintain a lean and efficient configuration, the system automatically aggregates subdomain records under their respective primary domains.
                        </p>
                      </div>

                      <div className="bg-white/[0.03] rounded-xl p-5 border border-white/5 space-y-4">
                        <div className="flex items-center gap-2 text-xs font-semibold text-white mb-1">
                          <Info className="h-3.5 w-3.5 text-blue-400" />
                          Key Implementation Details
                        </div>
                        <ul className="space-y-3">
                          {[
                            { title: "Centralized Control", desc: "All DNS records for this app are stored within the parent domain's record set." },
                            { title: "Automatic Sync", desc: "Base A records are automatically managed; changes to the parent zone safely include this app." },
                            { title: "Custom Records", desc: "If you need additional CNAME or TXT records, please add them directly to the parent domain." }
                          ].map((item, i) => (
                            <li key={i} className="flex gap-3">
                              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500/40 shrink-0" />
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-white/90">{item.title}</p>
                                <p className="text-[11px] text-muted-foreground leading-normal">{item.desc}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex items-center gap-3 pt-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full border-blue-500/20 hover:bg-blue-500/10 hover:border-blue-500/30 text-xs font-medium h-9"
                          onClick={() => navigate(`/domains${parentDomain ? `?q=${parentDomain.domain}` : ''}`)}
                        >
                          Go to Domains Panel <ChevronRight className="h-3 w-3 ml-2" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <Card className="border-white/10 bg-white/[0.02]">
                  <CardHeader className="flex flex-row items-center justify-between pb-4">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Database className="h-4 w-4 text-primary" /> DNS Records
                      </CardTitle>
                      <CardDescription>{(effectiveDomain.dns_records || effectiveDomain.dnsRecords)?.length || 0} records</CardDescription>
                    </div>
                    <Button size="sm" onClick={() => setShowAddRecord(v => !v)} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Add Record
                    </Button>
                  </CardHeader>

                  {showAddRecord && (
                    <div className="mx-6 mb-4 p-4 rounded-xl border border-primary/20 bg-primary/5 animate-in fade-in slide-in-from-top-2 duration-300">
                      <form onSubmit={handleAddRecord}>
                        <p className="text-sm font-semibold mb-3">New DNS Record</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="text-[11px] text-muted-foreground mb-1 block">Type</label>
                            <Select
                              value={recordForm.type}
                              onValueChange={value => setRecordForm(f => ({ ...f, type: value }))}
                            >
                              <SelectTrigger className="w-full h-9 text-sm bg-white/5 border-white/10">
                                <SelectValue placeholder="Type" />
                              </SelectTrigger>
                              <SelectContent>
                                {RECORD_TYPES.map(t => (
                                  <SelectItem key={t} value={t}>{t}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-[11px] text-muted-foreground mb-1 block">Name</label>
                            <Input
                              value={recordForm.name}
                              onChange={e => setRecordForm(f => ({ ...f, name: e.target.value }))}
                              placeholder="@ or subdomain"
                              className="h-9 text-sm bg-white/5 border-white/10"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="text-[11px] text-muted-foreground mb-1 block">Value</label>
                            <Input
                              value={recordForm.value}
                              onChange={e => setRecordForm(f => ({ ...f, value: e.target.value }))}
                              placeholder="IP, hostname, or text..."
                              className="h-9 text-sm bg-white/5 border-white/10"
                              required
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                          <div>
                            <label className="text-[11px] text-muted-foreground mb-1 block">TTL (seconds)</label>
                            <Input
                              type="number"
                              value={recordForm.ttl}
                              onChange={e => setRecordForm(f => ({ ...f, ttl: parseInt(e.target.value) }))}
                              placeholder="3600"
                              className="h-9 text-sm bg-white/5 border-white/10"
                            />
                          </div>
                          {(recordForm.type === 'MX' || recordForm.type === 'SRV') && (
                            <div>
                              <label className="text-[11px] text-muted-foreground mb-1 block">Priority</label>
                              <Input
                                type="number"
                                value={recordForm.priority}
                                onChange={e => setRecordForm(f => ({ ...f, priority: e.target.value }))}
                                placeholder="10"
                                className="h-9 text-sm bg-white/5 border-white/10"
                              />
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 mt-4 justify-end">
                          <Button size="sm" type="button" variant="ghost" onClick={() => setShowAddRecord(false)}>Cancel</Button>
                          <Button size="sm" type="submit" disabled={addingRecord}>
                            {addingRecord ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                            Add Record
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}

                  <CardContent className="px-0 pb-0">
                    {(!(effectiveDomain.dns_records || effectiveDomain.dnsRecords) || (effectiveDomain.dns_records || effectiveDomain.dnsRecords).length === 0) ? (
                      <div className="text-center py-10 text-muted-foreground">
                        <Server className="h-8 w-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm font-medium mb-1">No DNS records yet</p>
                        <p className="text-xs mb-4">Auto-create the essential records (A, CNAME, MX, SPF) for this domain</p>
                        <Button size="sm" onClick={handleSetupDefaults} disabled={settingUpDefaults} className="gap-1.5">
                          {settingUpDefaults ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                          Setup Default Records
                        </Button>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {/* Header */}
                        <div className="grid grid-cols-[80px_1fr_1fr_80px_40px] gap-3 px-6 py-2">
                          {['Type', 'Name', 'Value', 'TTL', ''].map(h => (
                            <span key={h} className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{h}</span>
                          ))}
                        </div>
                        {(effectiveDomain.dns_records || effectiveDomain.dnsRecords).map(record => (
                          <div key={record.id} className="grid grid-cols-[80px_1fr_1fr_80px_40px] gap-3 px-6 py-3 items-center hover:bg-white/[0.02] transition-colors group">
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold border ${recordTypeColor[record.type] || 'bg-muted text-muted-foreground border-transparent'}`}>
                              {record.type}
                            </span>
                            <code className="text-sm font-mono text-white/80 truncate">{record.name}</code>
                            <div className="flex items-center gap-1 min-w-0">
                              <code className="text-sm font-mono text-muted-foreground truncate flex-1">{record.value}</code>
                              <CopyBtn value={record.value} />
                            </div>
                            <span className="text-xs text-muted-foreground">{record.ttl}s</span>
                            <button
                              onClick={() => handleDeleteRecord(record.id)}
                              disabled={deletingRecord === record.id}
                              className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                            >
                              {deletingRecord === record.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />
                              }
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
            );
          })()}
        </TabsContent>

        {/* ── SSL Management ───────────────────────────────────── */}
        <TabsContent value="ssl" className="mt-6 space-y-4">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" /> SSL Management (Let's Encrypt)
                  </CardTitle>
                  <CardDescription>Secure your application with an automatic SSL certificate</CardDescription>
                </div>
                <Badge variant={
                  app.ssl_status === 'active' ? 'success' :
                  app.ssl_status === 'pending' ? 'warning' :
                  app.ssl_status === 'failed' ? 'destructive' : 'secondary'
                }>
                  <span className={`h-1.5 w-1.5 rounded-full mr-2 ${
                    app.ssl_status === 'active' ? 'bg-emerald-500' :
                    app.ssl_status === 'pending' ? 'bg-amber-500 animate-pulse' :
                    app.ssl_status === 'failed' ? 'bg-red-500' : 'bg-slate-500'
                  }`} />
                  {app.ssl_status?.toUpperCase() || 'NONE'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 flex gap-4">
                <div className="p-2 bg-primary/10 rounded-full h-fit">
                  <Info className="h-4 w-4 text-primary" />
                </div>
                <div className="text-sm space-y-1">
                  <p className="font-semibold text-foreground">Important Prerequisites</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    1. Ensure your domain <strong>{app.domain}</strong> is pointing to this server's IP.<br />
                    2. DNS propagation can take some time. If it fails, wait and try again.<br />
                    3. Let's Encrypt has rate limits. Avoid repeated failed attempts.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">SSL Status</span>
                  <div className="flex items-center gap-2">
                    {app.ssl_enabled ? (
                      <span className="text-emerald-400 flex items-center gap-1.5 text-sm font-semibold">
                        <Check className="h-4 w-4" /> Secure (HTTPS Enabled)
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center gap-1.5 text-sm font-semibold">
                        <AlertTriangle className="h-4 w-4" /> Not Secure (HTTP Only)
                      </span>
                    )}
                  </div>
                </div>
                {app.ssl_last_check_at && (
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Last Sync</span>
                    <div className="text-sm text-foreground flex items-center gap-2 font-mono">
                      <Clock className="h-3.5 w-3.5" /> {new Date(app.ssl_last_check_at).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-white/5 flex flex-wrap gap-3">
                {!app.ssl_enabled ? (
                  <Button 
                    onClick={handleSetupSsl} 
                    disabled={sslLoading || app.ssl_status === 'pending'}
                    className="gap-2"
                  >
                    {sslLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                    Setup SSL Certificate
                  </Button>
                ) : (
                  <>
                    <Button 
                      onClick={handleSetupSsl} 
                      disabled={sslLoading || app.ssl_status === 'pending'}
                      variant="outline"
                      className="gap-2"
                    >
                      {sslLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Re-issue Certificate
                    </Button>
                    <Button 
                      onClick={handleRemoveSsl} 
                      disabled={sslLoading}
                      variant="destructive"
                      className="gap-2"
                    >
                      {sslLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Remove SSL
                    </Button>

                    {/* Conditional Panel SSL Button */}
                    {app.domain === app.settings?.ns_default_domain && (
                      <Button 
                        onClick={handleSecurePanel} 
                        disabled={sslLoading}
                        variant="secondary"
                        className="gap-2 bg-primary/20 text-primary hover:bg-primary/30 border-primary/20 transition-all font-bold"
                      >
                        {sslLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                        Secure Hosting Panel (Port 8083)
                      </Button>
                    )}
                  </>
                )}
              </div>

              {app.ssl_enabled && (
                <div className="pt-4 border-t border-white/5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                         <Shield className="h-4 w-4 text-primary" /> Force HTTPS
                      </h4>
                      <p className="text-[11px] text-muted-foreground leading-relaxed italic mt-1 max-w-xl">
                        Redirects all HTTP traffic for this app to HTTPS.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                       <Switch
                         checked={app.force_https}
                         onCheckedChange={async (checked) => {
                           try {
                             setSslLoading(true);
                             const { data } = await api.post(`/apps/${id}/ssl/force-https`);
                             if (data.app) {
                                window.location.reload();
                             }
                           } catch (err) {
                             toast.error(err.response?.data?.message || 'Failed to toggle Force HTTPS');
                             setSslLoading(false);
                           }
                         }}
                         disabled={sslLoading}
                       />
                    </div>
                  </div>
                </div>
              )}

              { (sslLoading || app.ssl_log) && (
                <div className="space-y-3 pt-6 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                      {sslLoading ? 'Operation in Progress...' : 'Last SSL Operation Log'}
                    </span>
                    <Badge variant="outline" className="text-[10px] h-5">Certbot Output</Badge>
                  </div>
                  <div className="bg-black/40 border border-white/5 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-slate-400 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto min-h-[100px] flex flex-col">
                    {sslLoading ? (
                      <div className="flex flex-col items-center justify-center py-8 gap-3 text-primary/60 animate-pulse">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <p className="text-xs font-medium">Provisioning Let's Encrypt certificate... This may take up to a minute.</p>
                      </div>
                    ) : (
                      app.ssl_log
                    )}
                  </div>
                </div>
              )}

              {sslDetails && Object.keys(sslDetails).length > 0 && (
                <div className="space-y-6 pt-6 border-t border-white/5 animate-in fade-in duration-500">
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                       <FileText className="h-4 w-4 text-primary" /> Certificate Details
                    </h4>
                    <p className="text-xs text-muted-foreground">Detailed information and raw PEM data for the installed certificate.</p>
                  </div>

                  {sslDetails.metadata && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4 bg-white/[0.02] border border-white/5 rounded-2xl p-6">
                      <div className="space-y-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">Subject</span>
                          <span className="text-sm font-medium text-foreground truncate" title={sslDetails.metadata.subject}>{sslDetails.metadata.subject}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">Issuer</span>
                          <span className="text-sm font-medium text-foreground truncate" title={sslDetails.metadata.issuer}>{sslDetails.metadata.issuer}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">Signature Algorithm</span>
                          <span className="text-sm font-mono text-foreground">sha256WithRSAEncryption</span>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">Valid From</span>
                          <span className="text-sm font-medium text-foreground">{sslDetails.metadata.not_before}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">Valid Until</span>
                          <span className="text-sm font-medium text-foreground">{sslDetails.metadata.not_after}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/60">Fingerprint (SHA1)</span>
                          <span className="text-[11px] font-mono text-muted-foreground truncate" title={sslDetails.metadata.fingerprint}>{sslDetails.metadata.fingerprint}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                         <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">SSL Certificate (CRT)</span>
                         <CopyBtn value={sslDetails.cert} />
                      </div>
                      <textarea 
                        readOnly 
                        className="w-full h-32 bg-black/40 border border-white/5 rounded-xl p-3 font-mono text-[10px] text-slate-400 resize-none focus:outline-none"
                        value={sslDetails.cert}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                         <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">SSL Private Key (KEY)</span>
                         <CopyBtn value={sslDetails.key} />
                      </div>
                      <textarea 
                        readOnly 
                        className="w-full h-32 bg-black/40 border border-white/5 rounded-xl p-3 font-mono text-[10px] text-slate-400 resize-none focus:outline-none"
                        value={sslDetails.key}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                         <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">SSL Certificate Authority / Intermediate (CABUNDLE)</span>
                         <CopyBtn value={sslDetails.chain} />
                      </div>
                      <textarea 
                        readOnly 
                        className="w-full h-32 bg-black/40 border border-white/5 rounded-xl p-3 font-mono text-[10px] text-slate-400 resize-none focus:outline-none"
                        value={sslDetails.chain}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Background Services ───────────────────────────────── */}
        <TabsContent value="services" className="mt-6 space-y-4">
          {/* Header card */}
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-primary" /> Background Services
                </CardTitle>
                <CardDescription>
                  Manage persistent workers, queue processors, and schedulers for this app
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleInstallRecommended}
                  disabled={installingRecommended}
                  className="gap-1.5 text-xs border-amber-500/20 text-amber-400 hover:bg-amber-500/10"
                >
                  {installingRecommended
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Zap className="h-3.5 w-3.5" />}
                  Recommended
                </Button>
                <Button size="sm" variant="outline" onClick={fetchServices} disabled={servicesLoading} className="gap-1.5 text-xs">
                  <RefreshCw className={`h-3.5 w-3.5 ${servicesLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button size="sm" onClick={() => setShowAddService(v => !v)} className="gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Add Service
                </Button>
              </div>
            </CardHeader>

            {/* Add custom service form */}
            {showAddService && (
              <div className="mx-6 mb-4 p-4 rounded-xl border border-primary/20 bg-primary/5 animate-in fade-in slide-in-from-top-2 duration-300">
                <form onSubmit={handleAddService}>
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-primary" /> New Background Service
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">Name</label>
                      <Input
                        value={addServiceForm.name}
                        onChange={e => setAddServiceForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Queue Worker"
                        className="h-9 text-sm bg-white/5 border-white/10"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">Type</label>
                      <Select value={addServiceForm.type} onValueChange={v => setAddServiceForm(f => ({ ...f, type: v }))}>
                        <SelectTrigger className="h-9 text-sm bg-white/5 border-white/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="php-worker">PHP Worker</SelectItem>
                          <SelectItem value="node-worker">Node Worker</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] text-muted-foreground mb-1 block">Command</label>
                      <Input
                        value={addServiceForm.command}
                        onChange={e => setAddServiceForm(f => ({ ...f, command: e.target.value }))}
                        placeholder="php artisan queue:work --sleep=3 --tries=3"
                        className="h-9 text-sm bg-white/5 border-white/10 font-mono"
                        required
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] text-muted-foreground mb-1 block">Description (optional)</label>
                      <Input
                        value={addServiceForm.description}
                        onChange={e => setAddServiceForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="What does this service do?"
                        className="h-9 text-sm bg-white/5 border-white/10"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4 justify-end">
                    <Button size="sm" type="button" variant="ghost" onClick={() => setShowAddService(false)}>Cancel</Button>
                    <Button size="sm" type="submit" disabled={addingService}>
                      {addingService ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                      Add Service
                    </Button>
                  </div>
                </form>
              </div>
            )}

            <CardContent className="px-0 pb-0">
              {servicesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : services.length === 0 ? (
                <div className="text-center py-14 px-6">
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 inline-block mb-4">
                    <Cpu className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">No background services yet</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Add custom workers or install recommended services for your app type
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <Button size="sm" variant="outline" onClick={handleInstallRecommended} disabled={installingRecommended} className="gap-1.5">
                      {installingRecommended ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 text-amber-400" />}
                      Install Recommended
                    </Button>
                    <Button size="sm" onClick={() => setShowAddService(true)} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Add Custom
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {services.map(service => {
                    const isActing = !!serviceActions[service.id];
                    const isRunning = service.status === 'running';
                    const isFailed = service.status === 'failed';
                    const logsOpen = !!serviceLogsOpen[service.id];
                    const logsLoading = !!serviceLogsLoading[service.id];

                    const statusCfg = {
                      running: { color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400 animate-pulse' },
                      stopped: { color: 'bg-slate-500/10 text-slate-400 border-slate-500/20', dot: 'bg-slate-500' },
                      failed:  { color: 'bg-red-500/10 text-red-400 border-red-500/20', dot: 'bg-red-500 animate-pulse' },
                      unknown: { color: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20', dot: 'bg-zinc-500' },
                    }[service.status] || { color: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20', dot: 'bg-zinc-500' };

                    return (
                      <div key={service.id} className="px-6 py-4">
                        {/* Service row */}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          {/* Status dot + info */}
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="mt-1 flex-shrink-0">
                              <span className={`h-2 w-2 rounded-full block ${statusCfg.dot}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-foreground truncate">{service.name}</p>
                                {service.recommended && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                                    Recommended
                                  </span>
                                )}
                                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${statusCfg.color}`}>
                                  {service.status}
                                </span>
                              </div>
                              {service.description && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">{service.description}</p>
                              )}
                              <code className="text-[10px] text-muted-foreground/60 font-mono mt-1 block truncate">
                                $ {service.command}
                              </code>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {/* Start */}
                            <button
                              onClick={() => serviceAction(service.id, 'start')}
                              disabled={isActing || isRunning}
                              title="Start"
                              className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                            >
                              {isActing && serviceActions[service.id] === 'start'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Play className="h-3.5 w-3.5" />}
                            </button>
                            {/* Stop */}
                            <button
                              onClick={() => serviceAction(service.id, 'stop')}
                              disabled={isActing || !isRunning}
                              title="Stop"
                              className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                            >
                              {isActing && serviceActions[service.id] === 'stop'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Square className="h-3.5 w-3.5" />}
                            </button>
                            {/* Restart */}
                            <button
                              onClick={() => serviceAction(service.id, 'restart')}
                              disabled={isActing}
                              title="Restart"
                              className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                            >
                              {isActing && serviceActions[service.id] === 'restart'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <RotateCcw className="h-3.5 w-3.5" />}
                            </button>
                            {/* Toggle logs */}
                            <button
                              onClick={() => toggleServiceLogs(service.id)}
                              title="View Logs"
                              className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-all ${logsOpen ? 'border-primary/30 text-primary bg-primary/10' : 'border-white/10 text-muted-foreground hover:text-primary hover:bg-primary/5'}`}
                            >
                              <ScrollText className="h-3.5 w-3.5" />
                            </button>
                            {/* Delete */}
                            <button
                              onClick={() => deleteService(service.id)}
                              title="Remove service"
                              className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-all"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Live Logs Panel */}
                        {logsOpen && (
                          <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="rounded-xl border border-white/5 overflow-hidden">
                              {/* Log toolbar */}
                              <div className="flex items-center justify-between px-4 py-2 bg-black/60 border-b border-white/5">
                                <div className="flex items-center gap-2">
                                  <Activity className="h-3.5 w-3.5 text-primary" />
                                  <span className="text-[11px] font-mono text-muted-foreground font-semibold uppercase tracking-wider">
                                    {service.name} — Live Output
                                  </span>
                                  {isRunning && (
                                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
                                    </span>
                                  )}
                                </div>
                                <button
                                  onClick={() => fetchServiceLogs(service.id)}
                                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-white transition-colors"
                                  disabled={logsLoading}
                                >
                                  <RefreshCw className={`h-3 w-3 ${logsLoading ? 'animate-spin' : ''}`} />
                                  Refresh
                                </button>
                              </div>
                              {/* Log body */}
                              <div className="h-56 overflow-y-auto bg-black/40 p-4 font-mono text-[11px] leading-relaxed">
                                {logsLoading ? (
                                  <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Loading logs...</span>
                                  </div>
                                ) : (
                                  <pre className="whitespace-pre-wrap text-slate-300">
                                    {stripAnsi(serviceLogs[service.id] || '(no logs yet)')}
                                  </pre>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Logs ─────────────────────────────────────────────── */}
        <TabsContent value="logs" className="mt-6">
          <Card>
            <Tabs value={activeLogTab} onValueChange={setActiveLogTab} className="w-full">
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <div className="flex items-center gap-4">
                  <CardTitle className="text-base">Application Logs</CardTitle>
                  <TabsList className="h-8 p-1 bg-white/[0.05] border border-white/10 rounded-lg">
                    <TabsTrigger value="app" className="h-6 px-3 rounded-md data-[state=active]:bg-white/10 data-[state=active]:text-white">
                      App Logs
                    </TabsTrigger>
                    <TabsTrigger value="server-error" className="h-6 px-3 rounded-md data-[state=active]:bg-red-500/10 data-[state=active]:border data-[state=active]:border-red-500/20 data-[state=active]:text-red-400">
                      Server Errors
                    </TabsTrigger>
                    <TabsTrigger value="server-access" className="h-6 px-3 rounded-md data-[state=active]:bg-emerald-500/10 data-[state=active]:border data-[state=active]:border-emerald-500/20 data-[state=active]:text-emerald-400">
                      Server Access
                    </TabsTrigger>
                  </TabsList>
                </div>
                <Button size="sm" variant="ghost" onClick={() => loadLogs(activeLogTab, true)} disabled={logsLoading[activeLogTab]} className="h-8 w-8 p-0 hover:bg-white/10 hover:text-white">
                  <RefreshCw className={`h-4 w-4 ${logsLoading[activeLogTab] ? 'animate-spin' : ''}`} />
                </Button>
              </CardHeader>
              <CardContent>
                {['app', 'server-error', 'server-access'].map(tab => (
                  <TabsContent key={tab} value={tab} className="mt-0">
                    <div className="bg-black p-4 rounded-md font-mono text-xs overflow-y-auto h-96 leading-relaxed">
                      {logsLoading[tab] && !logs[tab] ? (
                        <div className="flex items-center justify-center h-full text-white/50">
                          <RefreshCw className="h-6 w-6 animate-spin mr-2" /> Loading logs...
                        </div>
                      ) : logs[tab] ? (
                        logs[tab].split('\n').map((line, i) => {
                          let className = "text-gray-300";
                          if (tab === 'app') {
                            const isError = /error|exception|failed/i.test(line);
                            const isSuccess = /success|info/i.test(line);
                            if (isError) className = "text-red-400 font-medium";
                            else if (isSuccess) className = "text-emerald-400";
                          } else if (tab === 'server-error') {
                            className = "text-red-400 font-medium";
                          } else if (tab === 'server-access') {
                            className = "text-emerald-400";
                          }
                          
                          return (
                            <div key={`${tab}-${i}`} className={`whitespace-pre-wrap break-words ${className}`}>
                              {line || ' '}
                            </div>
                          );
                        })
                      ) : (
                        <span className="text-gray-300">No logs available.</span>
                      )}
                    </div>
                  </TabsContent>
                ))}
              </CardContent>
            </Tabs>
          </Card>
        </TabsContent>

        {/* ── Subscription ───────────────────────────────────────── */}
        <TabsContent value="subscription" className="mt-6 space-y-5">
          {subLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !subData ? (
            <div className="p-8 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
              <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No subscription data loaded yet.</p>
            </div>
          ) : !subData.domain ? (
            <Card className="border-dashed border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-start gap-4 py-6">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-400 text-sm">No Domain Configured</p>
                  <p className="text-xs text-muted-foreground mt-1">This app has no domain set. Add a domain to track subscriptions.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Domain Context Badge - Full Width Top */}
              <div className="flex items-center gap-3 px-4 py-3 bg-card border rounded-xl">
                <div className="p-1.5 rounded-lg bg-muted">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-medium text-muted-foreground italic">Domain:</span>
                  <span className="font-mono text-sm font-extrabold text-foreground bg-muted/50 px-3 py-1 rounded-lg border border-white/5 truncate shadow-sm">
                    {subData.domain}
                  </span>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={fetchSubscriptions} 
                  className="h-9 gap-2 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="text-xs font-semibold">Sync Info</span>
                </Button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Side: Summary, Plans, Transactions */}
                <div className="lg:col-span-8 space-y-6">
                  {/* Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: 'Active Plans', value: subData.subscriptions.filter(s => s.is_active).length, icon: Star, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                      { label: 'Total Subscriptions', value: subData.subscriptions.length, icon: CreditCard, color: 'text-primary', bg: 'bg-primary/10' },
                      { label: 'Transactions', value: subData.transactions.length, icon: TrendingUp, color: 'text-violet-400', bg: 'bg-violet-500/10' },
                    ].map(stat => (
                      <div key={stat.label} className="flex items-center gap-3 bg-card border rounded-xl p-4">
                        <div className={`p-2.5 rounded-xl ${stat.bg}`}>
                          <stat.icon className={`h-5 w-5 ${stat.color}`} />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{stat.value}</p>
                          <p className="text-xs text-muted-foreground">{stat.label}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Plans Table */}
                  <Card>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-primary" /> Subscription Plans
                      </CardTitle>
                      <Dialog open={isActivateOpen} onOpenChange={(open) => {
                        setIsActivateOpen(open);
                        if (open && plans.length === 0) fetchPlans();
                      }}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10">
                            <Plus className="h-3.5 w-3.5" /> Activate Plan
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Activate Subscription</DialogTitle>
                            <DialogDescription>Manually assign a plan to {subData.domain}</DialogDescription>
                          </DialogHeader>
                          <form onSubmit={handleActivateSubscription} className="space-y-4 pt-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Select Plan</label>
                              <Select
                                value={activateForm.plan_id}
                                onValueChange={(val) => setActivateForm({ ...activateForm, plan_id: val })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Choose a subscription plan" />
                                </SelectTrigger>
                                <SelectContent>
                                  {plans.map(p => (
                                    <SelectItem key={p.id} value={p.id.toString()}>
                                      {p.name} — {p.type === 'flat_rate' ? `${p.billing_cycle}` : `${p.credit_amount} credits`} ({p.price > 0 ? `$${p.price}` : 'Free'})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Custom Expiry Date <span className="text-muted-foreground font-normal">(Optional)</span></label>
                              <Input
                                type="date"
                                value={activateForm.custom_ends_at}
                                onChange={(e) => setActivateForm({ ...activateForm, custom_ends_at: e.target.value })}
                                placeholder="Leave empty for default"
                              />
                              <p className="text-xs text-muted-foreground">Overrides the default billing cycle duration if set.</p>
                            </div>
                            <DialogFooter className="mt-6">
                              <Button type="button" variant="ghost" onClick={() => setIsActivateOpen(false)}>Cancel</Button>
                              <Button type="submit" disabled={activatingPlan || !activateForm.plan_id}>
                                {activatingPlan ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Activate
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </CardHeader>
                    <CardContent className="p-0">
                      {subData.subscriptions.length === 0 ? (
                        <div className="text-center py-10 text-sm text-muted-foreground">No subscriptions found for this domain.</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wider">
                              <tr>
                                <th className="px-5 py-3 text-left font-medium">Plan</th>
                                <th className="px-5 py-3 text-left font-medium">Type</th>
                                <th className="px-5 py-3 text-left font-medium">Status</th>
                                <th className="px-5 py-3 text-left font-medium">Period / Credits</th>
                                <th className="px-5 py-3 text-left font-medium">Subscribed On</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {subData.subscriptions.map(sub => (
                                <tr key={sub.id} className="hover:bg-muted/20 transition-colors">
                                  <td className="px-5 py-3">
                                    <p className="font-semibold text-foreground">{sub.plan?.name || '—'}</p>
                                    {sub.plan?.price && <p className="text-xs text-muted-foreground">${sub.plan.price}</p>}
                                  </td>
                                  <td className="px-5 py-3">
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${sub.is_credit_type ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                                      {sub.is_credit_type ? 'Credit' : 'Flat Rate'}
                                    </span>
                                  </td>
                                  <td className="px-5 py-3">
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${sub.is_active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : sub.status === 'cancelled' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                                      {sub.is_active ? 'Active' : sub.status}
                                    </span>
                                  </td>
                                  <td className="px-5 py-3 text-xs">
                                    {sub.is_credit_type ? (
                                      <div className="flex items-center gap-1.5">
                                        <Coins className="h-3.5 w-3.5 text-violet-400" />
                                        <span className="font-semibold">{sub.credit_balance ?? 0}</span>
                                        <span className="text-muted-foreground">credits remaining</span>
                                      </div>
                                    ) : (
                                      <div className="space-y-0.5">
                                        {sub.starts_at && <p className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(sub.starts_at).toLocaleDateString()}</p>}
                                        {sub.ends_at && (
                                          <p className={`flex items-center gap-1 ${new Date(sub.ends_at) < new Date() ? 'text-rose-400' : 'text-muted-foreground'}`}>
                                            → {new Date(sub.ends_at).toLocaleDateString()}
                                          </p>
                                        )}
                                        {!sub.ends_at && <p className="text-muted-foreground italic">Lifetime</p>}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-5 py-3 text-xs text-muted-foreground">
                                    {sub.created_at ? new Date(sub.created_at).toLocaleDateString() : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Transactions Table */}
                  {subData.transactions.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-violet-400" /> Recent Transactions
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wider">
                              <tr>
                                <th className="px-5 py-3 text-left font-medium">Plan</th>
                                <th className="px-5 py-3 text-left font-medium">Amount</th>
                                <th className="px-5 py-3 text-left font-medium">Gateway</th>
                                <th className="px-5 py-3 text-left font-medium">Status</th>
                                <th className="px-5 py-3 text-left font-medium">Date</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {subData.transactions.map(tx => (
                                <tr key={tx.id} className="hover:bg-muted/20 transition-colors">
                                  <td className="px-5 py-3">
                                    <p className="font-medium">{tx.plan?.name || '—'}</p>
                                    {tx.gateway_ref && (
                                      <p className="text-[10px] font-mono text-muted-foreground">{tx.gateway_ref}</p>
                                    )}
                                  </td>
                                  <td className="px-5 py-3 font-semibold">${tx.amount}</td>
                                  <td className="px-5 py-3">
                                    <span className="capitalize text-xs bg-muted px-2 py-0.5 rounded font-medium">{tx.gateway}</span>
                                  </td>
                                  <td className="px-5 py-3">
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                                      tx.status === 'completed'
                                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                        : tx.status === 'failed'
                                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                    }`}>
                                      {tx.status}
                                    </span>
                                  </td>
                                  <td className="px-5 py-3 text-xs text-muted-foreground">
                                    {tx.created_at ? new Date(tx.created_at).toLocaleDateString() : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Right Side: Suspension, Visibility */}
                <div className="lg:col-span-4 space-y-6">
                  {/* Service Suspension */}
                  <Card className="border-red-500/20 bg-red-500/5 transition-all">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
                          <Shield className="h-4 w-4" />
                        </div>
                        <h4 className="font-semibold text-sm text-foreground">Service Suspension</h4>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed italic">
                        Manually suspend or reactivate this application service. When suspended, visitors will see a "Service Deactivated" page.
                      </p>
                      <Button
                        type="button"
                        variant={app?.status === 'deactivated' ? "outline" : "destructive"}
                        onClick={(e) => { e.preventDefault(); handleToggleSuspend(); }}
                        disabled={actionLoading}
                        className="w-full text-xs h-9"
                      >
                        {actionLoading ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : 
                          (app?.status === 'deactivated' ? <Play className="h-3.5 w-3.5 mr-2" /> : <Square className="h-3.5 w-3.5 mr-2" />)
                        }
                        {app?.status === 'deactivated' ? 'Reactivate Service' : 'Suspend Service'}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Custom Plan Visibility */}
                  <Card className="border-blue-500/10 bg-blue-500/[0.02]">
                    <CardHeader className="p-5 pb-3 flex flex-row items-center justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-xs flex items-center gap-2">
                          <Package className="h-3.5 w-3.5 text-blue-400" /> Package Visibility
                        </CardTitle>
                        <CardDescription className="text-[10px]">Private packages visible for this application.</CardDescription>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-white/5"
                          onClick={() => fetchVisibility(subData.domain)}
                        >
                          <RefreshCw className={`h-3 w-3 ${visibilityLoading ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-7 text-[11px] gap-1.5 border-white/10 hover:bg-white/5 hover:text-white px-2" 
                          onClick={() => setIsVisibilityDialogOpen(true)}
                        >
                          <Settings className="h-3.5 w-3.5" /> Manage
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-5 pt-0 space-y-4">
                      {plans.filter(p => !p.is_public && p.is_active && visiblePlanIds.includes(p.id)).length === 0 ? (
                        <div className="text-center py-6 space-y-3 bg-white/[0.01] border border-dashed border-white/5 rounded-xl">
                          <p className="text-[10px] text-muted-foreground italic">No custom packages selected.</p>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-7 text-[11px] gap-1.5 border-dashed border-blue-500/30 text-blue-400 hover:bg-blue-500/10" 
                            onClick={() => setIsVisibilityDialogOpen(true)}
                          >
                            <Plus className="h-3 w-3" /> Select Packages
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {plans.filter(p => !p.is_public && p.is_active && visiblePlanIds.includes(p.id)).map(plan => (
                            <div key={plan.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg border border-blue-500/20 bg-blue-500/10 shadow-sm shadow-blue-500/5">
                              <div className="flex flex-col min-w-0 pr-2">
                                <span className="text-[11px] font-semibold truncate text-blue-300">{plan.name}</span>
                                <span className="text-[9px] text-muted-foreground truncate">৳{parseFloat(plan.price).toLocaleString()} • {plan.type === 'flat_rate' ? plan.billing_cycle : `${plan.credit_amount}c`}</span>
                              </div>
                              <Badge variant="success" className="h-3.5 text-[8px] px-1.5 shrink-0 bg-blue-500/20 text-blue-400 border-blue-500/30">Visible</Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Visibility Selection Dialog */}
                <Dialog open={isVisibilityDialogOpen} onOpenChange={setIsVisibilityDialogOpen}>
                  <DialogContent className="max-w-md bg-zinc-950 border-white/10">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5 text-blue-400" /> Manage Package Visibility
                      </DialogTitle>
                      <DialogDescription className="text-muted-foreground">
                        Select the private (non-public) plans you want to offer to this specific domain/customer.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-3">
                      {plans.filter(p => !p.is_public && p.is_active).length === 0 ? (
                        <div className="text-center py-8 border border-dashed rounded-xl bg-white/[0.02]">
                          <Package className="h-8 w-8 mx-auto text-muted-foreground/20 mb-3" />
                          <p className="text-sm text-muted-foreground">No private plans found.</p>
                          <Button size="sm" variant="link" className="text-blue-400" onClick={() => { setIsVisibilityDialogOpen(false); navigate('/subscription/plans-manage'); }}>
                            Create Private Plan <ChevronRight className="h-3 w-3 ml-1" />
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                          {plans.filter(p => !p.is_public && p.is_active).map(plan => {
                            const isVisible = visiblePlanIds.includes(plan.id);
                            return (
                              <div 
                                key={plan.id} 
                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                  isVisible ? 'bg-blue-500/10 border-blue-500/30 ring-1 ring-blue-500/20' : 'bg-white/[0.03] border-white/5 opacity-70 hover:opacity-100 hover:border-white/10'
                                }`}
                              >
                                <div className="min-w-0 font-sans">
                                  <p className={`text-sm font-semibold ${isVisible ? 'text-blue-300' : 'text-foreground'}`}>{plan.name}</p>
                                  <p className="text-xs text-muted-foreground">৳{parseFloat(plan.price).toLocaleString()} • {plan.type === 'flat_rate' ? plan.billing_cycle : `${plan.credit_amount}c`}</p>
                                </div>
                                <Switch 
                                  checked={isVisible}
                                  onCheckedChange={async (checked) => {
                                    const newIds = checked 
                                      ? [...visiblePlanIds, plan.id]
                                      : visiblePlanIds.filter(id => id !== plan.id);
                                    
                                    // Call API immediately as per existing pattern
                                    try {
                                      await api.post(`/subscription/domain-plans/${subData.domain}`, { plan_ids: newIds });
                                      setVisiblePlanIds(newIds);
                                      toast.success(`${plan.name} visibility ${checked ? 'enabled' : 'disabled'}`);
                                    } catch {
                                      toast.error('Failed to update visibility');
                                    }
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <DialogFooter className="border-t border-white/5 pt-4">
                      <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => setIsVisibilityDialogOpen(false)}>Done</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmationDialog
        open={!!pendingAction}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction === 'deploy-zero-downtime' ? 'Zero-Downtime Deploy' : `${pendingAction?.charAt(0).toUpperCase() + pendingAction?.slice(1)} App`}
        description={pendingAction === 'deploy-zero-downtime'
          ? 'The new version is built in a separate release directory while the current one keeps serving traffic. Traffic switches only after the new version passes a health check; if anything fails, the current version stays live. Files your app writes into its own directory at runtime are not carried over to the new release.'
          : `Are you sure you want to ${pendingAction} this app?`}
        confirmText={pendingAction === 'delete' ? 'Delete App' : (pendingAction === 'deploy' || pendingAction === 'deploy-zero-downtime') ? 'Deploy now' : 'Confirm'}
        variant={pendingAction === 'delete' ? 'destructive' : 'default'}
        isLoading={actionLoading}
        onConfirm={handleConfirmAction}
      />
    </div>
  );
}
