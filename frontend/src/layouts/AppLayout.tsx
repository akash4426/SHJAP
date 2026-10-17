import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '../api/client';
import {
  LayoutDashboard, FileText, Bell, User, LogOut, Shield,
  Menu, X, ChevronRight, AlertCircle, Building2, Users,
  ClipboardList, ScrollText, BarChart3, Settings
} from 'lucide-react';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

function getNavItems(role: string): NavItem[] {
  const base: Record<string, NavItem[]> = {
    STUDENT: [
      { label: 'Dashboard', path: '/student/dashboard', icon: <LayoutDashboard size={18} /> },
      { label: 'My Complaints', path: '/student/complaints', icon: <FileText size={18} /> },
      { label: 'Notifications', path: '/student/notifications', icon: <Bell size={18} /> },
      { label: 'Profile', path: '/student/profile', icon: <User size={18} /> },
    ],
    DEPARTMENT_ADMIN: [
      { label: 'Dashboard', path: '/admin/dept/dashboard', icon: <LayoutDashboard size={18} /> },
      { label: 'Complaints', path: '/admin/dept/complaints', icon: <FileText size={18} /> },
      { label: 'Notifications', path: '/admin/dept/notifications', icon: <Bell size={18} /> },
      { label: 'Profile', path: '/admin/dept/profile', icon: <User size={18} /> },
    ],
    COLLEGE_ADMIN: [
      { label: 'Dashboard', path: '/admin/college/dashboard', icon: <LayoutDashboard size={18} /> },
      { label: 'Notifications', path: '/admin/college/notifications', icon: <Bell size={18} /> },
      { label: 'Profile', path: '/admin/college/profile', icon: <User size={18} /> },
    ],
    UNIVERSITY_ADMIN: [
      { label: 'Dashboard', path: '/admin/university/dashboard', icon: <LayoutDashboard size={18} /> },
      { label: 'Notifications', path: '/admin/university/notifications', icon: <Bell size={18} /> },
      { label: 'Profile', path: '/admin/university/profile', icon: <User size={18} /> },
    ],
    MAIN_ADMIN: [
      { label: 'Dashboard', path: '/admin/main/dashboard', icon: <LayoutDashboard size={18} /> },
      { label: 'Users', path: '/admin/main/users', icon: <Users size={18} /> },
      { label: 'Audit Logs', path: '/admin/main/audit-logs', icon: <ScrollText size={18} /> },
      { label: 'Notifications', path: '/admin/main/notifications', icon: <Bell size={18} /> },
      { label: 'Profile', path: '/admin/main/profile', icon: <User size={18} /> },
    ],
  };
  return base[role] ?? [];
}

const roleColors: Record<string, string> = {
  STUDENT: 'var(--color-primary)',
  DEPARTMENT_ADMIN: 'var(--color-accent)',
  COLLEGE_ADMIN: 'var(--color-success)',
  UNIVERSITY_ADMIN: 'var(--color-warning)',
  MAIN_ADMIN: 'var(--color-danger)',
};

const roleLabels: Record<string, string> = {
  STUDENT: 'Student',
  DEPARTMENT_ADMIN: 'Dept. Admin',
  COLLEGE_ADMIN: 'College Admin',
  UNIVERSITY_ADMIN: 'University Admin',
  MAIN_ADMIN: 'System Admin',
};

export function AppLayout() {
  const { user, logout, primaryRole } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationsApi.list({ limit: 1 }),
    refetchInterval: 30_000,
  });

  const unreadCount = notifData?.data?.data?.unreadCount ?? 0;
  const navItems = getNavItems(primaryRole ?? '');
  const roleColor = roleColors[primaryRole ?? ''] ?? 'var(--color-primary)';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, display: 'block' }}
        />
      )}

      {/* Sidebar */}
      <aside style={{
        width: 'var(--sidebar-width)',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 50,
        transform: sidebarOpen ? 'translateX(0)' : undefined,
        transition: 'transform 0.3s',
      }}
        className="sidebar"
      >
        {/* Logo */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: 36, height: 36, background: `linear-gradient(135deg, ${roleColor}, var(--color-accent))`, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem', lineHeight: 1.2 }}>SHJAP</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>Grievance Portal</div>
          </div>
        </div>

        {/* Role badge */}
        <div style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid var(--color-border)' }}>
          <span className="badge" style={{ background: `${roleColor}20`, color: roleColor, fontSize: '0.6875rem' }}>
            {roleLabels[primaryRole ?? '']}
          </span>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', overflowY: 'auto' }}>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.625rem 0.75rem',
                borderRadius: 'var(--radius)',
                fontSize: '0.875rem',
                fontWeight: 500,
                textDecoration: 'none',
                color: isActive ? roleColor : 'var(--color-text-muted)',
                background: isActive ? `${roleColor}15` : 'transparent',
                border: `1px solid ${isActive ? `${roleColor}30` : 'transparent'}`,
                transition: 'all 0.2s',
                position: 'relative',
              })}
            >
              {item.icon}
              {item.label}
              {item.label === 'Notifications' && unreadCount > 0 && (
                <span className="notif-badge" style={{ position: 'static', marginLeft: 'auto' }}>{unreadCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div style={{ padding: '1rem 0.75rem', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: 'var(--radius)', background: 'var(--color-surface-2)', marginBottom: '0.5rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: `linear-gradient(135deg, ${roleColor}, var(--color-accent))`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.firstName} {user?.lastName}
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email}
              </div>
            </div>
          </div>
          <button onClick={handleLogout} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', color: 'var(--color-danger)' }}>
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginLeft: 'var(--sidebar-width)' }} className="main-content">
        {/* Top bar */}
        <header style={{
          height: 'var(--header-height)',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 1.5rem',
          gap: '1rem',
          flexShrink: 0,
        }}>
          <button className="btn-icon" onClick={() => setSidebarOpen(!sidebarOpen)} style={{ display: 'none' }} id="menu-btn">
            <Menu size={20} />
          </button>
          <div style={{ flex: 1 }} />
          {/* Quick notification bell */}
          <NavLink to={`/${primaryRole === 'STUDENT' ? 'student' : `admin/${primaryRole === 'DEPARTMENT_ADMIN' ? 'dept' : primaryRole === 'COLLEGE_ADMIN' ? 'college' : primaryRole === 'UNIVERSITY_ADMIN' ? 'university' : 'main'}`}/notifications`}
            style={{ position: 'relative', display: 'inline-flex' }}>
            <button className="btn-icon">
              <Bell size={20} />
              {unreadCount > 0 && <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
          </NavLink>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
          <Outlet />
        </main>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .sidebar { transform: translateX(-100%); }
          .sidebar.open { transform: translateX(0); }
          .main-content { margin-left: 0 !important; }
          #menu-btn { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}
