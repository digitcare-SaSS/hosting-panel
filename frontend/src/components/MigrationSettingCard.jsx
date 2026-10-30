import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { usePasswordConfirm } from '@/components/PasswordConfirm';
import { ArrowRightLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

export const MIGRATION_CHANGED_EVENT = 'panel:migration-changed';

/**
 * System Settings: the master switch for panel-to-panel migration.
 * Off hides the Migration menu and closes this panel to copying and receiving.
 */
export default function MigrationSettingCard() {
  const [enabled, setEnabled] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmRun, passwordDialog] = usePasswordConfirm();

  useEffect(() => {
    api.get('/migration').then(({ data }) => setEnabled(Boolean(data.enabled))).catch(() => setEnabled(false));
  }, []);

  const toggle = async (value) => {
    setSaving(true);
    try {
      const { data } = await confirmRun(() => api.put('/migration/enabled', { enabled: value }));
      setEnabled(Boolean(data.enabled));
      window.dispatchEvent(new CustomEvent(MIGRATION_CHANGED_EVENT, { detail: { enabled: Boolean(data.enabled) } }));
      toast.success(data.enabled ? 'Migration turned on' : 'Migration turned off — any key was revoked');
    } catch (err) {
      if (!err.cancelled) toast.error(err.response?.data?.error || 'Could not change the migration setting');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-6" data-testid="migration-setting">
      <CardHeader className="flex flex-row items-start gap-4 space-y-0">
        <div className="flex-1 space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-4 w-4 text-primary" /> Server migration
          </CardTitle>
          <CardDescription>
            Allow this panel to send everything to a new server, or to receive everything from an old one. While off, the
            Migration menu is hidden and nothing can be copied. It switches off by itself after a transfer.
          </CardDescription>
        </div>
        <Switch
          checked={Boolean(enabled)}
          disabled={enabled === null || saving}
          onCheckedChange={toggle}
          aria-label="Allow server migration"
        />
      </CardHeader>
      {enabled && (
        <CardContent className="pt-0">
          <Link to="/migration" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Open Migration <ChevronRight className="h-4 w-4" />
          </Link>
        </CardContent>
      )}
      {passwordDialog}
    </Card>
  );
}
