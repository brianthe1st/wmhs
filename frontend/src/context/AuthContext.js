import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading]         = useState(true); // true while checking token

  // On mount: restore session from localStorage
  useEffect(() => {
    const token = localStorage.getItem('wmhs_token');
    const saved = localStorage.getItem('wmhs_user');
    if (token && saved) {
      try {
        setCurrentUser(JSON.parse(saved));
        // Re-validate token with server
        api.auth.me()
          .then(data => {
            setCurrentUser(data.user);
            localStorage.setItem('wmhs_user', JSON.stringify(data.user));
          })
          .catch(() => {
            // Token invalid — clear
            localStorage.removeItem('wmhs_token');
            localStorage.removeItem('wmhs_user');
            setCurrentUser(null);
          })
          .finally(() => setLoading(false));
      } catch {
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.auth.login(email, password); // throws on error
    localStorage.setItem('wmhs_token', data.token);
    localStorage.setItem('wmhs_user', JSON.stringify(data.user));
    setCurrentUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (name, email, password, joinCode) => {
    const data = await api.auth.register(name, email, password, joinCode);
    localStorage.setItem('wmhs_token', data.token);
    localStorage.setItem('wmhs_user', JSON.stringify(data.user));
    setCurrentUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('wmhs_token');
    localStorage.removeItem('wmhs_user');
    setCurrentUser(null);
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await api.auth.changePassword(currentPassword, newPassword);
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, loading, login, register, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
