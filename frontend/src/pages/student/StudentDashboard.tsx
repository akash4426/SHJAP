import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { complaintsApi } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { FileText, Plus, Clock, CheckCircle, AlertCircle, Bell, ChevronRight } from 'lucide-react';
import { StatusBadge, PriorityBadge, PageLoading, EmptyState } from '../../components/shared';
import { Complaint } from '../../types';

export function StudentDashboard() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['complaints', 'student'],
    queryFn: () => complaintsApi.list({ limit: 50 }),
  });

  const complaints: Complaint[] = data?.data?.data ?? [];

  const stats = {
    total: complaints.length,
    active: complaints.filter((c) => !['RESOLVED', 'CLOSED', 'REJECTED'].includes(c.status)).length,
    resolved: complaints.filter((c) => ['RESOLVED', 'CLOSED'].includes(c.status)).length,
    pending: complaints.filter((c) => ['SUBMITTED', 'CATEGORIZED', 'ASSIGNED'].includes(c.status)).length,
  };

  const recent = [...complaints].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  if (isLoading) return <PageLoading />;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Welcome back, {user?.firstName} 👋</h1>
        <p className="page-subtitle">Here's an overview of your complaints</p>
      </div>

      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: '2rem' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--color-primary-subtle)' }}>
            <FileText size={20} color="var(--color-primary)" />
          </div>
          <div>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Complaints</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--color-warning-subtle)' }}>
            <Clock size={20} color="var(--color-warning)" />
          </div>
          <div>
            <div className="stat-value">{stats.active}</div>
            <div className="stat-label">Active</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--color-success-subtle)' }}>
            <CheckCircle size={20} color="var(--color-success)" />
          </div>
          <div>
            <div className="stat-value">{stats.resolved}</div>
            <div className="stat-label">Resolved</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--color-info-subtle)' }}>
            <AlertCircle size={20} color="var(--color-info)" />
          </div>
          <div>
            <div className="stat-value">{stats.pending}</div>
            <div className="stat-label">Pending Review</div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <Link to="/student/complaints/new" className="btn btn-primary">
          <Plus size={18} /> Lodge New Complaint
        </Link>
        <Link to="/student/complaints" className="btn btn-secondary">
          <FileText size={18} /> View All Complaints
        </Link>
      </div>

      {/* Recent complaints */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Recent Complaints</h2>
          <Link to="/student/complaints" style={{ fontSize: '0.8125rem', color: 'var(--color-primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            View all <ChevronRight size={14} />
          </Link>
        </div>

        {recent.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="No complaints yet"
            description="Lodge your first complaint to get started."
            action={<Link to="/student/complaints/new" className="btn btn-primary btn-sm">Lodge Complaint</Link>}
          />
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Complaint #</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{c.complaintNumber}</td>
                    <td style={{ fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td><PriorityBadge priority={c.priority} /></td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td>
                      <Link to={`/student/complaints/${c.id}`} className="btn btn-ghost btn-sm">
                        View <ChevronRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
