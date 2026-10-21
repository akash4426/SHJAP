import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { complaintsApi, adminApi } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { LayoutDashboard, FileText, Clock, CheckCircle, AlertCircle, ChevronRight, UserCheck } from 'lucide-react';
import { StatusBadge, PriorityBadge, TrustScoreBadge, PageLoading } from '../../components/shared';
import { Complaint } from '../../types';
import toast from 'react-hot-toast';
import { Spinner } from '../../components/shared';

export function DeptAdminDashboard() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['complaints', 'dept-admin'],
    queryFn: () => complaintsApi.list({ limit: 100 }),
    // New complaints are routed by the API; poll so the dashboard reflects
    // them without requiring a manual page reload.
    refetchInterval: 20_000,
  });

  const complaints: Complaint[] = data?.data?.data ?? [];

  const stats = {
    total: complaints.length,
    submitted: complaints.filter(c => ['SUBMITTED', 'CATEGORIZED'].includes(c.status)).length,
    investigating: complaints.filter(c => ['ASSIGNED', 'UNDER_INVESTIGATION', 'INFORMATION_REQUESTED'].includes(c.status)).length,
    escalated: complaints.filter(c => c.status === 'ESCALATED').length,
    resolved: complaints.filter(c => ['RESOLVED', 'CLOSED'].includes(c.status)).length,
  };

  if (isLoading) return <PageLoading />;

  const recentComplaints = [...complaints]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  const urgent = complaints.filter(c => c.priority === 'URGENT' && !['RESOLVED', 'CLOSED'].includes(c.status));

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Department Dashboard</h1>
        <p className="page-subtitle">Welcome back, {user?.firstName}. Manage your department's grievances.</p>
      </div>

      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: '2rem' }}>
        {[
          { label: 'Total Complaints', value: stats.total, icon: <FileText size={20} />, color: 'var(--color-primary)' },
          { label: 'Awaiting Review', value: stats.submitted, icon: <Clock size={20} />, color: 'var(--color-warning)' },
          { label: 'Investigating', value: stats.investigating, icon: <AlertCircle size={20} />, color: 'var(--color-info)' },
          { label: 'Resolved', value: stats.resolved, icon: <CheckCircle size={20} />, color: 'var(--color-success)' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-icon" style={{ background: `${color}15` }}>{React.cloneElement(icon as React.ReactElement, { color })}</div>
            <div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>
          </div>
        ))}
      </div>

      {/* Urgent complaints alert */}
      {urgent.length > 0 && (
        <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>{urgent.length} urgent complaint{urgent.length > 1 ? 's' : ''} require immediate attention.</strong>
            <div style={{ marginTop: '0.375rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {urgent.slice(0, 3).map(c => (
                <Link key={c.id} to={`/admin/dept/complaints/${c.id}`} style={{ fontSize: '0.8125rem', color: 'var(--color-danger)', fontWeight: 600, textDecoration: 'underline' }}>
                  {c.complaintNumber}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent complaints */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Recent Complaints</h2>
          <Link to="/admin/dept/complaints" style={{ fontSize: '0.8125rem', color: 'var(--color-primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            View all <ChevronRight size={14} />
          </Link>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Complaint #</th>
                <th>Title</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Trust Score</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentComplaints.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem' }}>No complaints</td></tr>
              ) : recentComplaints.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{c.complaintNumber}</td>
                  <td style={{ fontWeight: 500, maxWidth: 200 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td><PriorityBadge priority={c.priority} /></td>
                  <td><TrustScoreBadge trustScore={c.trustScore} /></td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td>
                    <Link to={`/admin/dept/complaints/${c.id}`} className="btn btn-ghost btn-sm">
                      View <ChevronRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
