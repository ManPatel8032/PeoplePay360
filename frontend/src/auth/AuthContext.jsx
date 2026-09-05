/**
 * Auth state for the whole app.
 *
 * On mount we try one silent /auth/refresh. If the httpOnly refresh cookie is
 * still valid the user lands back where they were after a page reload; if not
 * they go to /login. Nothing is read from localStorage, so a reload cannot
 * resurrect a session the server has already revoked.
 */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, setAccessToken, setUnauthorizedHandler } from '../api.js';

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [booting, setBooting] = useState(true);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setPermissions({});
  }, []);

  // A dead session anywhere in the app drops us back to logged-out state.
  useEffect(() => { setUnauthorizedHandler(clear); }, [clear]);

  const loadMe = useCallback(async () => {
    const me = await api.get('/auth/me');
    setUser(me.user);
    setPermissions(me.permissions || {});
    return me.user;
  }, []);

  // Silent restore on first paint.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
        if (!res.ok) throw new Error('no session');
        const { accessToken } = await res.json();
        setAccessToken(accessToken);
        if (alive) await loadMe();
      } catch {
        if (alive) clear();
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => { alive = false; };
  }, [loadMe, clear]);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    setAccessToken(res.accessToken);
    setUser(res.user);
    await loadMe().catch(() => {});
    return res.user;
  }, [loadMe]);

  const register = useCallback(async (email, password) => {
    const res = await api.post('/auth/register', { email, password });
    setAccessToken(res.accessToken);
    setUser(res.user);
    await loadMe().catch(() => {});
    return res.user;
  }, [loadMe]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* revoke best-effort */ }
    clear();
  }, [clear]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await api.post('/auth/change-password', { currentPassword, newPassword });
    setUser((u) => (u ? { ...u, must_change_password: false } : u));
  }, []);

  /** Can the current role read this module? Drives the nav. */
  const canRead = useCallback((module) => {
    const ROLES = ['employee', 'hr_manager', 'payroll_user', 'payroll_manager', 'admin'];
    const need = permissions?.[module]?.read;
    if (!need || !user) return false;
    return ROLES.indexOf(user.role) >= ROLES.indexOf(need);
  }, [permissions, user]);

  const value = useMemo(
    () => ({ user, permissions, booting, login, register, logout, changePassword, canRead }),
    [user, permissions, booting, login, register, logout, changePassword, canRead]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
