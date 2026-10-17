import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { User, Mail, Phone, Shield, Calendar } from 'lucide-react';

export function ProfilePage() {
  const { user, primaryRole } = useAuth();

  const roleLabels: Record<string, string> = {
    STUDENT: 'Student',
    DEPARTMENT_ADMIN: 'Department Administrator',
    COLLEGE_ADMIN: 'College Administrator',
    UNIVERSITY_ADMIN: 'University Administrator',
    MAIN_ADMIN: 'System Administrator',
  };

  const roleColors: Record<string, string> = {
    STUDENT: 'var(--color-primary)',
    DEPARTMENT_ADMIN: 'var(--color-accent)',
    COLLEGE_ADMIN: 'var(--color-success)',
    UNIVERSITY_ADMIN: 'var(--color-warning)',
    MAIN_ADMIN: 'var(--color-danger)',
  };

  const roleColor = roleColors[primaryRole ?? ''] ?? 'var(--color-primary)';

  if (!user) return null;

  return (
    <div className="fade-in" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-header">
        <h1 className="page-title">My Profile</h1>
        <p className="page-subtitle">Your account information</p>
      </div>

      {/* Avatar + name */}
      <div className="card" style={{ textAlign: 'center', marginBottom: '1.5rem', padding: '2rem' }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: `linear-gradient(135deg, ${roleColor}, var(--color-accent))`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 1rem', fontSize: '1.75rem', fontWeight: 700, color: '#fff',
          boxShadow: `0 0 30px ${roleColor}40`,
        }}>
          {user.firstName[0]}{user.lastName[0]}
        </div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.375rem' }}>
          {user.firstName} {user.lastName}
        </h2>
        <span className="badge" style={{ background: `${roleColor}20`, color: roleColor }}>
          {roleLabels[primaryRole ?? '']}
        </span>
      </div>

      {/* Details */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Account Details</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {[
            { icon: <Mail size={16} />, label: 'Email', value: user.email },
            { icon: <Phone size={16} />, label: 'Phone', value: user.phone ?? 'Not provided' },
            { icon: <Shield size={16} />, label: 'Role', value: roleLabels[primaryRole ?? ''] },
            { icon: <Calendar size={16} />, label: 'Member Since', value: new Date(user.createdAt).toLocaleDateString() },
            { icon: <User size={16} />, label: 'Last Login', value: user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'N/A' },
          ].map(({ icon, label, value }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
              <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                {icon}
              </div>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{label}</div>
                <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Student profile */}
      {user.studentProfile && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Student Information</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {[
              { label: 'Student ID', value: user.studentProfile.studentId },
              { label: 'Program', value: user.studentProfile.program ?? 'N/A' },
              { label: 'Year', value: user.studentProfile.year ? `Year ${user.studentProfile.year}` : 'N/A' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{label}</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin profile */}
      {user.adminProfile && (
        <div className="card">
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Administrator Information</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {[
              { label: 'Employee ID', value: user.adminProfile.employeeId },
              { label: 'Designation', value: user.adminProfile.designation ?? 'N/A' },
              { label: 'Department', value: user.adminProfile.department?.name ?? 'N/A' },
              { label: 'College', value: user.adminProfile.college?.name ?? 'N/A' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{label}</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MFA status */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Two-Factor Authentication</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              {user.mfaEnabled ? 'MFA is enabled for your account' : 'MFA is not enabled'}
            </div>
          </div>
          <span className={`badge ${user.mfaEnabled ? 'badge-green' : 'badge-gray'}`}>
            {user.mfaEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </div>
    </div>
  );
}
