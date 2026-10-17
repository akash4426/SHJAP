import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, UserRole } from '../types';
import { authApi } from '../api/client';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: object) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
  primaryRole: UserRole | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    const storedToken = localStorage.getItem('token');
    if (!storedToken) {
      setIsLoading(false);
      return;
    }
    try {
      const res = await authApi.me();
      setUser(res.data.data);
      setToken(storedToken);
    } catch {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    const { user: userData, token: t, refreshToken } = res.data.data;
    localStorage.setItem('token', t);
    localStorage.setItem('refreshToken', refreshToken);
    setToken(t);
    setUser(userData);
  };

  const register = async (data: object) => {
    const res = await authApi.register(data);
    const { user: userData, token: t, refreshToken } = res.data.data;
    localStorage.setItem('token', t);
    localStorage.setItem('refreshToken', refreshToken);
    setToken(t);
    setUser(userData);
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken') ?? '';
    try {
      await authApi.logout(refreshToken);
    } catch {
      // ignore
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      setToken(null);
      setUser(null);
    }
  };

  const hasRole = (...roles: UserRole[]) => {
    if (!user) return false;
    return user.roles.some((r) => roles.includes(r));
  };

  const primaryRole: UserRole | null = user?.roles[0] ?? null;

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isAuthenticated: !!user, login, register, logout, hasRole, primaryRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
