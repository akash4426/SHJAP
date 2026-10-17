import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { complaintsApi, analyticsApi } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { FileText, CheckCircle, AlertCircle, ArrowUpCircle, ChevronRight, BarChart3 } from 'lucide-react';
import { StatusBadge, PriorityBadge, PageLoading } from '../../components/shared';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Complaint } from '../../types';

const STATUS_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#64748b'];

export function CollegeAdminDashboard() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['complaints', 'college-admin'],
    queryFn: () => complaintsApi.list({ limit: 100 }),
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => analyticsApi.overview(),
  });

  const complaints: Complaint[] = data?.data?.data ?? [];
  const analytics = analyticsData?.data?.data;

  const stats = {
    total: complaints.length,
    escalated: complaints.filter(c => c.status === 'ESCALATED').length,
    resolved: complaints.filter(c => ['RESOLVED','CLOSED'].includes(c.status)).length,
    pending: complaints.filter(c => !['RESOLVED','CLOSED','REJECTED'].includes(c.status)).length,
  };

  const statusBreakdown = complaints.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.entries(statusBreakdown).map(([name, value]) => ({ name: name.replace(/_/g,' '), value }));

  const escalatedComplaints = complaints.filter(c => c.status === 'ESCALATED').slice(0, 5);

  if (isLoading) return <PageLoading />;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">College Dashboard</h1>
        <p className="page-subtitle">Oversight of all college-level grievances, {user?.firstName}</p>
      </div>

      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: '2rem' }}>
        {[
          { label: 'Total Complaints', value: stats.total, icon: <FileText size={20} />, color: 'var(--color-primary)' },
          { label: 'Pending Resolution', value: stats.pending, icon: <AlertCircle size={20} />, color: 'var(--color-warning)' },
          { label: 'Escalated', value: stats.escalated, icon: <ArrowUpCircle size={20} />, color: 'var(--color-danger)' },
          { label: 'Resolved', value: stats.resolved, icon: <CheckCircle size={20} />, color: 'var(--color-success)' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-icon" style={{ background: `${color}15` }}>{React.cloneElement(icon as React.ReactElement, { color })}</div>
            <div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        {/* Pie chart */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Complaints by Status</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, color: 'var(--color-text)' }} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Escalated complaints */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Escalated Complaints</h2>
            <span className="badge badge-red">{stats.escalated}</span>
          </div>
          {escalatedComplaints.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              No escalated complaints 🎉
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {escalatedComplaints.map(c => (
                <Link key={c.id} to={`/admin/college/complaints/${c.id}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', textDecoration: 'none', color: 'var(--color-text)' }}>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.125rem' }}>{c.title.length > 45 ? c.title.slice(0, 45) + '…' : c.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{c.complaintNumber}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <PriorityBadge priority={c.priority} />
                    <ChevronRight size={14} color="var(--color-text-muted)" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Resolution rate */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Performance Overview</h2>
        <div className="grid-3">
          {[
            { label: 'Resolution Rate', value: stats.total > 0 ? `${((stats.resolved / stats.total) * 100).toFixed(1)}%` : '0%', color: 'var(--color-success)' },
            { label: 'Escalation Rate', value: stats.total > 0 ? `${((stats.escalated / stats.total) * 100).toFixed(1)}%` : '0%', color: 'var(--color-danger)' },
            { label: 'Active Cases', value: stats.pending.toString(), color: 'var(--color-warning)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ textAlign: 'center', padding: '1rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius)' }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color, marginBottom: '0.25rem' }}>{value}</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
