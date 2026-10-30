import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ConfirmationDialog from '@/components/ConfirmationDialog';
import { usePasswordConfirm } from '@/components/PasswordConfirm';
import {
  ArrowRightLeft, KeyRound, Copy, Check, Loader2, ShieldCheck, ShieldAlert, Upload, Download,
  CheckCircle2, XCircle, AlertTriangle, Server, Circle, LogIn, Lock, Clock, Power, PowerOff,
  Link2, Package, RefreshCw, Settings,
} from 'lucide-react';
import { toast } from 'sonner';

const PROGRESS_TOKEN_KEY = 'migration_progress_token';
const KEY_LIFETIMES = [1, 6, 24];

const PHASES = [
  { key: 'connecting', label: 'Connect to the old panel' },
  { key: 'exporting', label: 'Old server packs & encrypts everything' },
  { key: 'downloading', label: 'Transfer the encrypted archive' },
  { key: 'verifying', label: 'Verify checksum' },
  { key: 'restoring', label: 'Restore apps, databases, DNS, mail & settings' },
  { key: 'done', label: 'Done' },
];

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function timeLeft(iso) {
  const minutes = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function timeAgo(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

// The panel is usually served over plain http, where navigator.clipboard is unavailable
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  return Promise.resolve();
}

// Read the old panel's address out of a pasted key (it is not secret; the secret stays inside)
function urlFromKey(key) {
  try {
    const payload = key.trim().slice('SMIG1.'.length).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).u || '';
  } catch {
    return '';
  }
}

function errorMessage(err, fallback) {
  return err.response?.data?.error || err.response?.data?.message || fallback;
}

function CopyField({ label, value, multiline = false, testId }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-stretch gap-2">
        <div
          data-testid={testId}
          className={`flex-1 min-w-0 rounded-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs leading-relaxed ${
            multiline ? 'break-all max-h-28 overflow-y-auto' : 'truncate'
          }`}
        >
          {value}
        </div>
        <Button type="button" variant="outline" size="sm" className="h-auto w-24 shrink-0" onClick={onCopy} aria-label={`Copy ${label}`}>
          {copied
            ? <><Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" /> Copied</>
            : <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy</>}
        </Button>
      </div>
    </div>
  );
}

export default function MigrationPage() {
  const [status, setStatus] = useState(null);
  const [confirmRun, passwordDialog] = usePasswordConfirm();
  const [progressToken, setProgressToken] = useState(() => {
    try { return localStorage.getItem(PROGRESS_TOKEN_KEY); } catch { return null; }
  });

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/migration');
      setStatus(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const startedMigration = (token) => {
    try { localStorage.setItem(PROGRESS_TOKEN_KEY, token); } catch { /* progress still shows this session */ }
    setProgressToken(token);
  };

  const closeProgress = () => {
    try { localStorage.removeItem(PROGRESS_TOKEN_KEY); } catch { /* ignore */ }
    setProgressToken(null);
    fetchStatus();
  };

  if (progressToken) {
    return <MigrationProgress token={progressToken} onClose={closeProgress} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Server Migration</h2>
        <p className="text-muted-foreground mt-1">
          Move everything on this panel to a new server, or receive everything from an old one.
        </p>
      </div>

      {!status ? (
        <div className="h-40 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !status.enabled ? (
        <>
        {status.source?.export?.status === 'transferred' && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4" data-testid="transfer-done">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-emerald-400">This server was transferred to the new one</div>
              <div className="text-muted-foreground mt-0.5">
                {new Date(status.source.export.updated_at).toLocaleString()} — the archive was deleted here and
                migration was switched off automatically.
              </div>
            </div>
          </div>
        )}
        <Card data-testid="migration-off">
          <CardContent className="py-14 flex flex-col items-center text-center gap-4">
            <div className="rounded-full bg-white/5 p-4"><Lock className="h-7 w-7 text-muted-foreground" /></div>
            <div className="space-y-1.5 max-w-md">
              <h3 className="text-lg font-semibold">Migration is off</h3>
              <p className="text-sm text-muted-foreground">
                This panel can&apos;t be copied to another server and can&apos;t receive one. Turn it on in System
                Settings while you move servers. It switches off by itself after a transfer.
              </p>
            </div>
            <Button asChild>
              <Link to="/settings?tab=system"><Settings className="mr-2 h-4 w-4" /> Open System Settings</Link>
            </Button>
          </CardContent>
        </Card>
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <SendCard status={status} onChange={fetchStatus} confirmRun={confirmRun} />
          <ReceiveCard serverIp={status.server_ip} onStarted={startedMigration} confirmRun={confirmRun} />
        </div>
      )}

      {status && (
        <div className="grid gap-6 lg:grid-cols-3">
          <ActivityCard events={status.events || []} />
          <SecurityCard />
        </div>
      )}

      {passwordDialog}
    </div>
  );
}

