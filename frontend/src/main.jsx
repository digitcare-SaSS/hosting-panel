import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { Toaster } from 'sonner';
import './index.css';

// Layout & Pages
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AppsPage from './pages/AppsPage';
import CreateAppPage from './pages/CreateAppPage';
import AppDetailPage from './pages/AppDetailPage';
import DatabasesPage from './pages/DatabasesPage';
import DatabaseUsersPage from './pages/DatabaseUsersPage';
import CronPage from './pages/CronPage';
import SettingsPage from './pages/SettingsPage';
import GitHubCallbackPage from './pages/GitHubCallbackPage';
import DomainsPage from './pages/DomainsPage';
import EmailPage from './pages/EmailPage';
import FileManagerPage from './pages/FileManagerPage';
import LoadBalancersPage from './pages/LoadBalancersPage';
import LoadBalancerManagePage from './pages/LoadBalancerManagePage';
import LoadBalancerDomainDetailPage from './pages/LoadBalancerDomainDetailPage';
import CrmPage from './pages/CrmPage';
import CrmNewCustomerPage from './pages/CrmNewCustomerPage';
import CrmLoadBalancerDetailPage from './pages/CrmLoadBalancerDetailPage';
import TerminalPage from './pages/TerminalPage';
import GuidelinePage from './pages/GuidelinePage';
import QueueMonitorPage from './pages/QueueMonitorPage';
import NginxPage from './pages/NginxPage';
import PhpFpmPage from './pages/PhpFpmPage';
import Pm2ServicePage from './pages/Pm2ServicePage';
import SubscriptionPage from './pages/SubscriptionPage';
import PaymentPage from './pages/PaymentPage';
import PaymentResultPage from './pages/PaymentResultPage';
import BillableRoutesPage from './pages/BillableRoutesPage';
import PaymentGatewaysPage from './pages/PaymentGatewaysPage';
import ManagePlansPage from './pages/ManagePlansPage';
import TransactionsPage from './pages/TransactionsPage';
import MigrationPage from './pages/MigrationPage';

// Portal
import PortalLayout from './components/PortalLayout';
import PortalHomePage from './pages/PortalHomePage';
import PortalPackagesPage from './pages/PortalPackagesPage';

const isPaymentDomain = window.location.hostname.startsWith('payment.');

// App entry point config
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Toaster richColors closeButton position="top-right" />
        {isPaymentDomain ? (
          <Routes>
            <Route element={<PortalLayout />}>
              <Route path="/" element={<PortalHomePage />} />
              <Route path="/packages" element={<PortalPackagesPage />} />
              <Route path="/payment" element={<PaymentPage />} />
              <Route path="/payment/result" element={<PaymentResultPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        ) : (
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            
            <Route element={<Layout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/crm" element={<CrmPage />} />
              <Route path="/crm/new" element={<CrmNewCustomerPage />} />
              <Route path="/crm/edit/:id" element={<CrmNewCustomerPage />} />
              <Route path="/crm/load-balancer-app-detail/:id" element={<CrmLoadBalancerDetailPage />} />
              <Route path="/apps" element={<AppsPage />} />
              <Route path="/apps/create" element={<CreateAppPage />} />
              <Route path="/apps/:id" element={<AppDetailPage />} />
              <Route path="/apps/:id/guidelines" element={<GuidelinePage />} />
              <Route path="/load-balancers" element={<LoadBalancersPage />} />
              <Route path="/load-balancers/:id/manage" element={<LoadBalancerManagePage />} />
              <Route path="/load-balancers/:lbId/domains/:domainId" element={<LoadBalancerDomainDetailPage />} />
              <Route path="/databases" element={<DatabasesPage />} />
              <Route path="/databases/users" element={<DatabaseUsersPage />} />
              <Route path="/domains" element={<DomainsPage />} />
              <Route path="/email" element={<EmailPage />} />
              <Route path="/cron-jobs" element={<CronPage />} />
              <Route path="/terminal" element={<TerminalPage />} />
              <Route path="/files" element={<FileManagerPage />} />
              <Route path="/migration" element={<MigrationPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/queue" element={<QueueMonitorPage />} />
              <Route path="/server/nginx" element={<NginxPage />} />
              <Route path="/server/php" element={<PhpFpmPage />} />
              <Route path="/server/pm2-service" element={<Pm2ServicePage />} />
              <Route path="/subscription" element={<SubscriptionPage />} />
              <Route path="/payment" element={<PaymentPage />} />
              <Route path="/payment/result" element={<PaymentResultPage />} />
              <Route path="/subscription/billable-routes" element={<BillableRoutesPage />} />
              <Route path="/subscription/gateways" element={<PaymentGatewaysPage />} />
              <Route path="/subscription/plans-manage" element={<ManagePlansPage />} />
              <Route path="/subscription/transactions" element={<TransactionsPage />} />
              <Route path="/github/callback" element={<GitHubCallbackPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        )}
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
