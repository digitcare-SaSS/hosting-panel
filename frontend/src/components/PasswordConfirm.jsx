import { useState, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Lock } from 'lucide-react';

/**
 * Sensitive migration actions answer 423 until the admin re-enters their password.
 * `run(action)` performs the action and, on 423, asks for the password and retries it.
 * A cancelled prompt rejects with `{ cancelled: true }`.
 */
export function usePasswordConfirm() {
  const [pending, setPending] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action) => {
    try {
      return await action();
    } catch (err) {
      if (err.response?.status !== 423) throw err;
      return new Promise((resolve, reject) => setPending({ action, resolve, reject }));
    }
  }, []);

  const close = () => {
    setPending(null);
    setPassword('');
    setError(null);
  };

  const cancel = () => {
    pending?.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    close();
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/migration/confirm-password', { password });
    } catch (err) {
      setError(err.response?.status === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : err.response?.data?.error || 'Wrong password.');
      setBusy(false);
      return;
    }
    const current = pending;
    close();
    setBusy(false);
    try {
      current.resolve(await current.action());
    } catch (err) {
      current.reject(err);
    }
  };

  const dialog = (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-sm border-white/10 bg-[#0f1017]">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Confirm your password</DialogTitle>
            <DialogDescription className="pt-2">
              Migration can copy or replace this entire server. Re-enter your admin password to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-xs text-rose-400">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
            <Button type="submit" disabled={!password || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return [run, dialog];
}
