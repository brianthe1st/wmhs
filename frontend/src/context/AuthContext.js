import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, clearSession } from '../utils/api';

const AuthContext = createContext(null);

const store = (token, user) => {
  try {
    if (token) localStorage.setItem('wmhs_token', token);
    localStorage.setItem('wmhs_user', JSON.stringify(user));
  } catch { /* storage may be blocked (private mode) — session then lasts until reload */ }
};

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading]         = useState(true); // true while checking token

  const refreshUser = useCallback(async () => {
    const data = await api.auth.me();
    store(null, data.user);
    setCurrentUser(data.user);
    return data.user;
  }, []);

  // On mount: restore session, then re-validate with the server.
  useEffect(() => {
    let token = null, saved = null;
    try { token = localStorage.getItem('wmhs_token'); saved = localStorage.getItem('wmhs_user'); } catch { /* ignore */ }
    if (!token || !saved) { setLoading(false); return; }
    try { setCurrentUser(JSON.parse(saved)); } catch { clearSession(); setLoading(false); return; }
    api.auth.me()
      .then(data => { setCurrentUser(data.user); store(null, data.user); })
      .catch(() => { clearSession(); setCurrentUser(null); })
      .finally(() => setLoading(false));
  }, []);

  // The server told us a password change is required → re-read our profile so the forced screen shows.
  useEffect(() => {
    const h = () => { refreshUser().catch(() => {}); };
    window.addEventListener('wmhs:password-change-required', h);
    return () => window.removeEventListener('wmhs:password-change-required', h);
  }, [refreshUser]);

  const login = useCallback(async (email, password) => {
    const data = await api.auth.login(email, password); // throws on error
    store(data.token, data.user);
    setCurrentUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (name, email, password, joinCode) => {
    const data = await api.auth.register(name, email, password, joinCode);
    store(data.token, data.user);
    setCurrentUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setCurrentUser(null);
  }, []);

  // The server revokes old tokens on a password change and returns a fresh one.
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const data = await api.auth.changePassword(currentPassword, newPassword);
    if (data.token && data.user) { store(data.token, data.user); setCurrentUser(data.user); }
    return data;
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, loading, login, register, logout, changePassword, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
