import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { complaintsApi, analyticsApi } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import {
  FileText, CheckCircle, AlertCircle, Users, BarChart3, ArrowUpCircle,
  ChevronRight, TrendingUp, Shield, Database
} from 'lucide-react';
import { StatusBadge, PriorityBadge, TrustScoreBadge, PageLoading } from '../../components/shared';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, AreaChart, Area
} from 'recharts';
import { Complaint } from '../../types';

const COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#64748b','#f97316'];

export function MainAdminDashboard() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['complaints', 'all'],
    queryFn: () => complaintsApi.list({ limit: 100 }),
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => analyticsApi.overview(),
  });

  const { data: catAnalytics } = useQuery({
    queryKey: ['analytics', 'categories'],
    queryFn: () => analyticsApi.categories(),
  });

  const { data: trustData } = useQuery({
    queryKey: ['analytics', 'trust-scores'],
    queryFn: () => analyticsApi.trustScores(),
  });

  const complaints: Complaint[] = data?.data?.data ?? [];
  const categories: any[] = catAnalytics?.data?.data ?? [];
  const trust: any = trustData?.data?.data;

  const stats = {
    total: complaints.length,
    pending: complaints.filter(c => !['RESOLVED','CLOSED','REJECTED'].includes(c.status)).length,
    resolved: complaints.filter(c => ['RESOLVED','CLOSED'].includes(c.status)).length,
    escalated: complaints.filter(c => c.status === 'ESCALATED').length,
    urgent: complaints.filter(c => c.priority === 'URGENT' && !['RESOLVED','CLOSED'].includes(c.status)).length,
    anonymous: complaints.filter(c => c.isAnonymous).length,
    rejected: complaints.filter(c => c.status === 'REJECTED').length,
    investigating: complaints.filter(c => c.status === 'UNDER_INVESTIGATION').length,
  };

  const statusBreakdown = complaints.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.entries(statusBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name: name.replace(/_/g,' '), value }));

  const priorityBreakdown = complaints.reduce((acc, c) => {
    acc[c.priority] = (acc[c.priority] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const priorityData = [
    { priority: 'Urgent', count: priorityBreakdown['URGENT'] ?? 0, fill: '#ef4444' },
    { priority: 'High', count: priorityBreakdown['HIGH'] ?? 0, fill: '#f59e0b' },
    { priority: 'Medium', count: priorityBreakdown['MEDIUM'] ?? 0, fill: '#3b82f6' },
    { priority: 'Low', count: priorityBreakdown['LOW'] ?? 0, fill: '#10b981' },
  ];

  if (isLoading) return <PageLoading />;

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1 className="page-title">System Dashboard</h1>
          <p className="page-subtitle">Complete overview of the SHJAP Grievance Portal</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link to="/admin/main/users" className="btn btn-secondary btn-sm"><Users size={14} /> Manage Users</Link>
          <Link to="/admin/main/audit-logs" className="btn btn-secondary btn-sm"><Database size={14} /> Audit Logs</Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Total Complaints', value: stats.total, icon: <FileText size={20} />, color: 'var(--color-primary)' },
          { label: 'Active Cases', value: stats.pending, icon: <AlertCircle size={20} />, color: 'var(--color-warning)' },
          { label: 'Resolved', value: stats.resolved, icon: <CheckCircle size={20} />, color: 'var(--color-success)' },
          { label: 'Escalated', value: stats.escalated, icon: <ArrowUpCircle size={20} />, color: 'var(--color-danger)' },
          { label: 'Investigating', value: stats.investigating, icon: <Shield size={20} />, color: 'var(--color-info)' },
          { label: 'Urgent', value: stats.urgent, icon: <TrendingUp size={20} />, color: 'var(--color-danger)' },
          { label: 'Anonymous', value: stats.anonymous, icon: <Shield size={20} />, color: 'var(--color-accent)' },
          { label: 'Rejected', value: stats.rejected, icon: <FileText size={20} />, color: 'var(--color-text-muted)' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-icon" style={{ background: `${color}15` }}>{React.cloneElement(icon as React.ReactElement, { color })}</div>
            <div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        {/* Status Pie */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Status Distribution</h2>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${(percent*100).toFixed(0)}%`} labelLine={false}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)', fontSize: '0.8125rem' }} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Priority Bar */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Priority Breakdown</h2>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={priorityData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis dataKey="priority" type="category" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} width={55} />
              <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {priorityData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        {/* Category breakdown */}
        {categories.length > 0 && (
          <div className="card">
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Complaints by Category</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={categories.slice(0, 6)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="category" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }} />
                <Bar dataKey="count" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Trust score distribution */}
        {trust && (
          <div className="card">
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Trust Score Distribution</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {[
                { label: 'High Trust (≥70)', value: trust.high ?? 0, color: 'var(--color-success)' },
                { label: 'Medium Trust (40–69)', value: trust.medium ?? 0, color: 'var(--color-warning)' },
                { label: 'Low Trust (<40)', value: trust.low ?? 0, color: 'var(--color-danger)' },
                { label: 'Pending', value: trust.pending ?? 0, color: 'var(--color-text-muted)' },
              ].map(({ label, value, color }) => {
                const total = (trust.high ?? 0) + (trust.medium ?? 0) + (trust.low ?? 0) + (trust.pending ?? 0);
                const pct = total > 0 ? (value / total) * 100 : 0;
                return (
                  <div key={label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
                      <span style={{ fontWeight: 600 }}>{value}</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--color-surface-2)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {trust.average != null && (
              <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                Average Trust Score: <strong style={{ color: 'var(--color-primary)', fontSize: '1rem' }}>{trust.average.toFixed(1)}</strong>/100
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recent complaints */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Recent Complaints</h2>
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
                <th>Assigned To</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...complaints].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10).map((c) => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{c.complaintNumber}</td>
                  <td style={{ maxWidth: 180 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{c.title}</div>
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td><PriorityBadge priority={c.priority} /></td>
                  <td><TrustScoreBadge trustScore={c.trustScore} /></td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                    {c.assignedTo ? `${c.assignedTo.firstName} ${c.assignedTo.lastName}` : '—'}
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td>
                    <Link to={`/admin/main/complaints/${c.id}`} className="btn btn-ghost btn-sm">View <ChevronRight size={14} /></Link>
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
