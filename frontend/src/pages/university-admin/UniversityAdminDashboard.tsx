import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { complaintsApi, analyticsApi } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { FileText, CheckCircle, AlertCircle, ArrowUpCircle, ChevronRight, BarChart3, TrendingUp } from 'lucide-react';
import { StatusBadge, PriorityBadge, PageLoading } from '../../components/shared';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Complaint } from '../../types';

const COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4'];

export function UniversityAdminDashboard() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['complaints', 'university-admin'],
    queryFn: () => complaintsApi.list({ limit: 100 }),
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => analyticsApi.overview(),
  });

  const { data: deptAnalytics } = useQuery({
    queryKey: ['analytics', 'departments'],
    queryFn: () => analyticsApi.departments(),
  });

  const complaints: Complaint[] = data?.data?.data ?? [];
  const deptData: any[] = deptAnalytics?.data?.data ?? [];

  const stats = {
    total: complaints.length,
    escalated: complaints.filter(c => c.status === 'ESCALATED').length,
    resolved: complaints.filter(c => ['RESOLVED','CLOSED'].includes(c.status)).length,
    pending: complaints.filter(c => !['RESOLVED','CLOSED','REJECTED'].includes(c.status)).length,
    urgent: complaints.filter(c => c.priority === 'URGENT' && !['RESOLVED','CLOSED'].includes(c.status)).length,
    anonymous: complaints.filter(c => c.isAnonymous).length,
  };

  const statusBreakdown = complaints.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.entries(statusBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name: name.replace(/_/g,' '), value }));

  if (isLoading) return <PageLoading />;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">University Dashboard</h1>
        <p className="page-subtitle">University-wide grievance management overview, {user?.firstName}</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Total Complaints', value: stats.total, icon: <FileText size={20} />, color: 'var(--color-primary)' },
          { label: 'Pending', value: stats.pending, icon: <AlertCircle size={20} />, color: 'var(--color-warning)' },
          { label: 'Escalated to University', value: stats.escalated, icon: <ArrowUpCircle size={20} />, color: 'var(--color-danger)' },
          { label: 'Resolved', value: stats.resolved, icon: <CheckCircle size={20} />, color: 'var(--color-success)' },
          { label: 'Urgent Cases', value: stats.urgent, icon: <TrendingUp size={20} />, color: 'var(--color-danger)' },
          { label: 'Anonymous Submissions', value: stats.anonymous, icon: <FileText size={20} />, color: 'var(--color-accent)' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-icon" style={{ background: `${color}15` }}>{React.cloneElement(icon as React.ReactElement, { color })}</div>
            <div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        {/* By Department bar chart */}
        {deptData.length > 0 && (
          <div className="card">
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Complaints by Department</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={deptData.slice(0, 6)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="department" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }} />
                <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Status pie */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Status Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Key metrics */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Key Performance Indicators</h2>
        <div className="grid-3">
          {[
            { label: 'Resolution Rate', value: stats.total > 0 ? `${((stats.resolved / stats.total) * 100).toFixed(1)}%` : '0%', desc: 'Complaints successfully resolved', color: 'var(--color-success)' },
            { label: 'Escalation Rate', value: stats.total > 0 ? `${((stats.escalated / stats.total) * 100).toFixed(1)}%` : '0%', desc: 'Cases requiring university-level review', color: 'var(--color-danger)' },
            { label: 'Anonymous Rate', value: stats.total > 0 ? `${((stats.anonymous / stats.total) * 100).toFixed(1)}%` : '0%', desc: 'Submitted anonymously for privacy', color: 'var(--color-accent)' },
          ].map(({ label, value, desc, color }) => (
            <div key={label} style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', padding: '1.25rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 800, color, marginBottom: '0.25rem' }}>{value}</div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem', fontSize: '0.875rem' }}>{label}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
