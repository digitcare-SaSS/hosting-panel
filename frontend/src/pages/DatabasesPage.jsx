import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Database, Plus, Trash2, Copy, CheckCircle2, ExternalLink, Key, Users } from 'lucide-react';
import ConfirmationDialog from '@/components/ConfirmationDialog';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter 
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export default function DatabasesPage() {
  const [databases, setDatabases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [newCredentials, setNewCredentials] = useState(null);
  const [copied, setCopied] = useState(false);
  const [dbToDelete, setDbToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const [dbToChangePassword, setDbToChangePassword] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);

  const fetchDatabases = async () => {
    try {
      const { data } = await api.get('/databases');
      setDatabases(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatabases();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newDbName) return;
    
    setCreating(true);
    setNewCredentials(null);
    try {
      const { data } = await api.post('/databases', { db_name: newDbName });
      setNewCredentials(data);
      setNewDbName('');
      fetchDatabases();
      toast.success('Database created successfully');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create database');
    } finally {
      setCreating(false);
    }
  };

  const handleManage = async (dbId) => {
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

  const handleConfirmDelete = async () => {
    if (!dbToDelete) return;
    setIsDeleting(true);
    try {
      await api.delete(`/databases/${dbToDelete.id}`);
      toast.success(`Database "${dbToDelete.db_name}" deleted`);
      fetchDatabases();
      if (newCredentials?.id === dbToDelete.id) setNewCredentials(null);
      setDbToDelete(null);
    } catch (err) {
      toast.error('Failed to delete database');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDelete = (db) => {
    setDbToDelete(db);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (!dbToChangePassword || !newPassword) return;

    setIsChangingPassword(true);
    try {
      await api.post(`/databases/${dbToChangePassword.id}/password`, { password: newPassword });
      toast.success('Database password updated successfully');
      setDbToChangePassword(null);
      setNewPassword('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update database password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(`DB_CONNECTION=pgsql\nDB_HOST=127.0.0.1\nDB_PORT=5432\nDB_DATABASE=${text.db_name}\nDB_USERNAME=${text.db_user}\nDB_PASSWORD=${text.db_password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <h2 className="text-3xl font-bold tracking-tight">PostgreSQL Databases</h2>
          <p className="text-muted-foreground mt-1">Manage local PostgreSQL databases and users.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input 
            placeholder="Search databases..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-48 h-9"
          />
          <Button variant="outline" onClick={() => window.location.href = '/databases/users'}>
            <Users className="mr-2 h-4 w-4" /> Manage Users
          </Button>
          <Button variant="outline" onClick={() => window.open('/adminer/?pgsql=127.0.0.1', '_blank')}>
            <ExternalLink className="mr-2 h-4 w-4" /> Open Adminer
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Create DB Form */}
        <div className="md:col-span-1 space-y-6 md:sticky md:top-6 self-start">
          <Card>
            <CardHeader>
              <CardTitle>Create Database</CardTitle>
              <CardDescription>Creates a new database and a dedicated user.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Database Name</label>
                  <Input 
                    placeholder="my_app_db" 
                    value={newDbName} 
                    onChange={e => setNewDbName(e.target.value)} 
                    pattern="[a-zA-Z0-9_]+"
                    required 
                  />
                  <p className="text-xs text-muted-foreground">Only letters, numbers, and underscores.</p>
                </div>
                <Button type="submit" className="w-full" disabled={creating || !newDbName}>
                  {creating ? 'Creating...' : <><Plus className="mr-2 h-4 w-4" /> Create Database</>}
                </Button>
              </form>
            </CardContent>
          </Card>

          {newCredentials && (
            <Card className="border-success/50 bg-success/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-success flex items-center gap-2 text-lg">
                  <CheckCircle2 className="h-5 w-5" /> Database Created
                </CardTitle>
                <CardDescription>
                  Please copy these credentials now. The password will not be shown again!
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 font-mono text-sm">
                <div><span className="text-muted-foreground block text-xs">Host:</span> 127.0.0.1</div>
                <div><span className="text-muted-foreground block text-xs">Port:</span> 5432</div>
                <div><span className="text-muted-foreground block text-xs">Database:</span> {newCredentials.db_name}</div>
                <div><span className="text-muted-foreground block text-xs">Username:</span> {newCredentials.db_user}</div>
                <div>
                  <span className="text-muted-foreground block text-xs">Password:</span> 
                  <span className="text-foreground bg-black px-2 py-1 rounded">{newCredentials.db_password}</span>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full mt-4" 
                  onClick={() => copyToClipboard(newCredentials)}
                >
                  {copied ? 'Copied .env format!' : <><Copy className="mr-2 h-4 w-4" /> Copy .env format</>}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* DB List */}
        <div className="md:col-span-2 space-y-4">
          {loading ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">Loading databases...</div>
          ) : databases.length === 0 ? (
            <Card className="border-dashed flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Database className="h-12 w-12 mb-4 opacity-20" />
              <p>No databases created yet.</p>
            </Card>
          ) : (
            databases
              .filter(db => db.db_name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(db => (<Card key={db.id}>
                 <CardContent className="p-4 sm:p-6">
                   <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                     <div className="flex items-center gap-4 flex-1 min-w-0">
                       <div className="bg-primary/10 p-3 rounded-full text-primary flex-shrink-0">
                         <Database className="h-6 w-6" />
                       </div>
                       <div className="min-w-0">
                         <h3 className="font-semibold text-lg truncate">{db.db_name}</h3>
                         <div className="text-sm text-muted-foreground mt-1 truncate flex items-center gap-2">
                           <span>Owner: <span className="font-mono">{db.db_user}</span></span>
                           {db.users?.filter(u => u.username !== db.db_user).length > 0 && (
                             <>
                               <span className="text-muted-foreground/30">•</span>
                               <span className="flex items-center gap-1.5 flex-wrap">
                                 Additional: 
                                 {db.users.filter(u => u.username !== db.db_user).map(u => (
                                   <Badge key={u.id} variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                                     {u.username}
                                     <span className="opacity-50 border-l border-secondary-foreground/20 ml-1 pl-1 uppercase">{u.pivot?.privileges || 'read'}</span>
                                   </Badge>
                                 ))}
                               </span>
                             </>
                           )}
                         </div>
                       </div>
                     </div>
                     <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                       <Badge variant={db.status === 'active' ? 'success' : 'destructive'}>{db.status}</Badge>
                       <Button 
                         variant="outline" 
                         size="sm" 
                         className="text-primary border-primary/20 hover:bg-primary/5"
                         onClick={() => handleManage(db.id)}
                       >
                         <ExternalLink className="mr-2 h-4 w-4" /> Manage
                       </Button>
                       <Button 
                         variant="ghost" 
                         size="icon" 
                         className="text-muted-foreground hover:text-primary hover:bg-primary/10" 
                         onClick={() => setDbToChangePassword(db)}
                         title="Change Password"
                       >
                         <Key className="h-4 w-4" />
                       </Button>
                       <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDelete(db)}>
                         <Trash2 className="h-5 w-5" />
                       </Button>
                     </div>
                   </div>
                 </CardContent>
               </Card>
            ))
          )}
        </div>
      </div>

      <ConfirmationDialog
        open={!!dbToDelete}
        onOpenChange={(open) => !open && setDbToDelete(null)}
        title="Delete Database"
        description={`WARNING: This will permanently delete the database "${dbToDelete?.db_name}" and all its data. This action cannot be undone.`}
        confirmText="Delete Database"
        variant="destructive"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
      />

      <Dialog open={!!dbToChangePassword} onOpenChange={(open) => !open && setDbToChangePassword(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handlePasswordChange}>
            <DialogHeader>
              <DialogTitle>Change Database Password</DialogTitle>
              <DialogDescription>
                Enter a new password for database <span className="font-semibold">{dbToChangePassword?.db_name}</span>.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">New Password</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDbToChangePassword(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isChangingPassword || newPassword.length < 8}>
                {isChangingPassword ? 'Changing...' : 'Change Password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