// ── Old server ───────────────────────────────────────────────────────────────

function SendCard({ status, onChange, confirmRun }) {
  const source = status.source;
  const [keyData, setKeyData] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [hours, setHours] = useState(6);
  const [allowedIp, setAllowedIp] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [, setTick] = useState(0);

  const exportState = source.export;
  const exportActive = exportState && ['pending', 'running', 'completed'].includes(exportState.status);

  // Follow the new server pulling this one, and keep the expiry countdown fresh
  useEffect(() => {
    if (!source.key_active && !exportActive) return;
    const interval = setInterval(() => { onChange(); setTick((t) => t + 1); }, 5000);
    return () => clearInterval(interval);
  }, [source.key_active, exportActive, onChange]);

  // The key exists in this browser tab only between creating it and leaving the page
  useEffect(() => {
    if (!source.key_active) setKeyData(null);
  }, [source.key_active]);

  const generate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await confirmRun(() => api.post('/migration/key', { hours, allowed_ip: allowedIp.trim() || null }));
      setKeyData(data);
      setShowForm(false);
      onChange();
    } catch (err) {
      if (!err.cancelled) toast.error(errorMessage(err, 'Could not create a key'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await api.delete('/migration/key');
      setKeyData(null);
      setConfirmRevoke(false);
      toast.success('Migration key revoked');
      onChange();
    } catch (err) {
      toast.error('Could not revoke the key');
    } finally {
      setBusy(false);
    }
  };

  const keyActive = source.key_active && !showForm;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl"><Upload className="h-5 w-5" /> Send this server</CardTitle>
        <CardDescription>Use this on the <strong className="text-foreground">old</strong> server.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-5">
        {keyActive ? (
          <>
            <div className="space-y-4">
              <CopyField label="Panel address" value={keyData?.url || source.key_url} testId="migration-url" />
              {keyData ? (
                <>
                  <CopyField label="Migration key" value={keyData.key} multiline testId="migration-key" />
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300" data-testid="key-once-warning">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Copy the key now. For security it is shown only once and can&apos;t be displayed again.</span>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Migration key</div>
                  <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-muted-foreground" data-testid="key-hidden">
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    <span>Hidden for security — it was shown once when created. Lost it? Create a new key.</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Expires in {timeLeft(source.key_expires_at)}</span>
              <span className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                {source.key_allowed_ip ? <>Only <span className="font-mono text-foreground">{source.key_allowed_ip}</span></> : 'Any IP'}
              </span>
              <div className="flex gap-2 ml-auto">
                <Button variant="ghost" size="sm" onClick={() => setShowForm(true)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> New key</Button>
                <Button variant="ghost" size="sm" className="text-rose-400 hover:text-rose-300" onClick={() => setConfirmRevoke(true)}>Revoke</Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground border-t border-white/10 pt-4">
              On the new server, open <strong className="text-foreground">Migration</strong> and paste the key. If it reaches
              this server at a different address (for example its public IP), paste that address too.
            </p>
          </>
        ) : (
          <form onSubmit={generate} className="space-y-5">
            <div className="space-y-2">
              <Label>Key valid for</Label>
              <div className="flex">
                <div className="inline-flex rounded-md border border-white/10 p-1 gap-1">
                  {KEY_LIFETIMES.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHours(h)}
                      className={`px-3 py-1.5 text-sm rounded transition-colors ${hours === h ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {h} hour{h > 1 ? 's' : ''}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>New server IP <span className="text-muted-foreground font-normal">(recommended)</span></Label>
              <Input placeholder="e.g. 203.0.113.25" value={allowedIp} onChange={(e) => setAllowedIp(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Copy it from <strong className="text-foreground">This server&apos;s IP</strong> on the new server&apos;s Migration
                page. Only that server will be able to use the key; leave empty to allow any IP.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                Generate migration key
              </Button>
              {showForm && <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>}
            </div>
          </form>
        )}

        {exportState && <SourceExportStatus exportState={exportState} />}
      </CardContent>

      <ConfirmationDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revoke the migration key?"
        description="The new server will no longer be able to connect with it. A prepared archive is deleted."
        confirmText="Revoke"
        variant="destructive"
        isLoading={busy}
        onConfirm={revoke}
      />
    </Card>
  );
}

function SourceExportStatus({ exportState }) {
  const map = {
    pending: { icon: Loader2, spin: true, text: 'New server connected — preparing to pack this server…', tone: 'text-amber-400 border-amber-500/20 bg-amber-500/5' },
    running: { icon: Loader2, spin: true, text: 'Packing and encrypting this server for the new one…', tone: 'text-amber-400 border-amber-500/20 bg-amber-500/5' },
    completed: { icon: Download, text: `Ready — the new server is downloading it (${formatBytes(exportState.size_bytes)})`, tone: 'text-sky-400 border-sky-500/20 bg-sky-500/5' },
    transferred: { icon: CheckCircle2, text: 'Transferred to the new server. The archive was deleted and migration switched off.', tone: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' },
    failed: { icon: XCircle, text: `Packing failed: ${exportState.error || 'unknown error'}`, tone: 'text-rose-400 border-rose-500/20 bg-rose-500/5' },
  };
  const s = map[exportState.status];
  if (!s) return null;
  const Icon = s.icon;

  return (
    <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${s.tone}`} data-testid="source-export-status">
      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${s.spin ? 'animate-spin' : ''}`} />
      <span>{s.text}</span>
    </div>
  );
}

// ── New server ───────────────────────────────────────────────────────────────

function Step({ number, title, children, muted = false }) {
  return (
    <div className="flex gap-3">
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${muted ? 'bg-white/5 text-muted-foreground' : 'bg-primary/20 text-primary'}`}>
        {number}
      </div>
      <div className="flex-1 min-w-0 space-y-3">
        <div className={`text-sm font-medium ${muted ? 'text-muted-foreground' : ''}`}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function ReceiveCard({ serverIp, onStarted, confirmRun }) {
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [starting, setStarting] = useState(false);

  const onKeyChange = (value) => {
    setKey(value);
    setConnection(null);
    setError(null);
    const fromKey = urlFromKey(value);
    if (fromKey) setUrl(fromKey);
  };

  const connect = async (e) => {
    e.preventDefault();
    setConnecting(true);
    setError(null);
    setConnection(null);
    try {
      const { data } = await api.post('/migration/connect', { key: key.trim(), url: url.trim() || null });
      setConnection(data);
    } catch (err) {
      setError(errorMessage(err, 'Could not connect'));
    } finally {
      setConnecting(false);
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      const { data } = await confirmRun(() => api.post('/migration/start', { key: key.trim(), url: connection.url, confirm: confirmText }));
      onStarted(data.token);
    } catch (err) {
      if (!err.cancelled) toast.error(errorMessage(err, 'Could not start the migration'));
    } finally {
      setStarting(false);
    }
  };

  const counts = connection?.source?.counts || {};
  const countLabels = [
    ['apps', 'Apps'], ['databases', 'Databases'], ['domains', 'Domains'],
    ['email_accounts', 'Mailboxes'], ['load_balancers', 'Load balancers'], ['cron_jobs', 'Cron jobs'],
  ];

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl"><Download className="h-5 w-5" /> Receive a server</CardTitle>
        <CardDescription>Use this on the <strong className="text-foreground">new</strong> server (a fresh install).</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-6">
        <Step number="1" title="Give the old server this IP">
          {serverIp ? (
            <CopyField label="This server's IP" value={serverIp} testId="this-server-ip" />
          ) : (
            <p className="text-xs text-amber-400">
              This server&apos;s IP is not set. Add it under Settings → System Settings → Server IP Address.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            On the old server, paste it into <strong className="text-foreground">New server IP</strong> when you create the key.
          </p>
        </Step>

        <Step number="2" title="Connect to the old panel">
          <form onSubmit={connect} className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Migration key</div>
              <Textarea
                rows={3}
                className="font-mono text-xs resize-none"
                placeholder="SMIG1.…"
                value={key}
                onChange={(e) => onKeyChange(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Old panel address</div>
              <Input
                className="font-mono text-xs"
                placeholder="http://203.0.113.10:8083"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setConnection(null); }}
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-400" data-testid="connect-error">
                <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /> <span>{error}</span>
              </div>
            )}
            <Button type="submit" variant={connection ? 'outline' : 'default'} disabled={connecting || !key.trim()}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {connection ? 'Reconnect' : 'Connect'}
            </Button>
          </form>
        </Step>

        <Step number="3" title="Review and start" muted={!connection}>
          {connection ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-emerald-400">Verified</span>
                <span className="font-mono">{connection.source.hostname}</span>
                <span className="text-muted-foreground text-xs">{connection.url}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {countLabels.map(([k, label]) => (
                  <div key={k} className="rounded-md border border-white/10 px-3 py-2">
                    <div className="text-lg font-semibold">{counts[k] ?? 0}</div>
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 space-y-3">
                <div className="flex items-start gap-2 text-sm text-rose-300">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>
                    Everything on this server is replaced, and you must log in with the <strong>old</strong> server&apos;s
                    admin account afterwards.
                  </span>
                </div>
                <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Type MIGRATE to confirm" />
                <Button variant="destructive" className="w-full" disabled={confirmText !== 'MIGRATE' || starting} onClick={start}>
                  {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
                  Start migration
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">You&apos;ll see what will be migrated once connected.</p>
          )}
        </Step>
      </CardContent>
    </Card>
  );
}

// ── Activity & security ──────────────────────────────────────────────────────

const EVENT_STYLES = {
  enabled: { icon: Power, tone: 'text-emerald-400' },
  disabled: { icon: PowerOff, tone: 'text-muted-foreground' },
  key_created: { icon: KeyRound, tone: 'text-sky-400' },
  key_revoked: { icon: KeyRound, tone: 'text-muted-foreground' },
  connected: { icon: Link2, tone: 'text-sky-400' },
  export_started: { icon: Package, tone: 'text-amber-400' },
  transferred: { icon: CheckCircle2, tone: 'text-emerald-400' },
  migration_started: { icon: ArrowRightLeft, tone: 'text-amber-400' },
  rejected: { icon: ShieldAlert, tone: 'text-rose-400' },
  password_failed: { icon: ShieldAlert, tone: 'text-rose-400' },
};

function ActivityCard({ events }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Activity</CardTitle>
        <CardDescription>Everything migration-related on this panel, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-white/5" data-testid="migration-activity">
            {events.map((e) => {
              const style = EVENT_STYLES[e.event] || { icon: Circle, tone: 'text-muted-foreground' };
              const Icon = style.icon;
              return (
                <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Icon className={`h-4 w-4 shrink-0 ${style.tone}`} />
                  <span className="flex-1 min-w-0 truncate">{e.details}</span>
                  {e.ip && <span className="hidden sm:inline font-mono text-xs text-muted-foreground">{e.ip}</span>}
                  <span className="w-20 text-right text-xs text-muted-foreground shrink-0">{timeAgo(e.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SecurityCard() {
  const items = [
    [Power, 'Off by default (System Settings). Nothing can be copied until you switch it on, and it switches off after a transfer.'],
    [Lock, 'Your password is required to switch it on, create a key, and start a migration.'],
    [KeyRound, 'Single-use key, shown only once, valid for 1–24 hours, optionally locked to the new server’s IP.'],
    [ShieldCheck, 'The key never travels over the network. Every request and answer is signed with it, so neither panel can be impersonated or replayed.'],
    [Package, 'The data moves as one AES-256 encrypted archive. It is checksum-verified and deleted right after the transfer.'],
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-400" /> How it&apos;s secured</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {items.map(([Icon, text]) => (
            <li key={text} className="flex gap-2.5 text-xs text-muted-foreground">
              <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-foreground/70" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ── Progress (survives the restore swapping the panel database and login) ───

function MigrationProgress({ token, onClose }) {
  const [progress, setProgress] = useState(null);
  const [unreachable, setUnreachable] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        // Plain fetch: the restore invalidates the admin's API token, so no auth header/redirect here
        const res = await fetch(`/api/public/migration/progress?token=${encodeURIComponent(token)}`, {
          headers: { Accept: 'application/json' },
        });
        if (res.status === 404) {
          if (!cancelled) setProgress({ status: 'unknown' });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        setProgress(data);
        setUnreachable(false);
        if (data.status === 'completed' || data.status === 'failed') return;
      } catch {
        // The panel restarts during the restore - keep trying
        if (!cancelled) setUnreachable(true);
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [token]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progress?.log]);

  const goToLogin = () => {
    try {
      localStorage.removeItem(PROGRESS_TOKEN_KEY);
      localStorage.removeItem('panel_token');
    } catch { /* ignore */ }
    window.location.href = '/login';
  };

  const status = progress?.status;
  const phaseIndex = PHASES.findIndex((p) => p.key === progress?.phase);
  const percent = progress?.bytes_total ? Math.min(100, Math.round((progress.bytes_done / progress.bytes_total) * 100)) : 0;

  return (
    <div className="space-y-6" data-testid="migration-progress">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">
          Migrating from {progress?.source?.hostname || 'the old server'}
        </h2>
        <p className="text-muted-foreground mt-1">Keep this page open. The panel restarts near the end — that is expected.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="p-6 space-y-4">
            {PHASES.map((phase, i) => {
              const done = status === 'completed' || i < phaseIndex;
              const current = i === phaseIndex && status !== 'completed';
              const failedHere = current && status === 'failed';
              return (
                <div key={phase.key} className="flex items-start gap-3">
                  {failedHere ? <XCircle className="h-5 w-5 text-rose-500 flex-shrink-0" />
                    : done ? <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                    : current ? <Loader2 className="h-5 w-5 text-amber-400 animate-spin flex-shrink-0" />
                    : <Circle className="h-5 w-5 text-muted-foreground/40 flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${done || current ? 'text-foreground' : 'text-muted-foreground'}`}>{phase.label}</div>
                    {phase.key === 'downloading' && current && progress?.bytes_total ? (
                      <div className="mt-2 space-y-1">
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatBytes(progress.bytes_done)} / {formatBytes(progress.bytes_total)} ({percent}%)
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {unreachable && status !== 'completed' && (
              <div className="flex items-center gap-2 text-xs text-amber-400">
                <Server className="h-4 w-4" /> Panel is restarting… reconnecting
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <pre
              ref={logRef}
              data-testid="migration-log"
              className="bg-black/60 rounded-md p-4 text-xs font-mono whitespace-pre-wrap break-all h-[420px] overflow-y-auto"
            >
              {progress?.log || 'Starting…'}
            </pre>
          </CardContent>
        </Card>
      </div>

      {status === 'completed' && (
        <Card className="border-emerald-500/40 bg-emerald-500/5" data-testid="migration-complete">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold text-emerald-400">
              <CheckCircle2 className="h-6 w-6" /> Migration complete
            </div>
            <p className="text-sm text-muted-foreground">
              This server now runs everything from <strong className="text-foreground">{progress?.source?.hostname}</strong>.
              Log in with the old server&apos;s admin email and password. Then point your domains&apos; DNS (A records
              and ns1–ns4 glue at your registrar) to this server&apos;s IP and keep the old server running until you
              have checked everything. Migration is now off on both servers.
            </p>
            <Button onClick={goToLogin}><LogIn className="mr-2 h-4 w-4" /> Go to login</Button>
          </CardContent>
        </Card>
      )}

      {(status === 'failed' || status === 'unknown') && (
        <Card className="border-rose-500/40 bg-rose-500/5" data-testid="migration-failed">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold text-rose-400">
              <XCircle className="h-6 w-6" /> {status === 'unknown' ? 'Migration not found' : 'Migration failed'}
            </div>
            {progress?.error && <p className="text-sm">{progress.error}</p>}
            <p className="text-sm text-muted-foreground">
              The old server is untouched.
              {progress?.phase === 'restoring' && ' This server may be partly restored — running the migration again overwrites it.'}
              {' '}Fix the problem and start again with a new key from the old panel.
            </p>
            <Button variant="outline" onClick={onClose}>Back</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
