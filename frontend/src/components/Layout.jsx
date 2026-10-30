import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Layers, Database, Clock, Settings, LogOut, Globe, Mail, FolderOpen, Network, Users, Terminal, Menu, X, Zap, ArrowRightLeft } from 'lucide-react';
import api from '@/lib/api';
import PanelUrlAlert from './PanelUrlAlert';
import { MIGRATION_CHANGED_EVENT } from './MigrationSettingCard';

export default function Layout() {
  const { user, logout, branding } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(false);
  const [migrationEnabled, setMigrationEnabled] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then(res => {
        setSubscriptionEnabled(res.data?.subscription_enabled || false);
        setMigrationEnabled(res.data?.migration_enabled || false);
      })
      .catch(console.error);

    // System Settings flips migration on/off: show or hide the menu right away
    const onMigrationChanged = (e) => setMigrationEnabled(Boolean(e.detail?.enabled));
    window.addEventListener(MIGRATION_CHANGED_EVENT, onMigrationChanged);
    return () => window.removeEventListener(MIGRATION_CHANGED_EVENT, onMigrationChanged);
  }, []);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const navItems = [
    { label: 'Dashboard',     path: '/',              icon: LayoutDashboard },
    { label: 'CRM',           path: '/crm',           icon: Users },
    { label: 'Applications',  path: '/apps',          icon: Layers },
    { label: 'Databases',     path: '/databases',     icon: Database },
    { label: 'DNS & Domains', path: '/domains',       icon: Globe },
    { label: 'Load Balancers', path: '/load-balancers', icon: Network },
    { label: 'Email', path: '/email', icon: Mail },
    { label: 'Cron Jobs',     path: '/cron-jobs',     icon: Clock },
    { label: 'Terminal',      path: '/terminal',      icon: Terminal },
    { label: 'File Manager',  path: '/files',         icon: FolderOpen },
    ...(migrationEnabled ? [{ label: 'Migration', path: '/migration', icon: ArrowRightLeft }] : []),
    ...(subscriptionEnabled ? [{ label: 'Subscription',  path: '/subscription',  icon: Zap }] : []),
    { label: 'Settings',      path: '/settings',      icon: Settings },
  ];

  const closeSidebar = () => setSidebarOpen(false);

  const sidebarContent = (
    <>
      <div className="h-16 flex items-center px-6 border-b flex-shrink-0 gap-3">
        {branding?.panel_logo && (
          <img src={branding.panel_logo} alt="Logo" className="h-6 w-auto object-contain flex-shrink-0" />
        )}
        <span className="font-bold text-lg tracking-tight truncate">{branding?.panel_name || 'Sada Mia Panel'}</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;

          if (item.external) {
            return (
              <a
                key={item.path}
                href={item.path}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeSidebar}
                className="flex items-center gap-3 px-3 py-2 rounded-md transition-colors hover:bg-accent text-muted-foreground hover:text-foreground"
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {item.label}
              </a>
            );
          }

          const isActive = location.pathname === item.path ||
                           (item.path !== '/' && location.pathname.startsWith(item.path));

          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={closeSidebar}
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'hover:bg-accent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t mt-auto flex-shrink-0">
        <div className="mb-4 px-2">
          <p className="text-sm font-medium leading-none">{user.name}</p>
          <p className="text-xs text-muted-foreground mt-1 truncate">{user.email}</p>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-md hover:bg-destructive hover:text-destructive-foreground text-muted-foreground transition-colors"
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          Logout
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">

      {/* ── Mobile overlay backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col w-64 border-r bg-card
          transform transition-transform duration-300 ease-in-out
          md:static md:translate-x-0 md:flex
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Close button — mobile only */}
        <button
          className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent md:hidden"
          onClick={closeSidebar}
          aria-label="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>

        {sidebarContent}
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Mobile top bar */}
        <header className="md:hidden h-14 flex items-center px-4 border-b bg-card flex-shrink-0 gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            {branding?.panel_logo && (
              <img src={branding.panel_logo} alt="Logo" className="h-6 w-auto object-contain flex-shrink-0" />
            )}
            <span className="font-bold text-base tracking-tight truncate">{branding?.panel_name || 'Sada Mia Panel'}</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      <PanelUrlAlert />
    </div>
  );
}
