import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import api from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Github, Lock, Settings, Globe, Network, ShieldCheck, Eye, EyeOff, Users, Layers, HelpCircle, ChevronRight, Info, ExternalLink, CheckCircle2, XCircle, Zap, Key, Link, Copy, Palette, UploadCloud, Loader2, Monitor, BookOpen } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import MigrationSettingCard from '@/components/MigrationSettingCard';

export default function SettingsPage() {
  const { user, setUser, refreshBranding } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedLogoFile, setSelectedLogoFile] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [apiDomainLoading, setApiDomainLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  const [profileData, setProfileData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    current_password: '',
  });

  useEffect(() => {
    if (user) {
      setProfileData({
        name: user.name,
        email: user.email,
        current_password: '',
      });
    }
  }, [user]);

  const [passwords, setPasswords] = useState({
    current_password: '',
    password: '',
    password_confirmation: '',
  });

  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  
  const [githubSaving, setGithubSaving] = useState(false);
  const [nameserverSaving, setNameserverSaving] = useState(false);
  const [crmSaving, setCrmSaving] = useState(false);
  const [crmApiSaving, setCrmApiSaving] = useState(false);
  const [initialGithubSettings, setInitialGithubSettings] = useState(null);
  const [githubSettings, setGithubSettings] = useState({
    github_client_id: '',
    github_client_secret: '',
    github_webhook_secret: '',
    github_connected: false,
    dns_default_ns1: '',
    dns_default_ns2: '',
    dns_default_ns3: '',
    dns_default_ns4: '',
    crm_creation_type: 'load_balancer',
    crm_default_lb_id: '',
    crm_default_deployment_domain: '',
    panel_url: '',
    panel_name: '',
    server_ip: '',
    ns_default_domain: '',
    crm_api_enabled: false,
    crm_api_url: '',
    crm_api_method: 'POST',
    crm_api_payload_template: '',
    crm_api_auth_enabled: false,
    crm_api_auth_url: '',
    crm_api_auth_payload: '',
    
    // Subscription feature flag
    subscription_enabled: false,
    
    // Support channels
    support_email: '',
    support_whatsapp: '',
    support_facebook: '',
    support_mobile: '',
    portal_welcome_html: '',
  });


  const [loadBalancers, setLoadBalancers] = useState([]);
  const [systemDomains, setSystemDomains] = useState([]);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data } = await api.get('/settings');
      setGithubSettings(data);
      setInitialGithubSettings(data);
      
      const lbRes = await api.get('/load-balancers');
      setLoadBalancers(lbRes.data);

      const domainRes = await api.get('/domains');
      setSystemDomains(domainRes.data);
    } catch (err) {
      console.error('Failed to fetch settings', err);
    }
  };

  const handleProfileChange = (e) => setProfileData({ ...profileData, [e.target.name]: e.target.value });
  const handleChange = (e) => setPasswords({ ...passwords, [e.target.name]: e.target.value });
  const handleGithubChange = (e) => setGithubSettings({ ...githubSettings, [e.target.name]: e.target.value });
  const handleSwitchChange = (name, checked) => setGithubSettings(prev => ({ ...prev, [name]: checked }));

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setProfileLoading(true);
    setMessage('');
    setError('');

    try {
      const { data } = await api.post('/auth/update-profile', profileData);
      setUser(data.user);
      setProfileData({ ...profileData, current_password: '' });
      toast.success('Profile updated successfully.');
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to update profile';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedLogoFile(file);
    setLogoPreviewUrl(URL.createObjectURL(file));
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      await api.post('/auth/change-password', passwords);
      setMessage('Password updated successfully.');
      setPasswords({ current_password: '', password: '', password_confirmation: '' });
      toast.success('Password updated successfully.');
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.errors?.password?.[0] || 'Failed to update password');
      toast.error(err.response?.data?.message || err.response?.data?.errors?.password?.[0] || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGithubTab = async (e, shouldConnect = false) => {
    e?.preventDefault();
    try {
      setGithubSaving(true);
      setError('');
      setMessage('');
      await api.post('/settings', {
        github_client_id: githubSettings.github_client_id,
        github_client_secret: githubSettings.github_client_secret,
        github_webhook_secret: githubSettings.github_webhook_secret,
      });
      fetchSettings();
      toast.success('GitHub settings saved successfully');
      setMessage('GitHub settings saved successfully.');

      if (shouldConnect) {
        handleConnectGithub();
      }
    } catch (err) {
      const errorMsg = err.response?.data?.errors 
        ? Object.values(err.response.data.errors).flat().join(', ')
        : err.response?.data?.message || 'Failed to save GitHub settings';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setGithubSaving(false);
    }
  };

  const handleSaveNameserverTab = async (e) => {
    e.preventDefault();
    try {
      setNameserverSaving(true);
      setError('');
      setMessage('');
      await api.post('/settings', {
        ns_default_domain: githubSettings.ns_default_domain,
        dns_default_ns1: githubSettings.dns_default_ns1,
        dns_default_ns2: githubSettings.dns_default_ns2,
        dns_default_ns3: githubSettings.dns_default_ns3,
        dns_default_ns4: githubSettings.dns_default_ns4,
      });
      fetchSettings();
      toast.success('Nameserver settings saved successfully');
      setMessage('Nameserver settings saved successfully.');
    } catch (err) {
      const errorMsg = err.response?.data?.errors 
        ? Object.values(err.response.data.errors).flat().join(', ')
        : err.response?.data?.message || 'Failed to save nameserver settings';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setNameserverSaving(false);
    }
  };

  const handleSaveCrmTab = async (e) => {
    e.preventDefault();
    try {
      setCrmSaving(true);
      setError('');
      setMessage('');
      await api.post('/settings', {
        crm_creation_type: githubSettings.crm_creation_type,
        crm_default_lb_id: githubSettings.crm_default_lb_id,
        crm_default_deployment_domain: githubSettings.crm_default_deployment_domain,
      });
      fetchSettings();
      toast.success('CRM settings saved successfully');
      setMessage('CRM settings saved successfully.');
    } catch (err) {
      const errorMsg = err.response?.data?.errors 
        ? Object.values(err.response.data.errors).flat().join(', ')
        : err.response?.data?.message || 'Failed to save CRM settings';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setCrmSaving(false);
    }
  };

  const handleSaveCrmApiTab = async (e) => {
    e.preventDefault();
    try {
      setCrmApiSaving(true);
      setError('');
      setMessage('');
      await api.post('/settings', {
        crm_api_enabled: githubSettings.crm_api_enabled,
        crm_api_url: githubSettings.crm_api_url,
        crm_api_method: githubSettings.crm_api_method,
        crm_api_payload_template: githubSettings.crm_api_payload_template,
        crm_api_auth_enabled: githubSettings.crm_api_auth_enabled,
        crm_api_auth_url: githubSettings.crm_api_auth_url,
        crm_api_auth_payload: githubSettings.crm_api_auth_payload,
        crm_api_auth_token_key: githubSettings.crm_api_auth_token_key,
        crm_api_auth_token_type: githubSettings.crm_api_auth_token_type,
      });
      fetchSettings();
      toast.success('CRM API integration settings saved!');
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to save CRM API settings';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setCrmApiSaving(false);
    }
  };

  const handleSaveSystemTab = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      // Save system settings
      const { data } = await api.post('/settings', {
        panel_url: githubSettings.panel_url,
        server_ip: githubSettings.server_ip,
        panel_force_https: githubSettings.panel_force_https,
        subscription_enabled: githubSettings.subscription_enabled,
      });

      if (githubSettings.panel_force_https !== initialGithubSettings?.panel_force_https) {
        try {
          const httpsReq = await api.post('/panel/ssl/force-https', { enable: githubSettings.panel_force_https });
          if (!httpsReq.data.success) {
             throw new Error(httpsReq.data.message || 'Failed to apply Force HTTPS in Nginx');
          }
        } catch (httpsErr) {
          await api.post('/settings', { 
            panel_url: githubSettings.panel_url,
            server_ip: githubSettings.server_ip,
            panel_force_https: false 
          });
          setGithubSettings(prev => ({ ...prev, panel_force_https: false }));
          setInitialGithubSettings(prev => ({ ...prev, panel_force_https: false }));
          throw new Error(httpsErr.response?.data?.message || httpsErr.message || 'Failed to apply Force HTTPS to panel. Setting reverted.');
        }
      }

      // Update the local state with what we just saved to avoid "flicker" before fetchSettings returns
      setGithubSettings(prev => ({
        ...prev,
        panel_url: githubSettings.panel_url,
        server_ip: githubSettings.server_ip,
        panel_force_https: githubSettings.panel_force_https,
        subscription_enabled: githubSettings.subscription_enabled,
      }));
      setInitialGithubSettings(prev => ({ 
        ...prev, 
        panel_url: githubSettings.panel_url,
        server_ip: githubSettings.server_ip,
        panel_force_https: githubSettings.panel_force_https,
        subscription_enabled: githubSettings.subscription_enabled,
      }));

      toast.success('System settings saved successfully');
      setMessage('System settings saved successfully.');
      
      // Perform a fresh fetch to ensure everything is perfectly in sync (handles backend mutations like appending ports)
      fetchSettings();
    } catch (err) {
      const errorMsg = err.response?.data?.errors 
        ? Object.values(err.response?.data?.errors).flat().join(', ')
        : err.response?.data?.message || err.message || 'Failed to save system settings';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSupportTab = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/settings', {
        support_email: githubSettings.support_email,
        support_whatsapp: githubSettings.support_whatsapp,
        support_facebook: githubSettings.support_facebook,
        support_mobile: githubSettings.support_mobile,
      });
      fetchSettings();
      toast.success('Support contact settings saved!');
    } catch (err) {
      toast.error('Failed to save support settings');
    } finally {
      setLoading(false);
    }
  };


  const handleSaveBrandingTab = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      // 1. Upload logo if a new one is selected
      if (selectedLogoFile) {
        const formData = new FormData();
        formData.append('logo', selectedLogoFile);
        
        try {
          const { data: logoData } = await api.post('/settings/panel-logo', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          setGithubSettings(prev => ({ ...prev, panel_logo: logoData.url }));
        } catch (logoErr) {
          throw new Error(logoErr.response?.data?.message || 'Failed to upload logo');
        }
      }

      // 2. Save branding settings correctly
      await api.post('/settings', {
        panel_name: githubSettings.panel_name,
        portal_welcome_html: githubSettings.portal_welcome_html,
      });

      // Update the local state
      setGithubSettings(prev => ({
        ...prev,
        panel_name: githubSettings.panel_name,
        portal_welcome_html: githubSettings.portal_welcome_html,
      }));
      setInitialGithubSettings(prev => ({ 
        ...prev, 
        panel_name: githubSettings.panel_name,
        portal_welcome_html: githubSettings.portal_welcome_html,
      }));

      toast.success('Branding settings saved successfully');
      setMessage('Branding settings saved successfully.');
      
      fetchSettings();

      if (selectedLogoFile) {
        setSelectedLogoFile(null);
        setLogoPreviewUrl(null);
        refreshBranding();
      }
    } catch (err) {
      const errorMsg = err.response?.data?.errors 
        ? Object.values(err.response?.data?.errors).flat().join(', ')
        : (err.message || 'Failed to save branding settings');
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };


  const handleConnectGithub = async () => {

    try {
      await api.post('/github/disconnect');

      sessionStorage.setItem('gh_auth_return', JSON.stringify({
        path: window.location.pathname + window.location.search,
        time: Date.now()
      }));

      const { data } = await api.get('/github/redirect');
      window.location.href = data.url;
    } catch (err) {
      setError('Failed to initiate GitHub connection');
    }
  };

  const handleSetupApiDomain = async () => {
    setApiDomainLoading(true);
    try {
      const { data } = await api.post('/settings/setup-api-domain');
      toast.success(data.message);
      fetchSettings();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to setup API domain');
    } finally {
      setApiDomainLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground mt-1">Manage your account settings and integrations.</p>
      </div>

      <Tabs defaultValue={new URLSearchParams(window.location.search).get('tab') || 'profile'} className="flex flex-col md:flex-row gap-8" orientation="vertical">
        <aside className="md:w-64">
          <TabsList className="flex md:flex-col h-auto bg-transparent p-0 gap-1 overflow-x-auto md:overflow-x-visible">
            <TabsTrigger 
              value="profile" 
              className="justify-start px-4 py-2 hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <User className="w-4 h-4 mr-2" />
              Account Profile
            </TabsTrigger>
            <TabsTrigger 
              value="github" 
              className="justify-start px-4 py-2 hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <Github className="w-4 h-4 mr-2" />
              GitHub Integration
            </TabsTrigger>
            <TabsTrigger 
              value="password" 
              className="justify-start px-4 py-2 hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <Lock className="w-4 h-4 mr-2" />
              Change Password
            </TabsTrigger>
            <TabsTrigger 
              value="dns" 
              className="justify-start px-4 py-2 hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <Globe className="w-4 h-4 mr-2" />
              Nameserver Basics
            </TabsTrigger>
            <TabsTrigger 
              value="crm" 
              className="justify-start px-4 py-2 hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <Users className="w-4 h-4 mr-2" />
              CRM Settings
            </TabsTrigger>
            <TabsTrigger 
              value="system" 
              className="justify-start px-4 py-2 hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <Settings className="w-4 h-4 mr-2" />
              System Settings
            </TabsTrigger>
            <TabsTrigger 
              value="branding" 
              className="justify-start px-4 py-2 hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <Palette className="w-4 h-4 mr-2" />
              Panel Branding
            </TabsTrigger>
            <TabsTrigger 
              value="support" 
              className="justify-start px-4 py-2 hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <HelpCircle className="w-4 h-4 mr-2" />
              Support / Contact
            </TabsTrigger>
          </TabsList>

        </aside>

        <div className="flex-1">
          <TabsContent value="profile" className="mt-0">
            <Card>
              <form onSubmit={handleProfileUpdate}>
                <CardHeader>
                  <CardTitle>Account Profile</CardTitle>
                  <CardDescription>Update your panel administrator details.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Name</label>
                    <Input name="name" value={profileData.name} onChange={handleProfileChange} required />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Email Address</label>
                    <Input type="email" name="email" value={profileData.email} onChange={handleProfileChange} required />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Current Password</label>
                    <Input 
                      type="password" 
                      name="current_password" 
                      value={profileData.current_password} 
                      onChange={handleProfileChange} 
                      placeholder="Confirm with your password to save changes"
                      required 
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t pt-6 mt-2">
                  <Button type="submit" disabled={profileLoading}>
                    {profileLoading ? 'Updating...' : 'Save Profile'}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="github" className="mt-0">
            <Card>
              <form onSubmit={handleSaveGithubTab}>
                <CardHeader>
                  <CardTitle>GitHub Integration</CardTitle>
                  <CardDescription>Configure your GitHub App credentials for automatic deployments.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Client ID</label>
                    <Input name="github_client_id" value={githubSettings.github_client_id || ''} onChange={handleGithubChange} placeholder="ov2..." />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Client Secret</label>
                    <div className="relative">
                      <Input 
                        type={showClientSecret ? "text" : "password"} 
                        name="github_client_secret" 
                        value={githubSettings.github_client_secret || ''} 
                        onChange={handleGithubChange} 
                        placeholder="********" 
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientSecret(!showClientSecret)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                      >
                        {showClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Global Webhook Secret</label>
                    <div className="relative">
                      <Input 
                        type={showWebhookSecret ? "text" : "password"} 
                        name="github_webhook_secret" 
                        value={githubSettings.github_webhook_secret || ''} 
                        onChange={handleGithubChange} 
                        placeholder="********" 
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                      >
                        {showWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground italic">Used as default secret for new apps.</p>
                  </div>

                  <div className="pt-4 border-t mt-4 space-y-3">
                    <div>
                      <p className="font-medium">GitHub Connection Status</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {githubSettings.github_connected ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <p className="text-sm text-muted-foreground">Connected to GitHub account.</p>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-destructive" />
                            <p className="text-sm text-muted-foreground">Not connected to GitHub.</p>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="bg-primary/5 border border-primary/20 rounded-md p-3 flex items-start gap-3">
                      <Info className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-primary">How to Connect to GitHub</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          To authorize a GitHub account, go to the <strong>Create Application</strong> page or deploy a new site from the CRM. 
                          You will see a <strong>"Connect GitHub"</strong> button directly in the deployment form. Once connected, 
                          the status here will automatically update.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t pt-6 mt-2">
                  <Button type="submit" disabled={githubSaving}>
                    {githubSaving ? 'Saving...' : 'Save Settings'}
                  </Button>
                </CardFooter>
              </form>
            </Card>

            <div className="mt-8 space-y-6 animate-in fade-in duration-500">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5 text-primary" />
                <h3 className="text-xl font-bold">GitHub App Setup Guide</h3>
              </div>
              
              <div className="grid gap-4">
                {[
                  {
                    step: "01",
                    title: "Create a GitHub OAuth App",
                    description: "Go to your GitHub account Settings > Developer Settings > OAuth Apps and click 'New OAuth App'.",
                    icon: Github
                  },
                  {
                    step: "02",
                    title: "Configure App URLs",
                    description: "Fill in the required URLs correctly so GitHub can securely connect back to this control panel.",
                    details: [
                      `Homepage URL: ${githubSettings.panel_url ? githubSettings.panel_url.replace(/\/$/, '') : window.location.origin}`,
                      `Authorization Callback URL: ${githubSettings.panel_url ? githubSettings.panel_url.replace(/\/$/, '') : window.location.origin}/github/callback`
                    ],
                    icon: Link
                  },
                  {
                    step: "03",
                    title: "Generate Credentials",
                    description: "Once created, GitHub will show your Client ID. Click 'Generate a new client secret' to get that required key.",
                    icon: ShieldCheck
                  },
                  {
                    step: "04",
                    title: "Save in Panel",
                    description: "Copy both your Client ID and Client Secret into the form above. Pick any random secure string for your Webhook Secret.",
                    icon: CheckCircle2
                  }
                ].map((item, idx) => (
                  <Card key={idx} className="overflow-hidden border-none bg-muted/30 hover:bg-muted/50 transition-colors">
                    <CardContent className="p-0">
                      <div className="flex flex-col md:flex-row md:items-center">
                        <div className="bg-primary/10 px-6 py-6 md:py-0 md:h-full flex items-center justify-center min-w-[80px]">
                          <span className="text-2xl font-black text-primary/40">{item.step}</span>
                        </div>
                        <div className="p-6 flex-1 flex items-start gap-4">
                          <div className="mt-1 p-2 rounded-lg bg-background border border-border">
                            <item.icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="font-semibold text-sm flex items-center gap-2">
                              {item.title}
                            </h4>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {item.description}
                            </p>
                            {item.details && (
                              <div className="mt-2 flex flex-col gap-2 text-[10.5px] font-mono">
                                {item.details.map((detail, i) => (
                                  <div key={i} className="flex gap-2 w-full max-w-xl">
                                    <span className="bg-background border border-border px-2 py-1 rounded text-primary flex-1 break-all flex items-center justify-between">
                                      {detail}
                                      <button type="button" 
                                        onClick={(e) => {
                                          e.preventDefault();
                                          navigator.clipboard.writeText(detail.split(': ')[1]);
                                          toast.success('Copied to clipboard');
                                        }}
                                        className="text-muted-foreground hover:text-primary transition-colors p-1"
                                        title="Copy URL"
                                      >
                                        <Copy className="h-3.5 w-3.5" />
                                      </button>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/30 ml-auto hidden md:block" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-4">
                <div className="p-2 rounded-lg bg-primary/10">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-primary">Webhooks Explanation</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    The Global Webhook Secret is an extra security layer. Our panel uses it to securely verify that push events are actually coming from GitHub and not a malicious source playing around with your endpoints. Never share it!
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-dashed border-primary/30 bg-primary/5 text-center px-8">
                <p className="text-xs text-muted-foreground italic">
                  Looking for the official GitHub documentation? Review the <a href="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app" target="_blank" className="text-primary font-medium hover:underline inline-flex items-center gap-0.5" rel="noreferrer">Developer Guide <ExternalLink className="h-3 w-3" /></a>
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="password" className="mt-0">
            <Card>
              <form onSubmit={handlePasswordChange}>
                <CardHeader>
                  <CardTitle>Change Password</CardTitle>
                  <CardDescription>Update your panel login password.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Current Password</label>
                    <Input type="password" name="current_password" required value={passwords.current_password} onChange={handleChange} />
                  </div>
                  
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">New Password</label>
                      <Input type="password" name="password" required minLength={8} value={passwords.password} onChange={handleChange} />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Confirm New Password</label>
                      <Input type="password" name="password_confirmation" required minLength={8} value={passwords.password_confirmation} onChange={handleChange} />
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t pt-6 mt-2">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Updating...' : 'Update Password'}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="dns" className="mt-0">
            <Card>
              <form onSubmit={handleSaveNameserverTab}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Network className="h-5 w-5 text-primary" />
                    Global Nameservers
                  </CardTitle>
                  <CardDescription>
                    These will be automatically assigned to all new domains you add.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  
                  <div className="grid gap-3 mb-6">
                    <label className="text-sm font-semibold flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" />
                      Default Nameserver Domain
                    </label>
                    <div className="space-y-2">
                      <Input 
                        name="ns_default_domain" 
                        value={githubSettings.ns_default_domain || ''} 
                        onChange={handleGithubChange} 
                        placeholder="e.g. hostinger.com" 
                        list="system-domains-list"
                      />
                      <datalist id="system-domains-list">
                        {systemDomains.map(d => (
                          <option key={d.id} value={d.domain} />
                        ))}
                      </datalist>
                      <p className="text-[11px] text-muted-foreground leading-relaxed italic">
                        If nameservers are not manually set, they will be auto-generated using this domain (e.g. ns1.hostinger.com).
                      </p>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map(n => (
                      <div key={n} className="grid gap-2">
                        <label className="text-sm font-medium">Nameserver {n}</label>
                        <Input 
                          name={`dns_default_ns${n}`} 
                          value={githubSettings[`dns_default_ns${n}`] || ''} 
                          onChange={handleGithubChange} 
                          placeholder={`ns${n}.yourprimary.com`} 
                        />
                      </div>
                    ))}
                  </div>

                  <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <ShieldCheck className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-primary">Sada Mia Style</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        By setting these here, you don't have to think about them when adding new domains. 
                        Simply set your primary domain's <strong>Glue Records</strong> once at your registrar, 
                        and then use these names for everything else!
                      </p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t pt-6 mt-2">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Saving...' : 'Save Defaults'}
                  </Button>
                </CardFooter>
              </form>
            </Card>

            <div className="mt-8 space-y-6">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5 text-primary" />
                <h3 className="text-xl font-bold">Nameserver Setup Guide</h3>
              </div>
              
              <div className="grid gap-4">
                {[
                  {
                    step: "01",
                    title: "Select your Primary Domain",
                    description: "Choose a domain you own to be your nameserver host (e.g., mydns.io).",
                    icon: Globe
                  },
                  {
                    step: "02",
                    title: "Get your Server IP",
                    description: "Your nameservers need to point to this server. You can find your IP address on the Dashboard or by running 'curl ifconfig.me' in your terminal.",
                    icon: Network
                  },
                  {
                    step: "03",
                    title: "Configure Glue Records",
                    description: "Go to your registrar and add 'Glue Records'. This pairs your hostname with your IP address at the registry level.",
                    details: ["ns1.host.com -> 1.2.3.4", "ns2.host.com -> 1.2.3.4"],
                    icon: ShieldCheck
                  },
                  {
                    step: "04",
                    title: "Register & Verify",
                    description: "Once Glue records are set, use a tool like 'dig +short NS yourdomain.com' to verify they are active globally.",
                    icon: Info
                  }
                ].map((item, idx) => (
                  <Card key={idx} className="overflow-hidden border-none bg-muted/30 hover:bg-muted/50 transition-colors">
                    <CardContent className="p-0">
                      <div className="flex flex-col md:flex-row md:items-center">
                        <div className="bg-primary/10 px-6 py-6 md:py-0 md:h-full flex items-center justify-center min-w-[80px]">
                          <span className="text-2xl font-black text-primary/40">{item.step}</span>
                        </div>
                        <div className="p-6 flex-1 flex items-start gap-4">
                          <div className="mt-1 p-2 rounded-lg bg-background border border-border">
                            <item.icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="font-semibold text-sm flex items-center gap-2">
                              {item.title}
                            </h4>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {item.description}
                            </p>
                            {item.details && (
                              <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono">
                                {item.details.map((detail, i) => (
                                  <span key={i} className="bg-background border border-border px-1.5 py-0.5 rounded text-primary">
                                    {detail}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/30 ml-auto hidden md:block" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2 text-primary">
                    <ShieldCheck className="h-4 w-4" /> Registrar Location
                  </h4>
                  <div className="text-[11px] text-muted-foreground leading-loose">
                    Glue records are usually found under:
                    <ul className="list-disc ml-4 mt-1 space-y-1">
                      <li><strong>Namecheap:</strong> Advanced DNS → Personal DNS Server</li>
                      <li><strong>GoDaddy:</strong> DNS → Host Names</li>
                      <li><strong>Cloudflare:</strong> DNS → Records → Custom Nameservers</li>
                    </ul>
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2 text-primary">
                    <Globe className="h-4 w-4" /> Verification Tip
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-loose">
                    After setting Glue records, it can take up to 24 hours to propagate. Check status using:
                    <code className="block mt-2 bg-background p-2 rounded text-[10px] border border-border">
                      whois yourdomain.com | grep "Name Server"
                    </code>
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-dashed border-primary/30 bg-primary/5 text-center px-8">
                <p className="text-xs text-muted-foreground italic">
                  Need more help? Check out our <a href="https://www.namecheap.com/support/knowledgebase/article.aspx/768/10/how-do-i-register-personal-nameservers-for-my-domain/" target="_blank" className="text-primary font-medium hover:underline inline-flex items-center gap-0.5">full documentation <ExternalLink className="h-3 w-3" /></a>
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="crm" className="mt-0 space-y-6">
            <Card>
              <form onSubmit={handleSaveCrmTab}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    CRM Deployment Type
                  </CardTitle>
                  <CardDescription>
                    Choose how the CRM creates hosting resources for new customers.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">

                  <div className="grid sm:grid-cols-2 gap-4">
                    {[
                      { value: 'load_balancer', icon: Network, title: 'Load Balancer Domain', desc: 'Attach a domain to an existing load balancer for each customer.' },
                      { value: 'app',           icon: Layers,  title: 'Application',          desc: 'Create or link a standalone application for each customer.' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setGithubSettings({ ...githubSettings, crm_creation_type: opt.value })}
                        className={`text-left p-5 rounded-xl border-2 transition-all ${
                          githubSettings.crm_creation_type === opt.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40 hover:bg-muted/40'
                        }`}
                      >
                        <opt.icon className={`h-6 w-6 mb-3 ${
                          githubSettings.crm_creation_type === opt.value ? 'text-primary' : 'text-muted-foreground'
                        }`} />
                        <p className="font-semibold text-sm">{opt.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{opt.desc}</p>
                        {githubSettings.crm_creation_type === opt.value && (
                          <span className="inline-block mt-2 px-2 py-0.5 bg-primary/15 text-primary text-[10px] font-semibold rounded-full uppercase tracking-wide">Selected</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {githubSettings.crm_creation_type === 'load_balancer' && (
                    <div className="pt-4 border-t space-y-3">
                      <label className="text-sm font-semibold flex items-center gap-2">
                        <Network className="h-4 w-4 text-primary" />
                        Default Load Balancer
                      </label>
                      <div className="max-w-md">
                        <Select 
                          value={githubSettings.crm_default_lb_id ? String(githubSettings.crm_default_lb_id) : ''} 
                          onValueChange={v => setGithubSettings({ ...githubSettings, crm_default_lb_id: v })}
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder="-- Select a default load balancer --" />
                          </SelectTrigger>
                          <SelectContent>
                            {loadBalancers.map(lb => (
                              <SelectItem key={lb.id} value={String(lb.id)}>{lb.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                          This load balancer will be pre-selected when you add a new customer in CRM.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t space-y-3">
                    <label className="text-sm font-semibold flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" />
                      Default Deployment Domain
                    </label>
                    <div className="max-w-md">
                      <Select 
                        value={githubSettings.crm_default_deployment_domain || ''} 
                        onValueChange={v => setGithubSettings({ ...githubSettings, crm_default_deployment_domain: v })}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="-- Select a domain from system --" />
                        </SelectTrigger>
                        <SelectContent>
                          {systemDomains.map(d => (
                            <SelectItem key={d.id} value={d.domain}>{d.domain}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                        New customers will be assigned a subdomain (e.g. <strong>business.yourhosting.com</strong>) using this domain.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3">
                    <ShieldCheck className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      This setting determines what happens when you click <strong>Deploy</strong> on a CRM customer. 
                      You can change it at any time; existing customer resources are not affected.
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t pt-6 mt-2">
                  <Button type="submit" disabled={crmSaving}>
                    {crmSaving ? 'Saving...' : 'Save CRM Settings'}
                  </Button>
                </CardFooter>
              </form>
            </Card>

            <Card>
              <form onSubmit={handleSaveCrmApiTab}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-primary" />
                    CRM API Integration
                  </CardTitle>
                  <CardDescription>
                    Trigger external API calls when a new CRM customer is deployed.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  
                  <div className="flex items-center justify-between p-4 rounded-xl border bg-muted/30">
                    <div className="space-y-0.5">
                      <label className="text-sm font-semibold">Enable API Integration</label>
                      <p className="text-xs text-muted-foreground">Call an external URL after successful deployment.</p>
                    </div>
                    <Switch 
                      checked={githubSettings.crm_api_enabled} 
                      onCheckedChange={(checked) => handleSwitchChange('crm_api_enabled', checked)} 
                    />
                  </div>

                  {githubSettings.crm_api_enabled && (
                    <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
                      <div className="grid gap-4 md:grid-cols-4">
                        <div className="md:col-span-1">
                          <label className="text-sm font-medium">Method</label>
                          <Select 
                            value={githubSettings.crm_api_method} 
                            onValueChange={(v) => setGithubSettings({ ...githubSettings, crm_api_method: v })}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="POST">POST</SelectItem>
                              <SelectItem value="PUT">PUT</SelectItem>
                              <SelectItem value="GET">GET</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="md:col-span-3">
                          <label className="text-sm font-medium">API Endpoint URL</label>
                          <Input 
                            name="crm_api_url" 
                            className="mt-1"
                            value={githubSettings.crm_api_url || ''} 
                            onChange={handleGithubChange} 
                            placeholder="https://api.yourcrm.com/v1/webhook" 
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Payload Template (JSON)</label>
                        <textarea 
                          name="crm_api_payload_template"
                          value={githubSettings.crm_api_payload_template || ''}
                          onChange={handleGithubChange}
                          className="w-full h-32 font-mono text-xs p-4 rounded-md border bg-muted/50 focus:ring-2 focus:ring-primary outline-none"
                          placeholder={`{\n  "name": "{name}",\n  "email": "{email}",\n  "domain": "{domain}"\n}`}
                        />
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {['{id}', '{name}', '{email}', '{domain}', '{status}', '{resource_type}'].map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono text-[10px]">{tag}</span>
                          ))}
                        </div>
                      </div>

                      <div className="pt-4 border-t space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <label className="text-sm font-semibold flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 text-primary" />
                              Authentication Required
                            </label>
                            <p className="text-xs text-muted-foreground">Perform a separate login request to obtain a {githubSettings.crm_api_auth_token_type} token.</p>
                          </div>
                          <Switch 
                            checked={githubSettings.crm_api_auth_enabled} 
                            onCheckedChange={(checked) => handleSwitchChange('crm_api_auth_enabled', checked)} 
                          />
                        </div>

                        {githubSettings.crm_api_auth_enabled && (
                          <div className="grid gap-4 p-4 rounded-xl border bg-primary/5 space-y-2 animate-in slide-in-from-top-2">
                            <div className="grid gap-2">
                              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Auth Endpoint URL</label>
                              <Input 
                                name="crm_api_auth_url" 
                                value={githubSettings.crm_api_auth_url || ''} 
                                onChange={handleGithubChange} 
                                placeholder="https://api.yourcrm.com/oauth/token" 
                              />
                            </div>
                            <div className="grid gap-2">
                              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Auth Payload (Credentials)</label>
                              <textarea 
                                name="crm_api_auth_payload"
                                value={githubSettings.crm_api_auth_payload || ''}
                                onChange={handleGithubChange}
                                className="w-full h-24 font-mono text-xs p-3 rounded-md border bg-background focus:ring-2 focus:ring-primary outline-none"
                                placeholder={`{\n  "client_id": "...",\n  "client_secret": "..."\n}`}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="grid gap-2">
                                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Token Type</label>
                                <Select 
                                  value={githubSettings.crm_api_auth_token_type} 
                                  onValueChange={(v) => setGithubSettings({ ...githubSettings, crm_api_auth_token_type: v })}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Bearer">Bearer</SelectItem>
                                    <SelectItem value="Basic">Basic</SelectItem>
                                    <SelectItem value="Token">Token</SelectItem>
                                    <SelectItem value="Key">Key</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-2">
                                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Token Key in Response</label>
                                <div className="flex items-center gap-2">
                                  <Input 
                                    name="crm_api_auth_token_key" 
                                    value={githubSettings.crm_api_auth_token_key || 'access_token'} 
                                    onChange={handleGithubChange} 
                                    placeholder="access_token" 
                                  />
                                  <div className="p-2 rounded bg-muted">
                                    <Key className="h-4 w-4 text-primary" />
                                  </div>
                                </div>
                              </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground italic">The prefix and key used to build the Authorization header from the auth response.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="p-4 rounded-xl border border-dashed border-primary/20 bg-primary/5 flex items-start gap-4">
                    <Info className="h-4 w-4 text-primary mt-0.5" />
                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                      All API calls (both successful and failed) are logged and can be viewed directly on the customer's deployment card in the CRM page.
                    </div>
                  </div>

                </CardContent>
                <CardFooter className="flex justify-end border-t pt-6 mt-2">
                  <Button type="submit" disabled={crmApiSaving}>
                    {crmApiSaving ? 'Saving...' : 'Save API Settings'}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="system" className="mt-0">
            <Card>
              <form onSubmit={handleSaveSystemTab}>
                <CardHeader>
                  <CardTitle>System Settings</CardTitle>
                  <CardDescription>Configure core panel infrastructure and behavior.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  
                  <div className="grid gap-3">
                    <label className="text-sm font-semibold flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" />
                      Control Panel Address
                    </label>
                    <div className="space-y-2">
                      <Input 
                        name="panel_url" 
                        value={githubSettings.panel_url || ''} 
                        onChange={handleGithubChange} 
                        placeholder="e.g. panel.yourdomain.com" 
                      />
                      <p className="text-[11px] text-muted-foreground leading-relaxed italic">
                        This URL is used for GitHub OAuth redirects and other system links. 
                        <strong> Note:</strong> The panel port will be automatically appended if missing.
                      </p>
                    </div>
                  </div>

                    <div className="grid gap-3">
                      <label className="text-sm font-semibold flex items-center gap-2">
                        <Network className="h-4 w-4 text-primary" />
                        Server IP Address
                      </label>
                      <div className="space-y-2">
                        <Input 
                          name="server_ip" 
                          value={githubSettings.server_ip || ''} 
                          onChange={handleGithubChange} 
                          placeholder="e.g. 1.2.3.4" 
                        />
                        <p className="text-[11px] text-muted-foreground leading-relaxed italic">
                          This IP address is used for all default DNS A records created by the panel.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 pt-4 border-t">
                      <div className="flex items-start justify-between">
                        <div>
                          <label className="text-sm font-semibold flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-primary" />
                            Force HTTPS for Control Panel
                          </label>
                          <p className="text-[11px] text-muted-foreground leading-relaxed italic mt-1 max-w-xl">
                            Redirects all HTTP traffic on port 8083 to HTTPS. <strong>Requires panel SSL to be active first.</strong>
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={githubSettings.panel_force_https}
                            onCheckedChange={(checked) => {
                              setGithubSettings(s => ({ ...s, panel_force_https: checked }));
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 pt-4 border-t">
                      <div className="flex items-start justify-between">
                        <div>
                          <label className="text-sm font-semibold flex items-center gap-2">
                            <Zap className="h-4 w-4 text-primary" />
                            Enable Subscription System
                          </label>
                          <p className="text-[11px] text-muted-foreground leading-relaxed italic mt-1 max-w-xl">
                            When enabled, this displays the Subscriptions menu and enforces plans/credits via middleware on routes mapped to `CheckSubscription`.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={githubSettings.subscription_enabled}
                            onCheckedChange={(checked) => {
                              setGithubSettings(s => ({ ...s, subscription_enabled: checked }));
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 pt-4 border-t">
                      <div className="flex items-start justify-between">
                        <div>
                          <label className="text-sm font-semibold flex items-center gap-2">
                            <BookOpen className="h-4 w-4 text-primary" />
                            Public API Documentation Domain
                          </label>
                          <p className="text-[11px] text-muted-foreground leading-relaxed italic mt-1 max-w-xl">
                            Automatically provision a DNS record and SSL certificate for `api.yourprimarydomain.com` to serve the API documentation securely.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            type="button" 
                            variant="outline" 
                            onClick={handleSetupApiDomain}
                            disabled={apiDomainLoading || !githubSettings.ns_default_domain}
                          >
                            {apiDomainLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Setup in Progress...</> : 'Setup API Docs Domain'}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3 mt-2">
                      <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-primary">Important Recommendation</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          If you are using a domain name, make sure to update your GitHub App's <strong>Redirect URL</strong> 
                          to match this new address to avoid authentication issues.
                        </p>
                      </div>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t pt-6 mt-2">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Saving...' : 'Save System Settings'}
                  </Button>
                </CardFooter>
              </form>
            </Card>
            <MigrationSettingCard />
          </TabsContent>

          <TabsContent value="branding" className="mt-0">
            <Card>
              <form onSubmit={handleSaveBrandingTab}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5 text-primary" />
                    Panel Branding
                  </CardTitle>
                  <CardDescription>
                    Customize the appearance of your panel with a custom name and logo.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-8 md:grid-cols-2">
                    <div className="grid gap-3">
                      <label className="text-sm font-semibold flex items-center gap-2">
                        <Palette className="h-4 w-4 text-primary" />
                        Panel Name
                      </label>
                      <div className="space-y-2">
                        <Input 
                          name="panel_name" 
                          value={githubSettings.panel_name || ''} 
                          onChange={handleGithubChange} 
                          placeholder="e.g. Sada Mia Panel" 
                        />
                        <p className="text-[11px] text-muted-foreground leading-relaxed italic">
                          Displayed at the top of the sidebar and on the login page.
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <label className="text-sm font-semibold flex items-center gap-2">
                        <UploadCloud className="h-4 w-4 text-primary" />
                        Panel Logo
                      </label>
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-md border flex items-center justify-center bg-muted overflow-hidden flex-shrink-0">
                          {logoPreviewUrl ? (
                            <img src={logoPreviewUrl} alt="Logo Preview" className="w-full h-full object-contain p-1" />
                          ) : githubSettings.panel_logo ? (
                            <img src={githubSettings.panel_logo} alt="Logo" className="w-full h-full object-contain p-1" />
                          ) : (
                            <Palette className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="space-y-1.5 flex-1">
                          <Input 
                            type="file" 
                            accept="image/*" 
                            onChange={handleLogoUpload}
                            disabled={loading}
                            className="text-xs file:h-8 file:px-2"
                          />
                          <p className="text-[10px] text-muted-foreground leading-relaxed italic">
                            {loading && selectedLogoFile ? <span className="flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin"/> Uploading...</span> : 'Best size: 200x50px. Saves when you click Save Branding Settings.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 pt-6 border-t">
                    <label className="text-sm font-semibold flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-primary" />
                      Portal Welcome Content (HTML)
                    </label>
                    <div className="space-y-2">
                      <Textarea 
                        name="portal_welcome_html" 
                        value={githubSettings.portal_welcome_html || ''} 
                        onChange={handleGithubChange} 
                        placeholder="Custom HTML content..." 
                        className="min-h-[150px] font-mono text-xs"
                      />
                      <p className="text-[11px] text-muted-foreground leading-relaxed italic">
                        Use <strong>{'{{logo}}'}</strong> and <strong>{'{{domain_form}}'}</strong> placeholders to inject the dynamic logo and search form.
                      </p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t pt-6 mt-2">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Saving...' : 'Save Branding Settings'}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="support" className="mt-0">
            <Card>
              <form onSubmit={handleSaveSupportTab}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <HelpCircle className="h-5 w-5 text-primary" />
                    Support & Contact Channels
                  </CardTitle>
                  <CardDescription>
                    Configure how customers reach you when their services are suspended.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="grid gap-2">
                      <label className="text-sm font-semibold flex items-center gap-2">
                        <User className="h-4 w-4 text-primary" />
                        Support Email Address
                      </label>
                      <Input 
                        type="email"
                        name="support_email" 
                        value={githubSettings.support_email || ''} 
                        onChange={handleGithubChange} 
                        placeholder="support@yourcompany.com" 
                      />
                      <p className="text-[10px] text-muted-foreground italic">Primary contact for renewal issues.</p>
                    </div>

                    <div className="grid gap-2">
                      <label className="text-sm font-semibold flex items-center gap-2">
                        <Zap className="h-4 w-4 text-green-500" />
                        WhatsApp Number
                      </label>
                      <Input 
                        name="support_whatsapp" 
                        value={githubSettings.support_whatsapp || ''} 
                        onChange={handleGithubChange} 
                        placeholder="e.g. +8801700000000" 
                      />
                      <p className="text-[10px] text-muted-foreground italic">Include country code (e.g. +880).</p>
                    </div>

                    <div className="grid gap-2">
                      <label className="text-sm font-semibold flex items-center gap-2">
                        <Globe className="h-4 w-4 text-blue-500" />
                        Facebook Page URL
                      </label>
                      <Input 
                        name="support_facebook" 
                        value={githubSettings.support_facebook || ''} 
                        onChange={handleGithubChange} 
                        placeholder="https://facebook.com/yourpage" 
                      />
                      <p className="text-[10px] text-muted-foreground italic">Full URL to your business page.</p>
                    </div>

                    <div className="grid gap-2">
                      <label className="text-sm font-semibold flex items-center gap-2">
                        <Network className="h-4 w-4 text-orange-500" />
                        Mobile / Phone Number
                      </label>
                      <Input 
                        name="support_mobile" 
                        value={githubSettings.support_mobile || ''} 
                        onChange={handleGithubChange} 
                        placeholder="e.g. 01700000000" 
                      />
                      <p className="text-[10px] text-muted-foreground italic">Direct line for urgent support.</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-3 mt-2">
                    <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-primary">Display Logic</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        These contact methods will be displayed on the <strong>Subscription Expired</strong> page shown to customers. 
                        Leave a field empty if you do not want that channel to be displayed.
                      </p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t pt-6 mt-2">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Saving...' : 'Save Support Channels'}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>


        </div>
      </Tabs>
    </div>
  );
}
