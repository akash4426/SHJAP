import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Layouts
import { AppLayout } from './layouts/AppLayout';
import { AuthLayout } from './layouts/AuthLayout';

// Public pages
import { LandingPage } from './pages/public/LandingPage';
import { LoginPage } from './pages/public/LoginPage';
import { RegisterPage } from './pages/public/RegisterPage';
import { ForgotPasswordPage } from './pages/public/ForgotPasswordPage';
import { AnonymousTrackingPage } from './pages/public/AnonymousTrackingPage';

// Student pages
import { StudentDashboard } from './pages/student/StudentDashboard';
import { LodgeComplaintPage } from './pages/student/LodgeComplaintPage';
import { MyComplaintsPage } from './pages/student/MyComplaintsPage';
import { ComplaintDetailPage } from './pages/student/ComplaintDetailPage';
import { NotificationsPage } from './pages/shared/NotificationsPage';
import { ProfilePage } from './pages/shared/ProfilePage';

// Department Admin pages
import { DeptAdminDashboard } from './pages/dept-admin/DeptAdminDashboard';
import { DeptComplaintsPage } from './pages/dept-admin/DeptComplaintsPage';
import { InvestigatePage } from './pages/dept-admin/InvestigatePage';

// College Admin pages
import { CollegeAdminDashboard } from './pages/college-admin/CollegeAdminDashboard';

// University Admin pages
import { UniversityAdminDashboard } from './pages/university-admin/UniversityAdminDashboard';

// Main Admin pages
import { MainAdminDashboard } from './pages/main-admin/MainAdminDashboard';
import { UsersPage } from './pages/main-admin/UsersPage';
import { AuditLogsPage } from './pages/main-admin/AuditLogsPage';
import { AdminComplaintDetailPage } from './pages/shared/AdminComplaintDetailPage';

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && user && !user.roles.some((r) => roles.includes(r))) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}

function RoleDashboardRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;

  const role = user.roles[0];
  const redirects: Record<string, string> = {
    STUDENT: '/student/dashboard',
    DEPARTMENT_ADMIN: '/admin/dept/dashboard',
    COLLEGE_ADMIN: '/admin/college/dashboard',
    UNIVERSITY_ADMIN: '/admin/university/dashboard',
    MAIN_ADMIN: '/admin/main/dashboard',
  };
  return <Navigate to={redirects[role] ?? '/login'} replace />;
}

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, border: '3px solid var(--color-border-light)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Loading...</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public Routes */}
        <Route element={<AuthLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/track" element={<AnonymousTrackingPage />} />
        </Route>

        {/* Redirect after login */}
        <Route path="/dashboard" element={<ProtectedRoute><RoleDashboardRedirect /></ProtectedRoute>} />

        {/* Student Routes */}
        <Route path="/student" element={<ProtectedRoute roles={['STUDENT']}><AppLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<StudentDashboard />} />
          <Route path="complaints" element={<MyComplaintsPage />} />
          <Route path="complaints/new" element={<LodgeComplaintPage />} />
          <Route path="complaints/:id" element={<ComplaintDetailPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* Department Admin Routes */}
        <Route path="/admin/dept" element={<ProtectedRoute roles={['DEPARTMENT_ADMIN']}><AppLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<DeptAdminDashboard />} />
          <Route path="complaints" element={<DeptComplaintsPage />} />
          <Route path="complaints/:id" element={<AdminComplaintDetailPage />} />
          <Route path="complaints/:id/investigate" element={<InvestigatePage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* College Admin Routes */}
        <Route path="/admin/college" element={<ProtectedRoute roles={['COLLEGE_ADMIN']}><AppLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<CollegeAdminDashboard />} />
          <Route path="complaints/:id" element={<AdminComplaintDetailPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* University Admin Routes */}
        <Route path="/admin/university" element={<ProtectedRoute roles={['UNIVERSITY_ADMIN']}><AppLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<UniversityAdminDashboard />} />
          <Route path="complaints/:id" element={<AdminComplaintDetailPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* Main Admin Routes */}
        <Route path="/admin/main" element={<ProtectedRoute roles={['MAIN_ADMIN']}><AppLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<MainAdminDashboard />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="complaints/:id" element={<AdminComplaintDetailPage />} />
          <Route path="audit-logs" element={<AuditLogsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* Unauthorized */}
        <Route path="/unauthorized" element={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '1rem', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>403 — Forbidden</h1>
            <p style={{ color: 'var(--color-text-muted)' }}>You don't have permission to access this page.</p>
          </div>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
