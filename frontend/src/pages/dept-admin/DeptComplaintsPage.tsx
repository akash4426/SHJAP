import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { complaintsApi, adminApi } from '../../api/client';
import { Search, ChevronRight, UserCheck, Users } from 'lucide-react';
import { StatusBadge, PriorityBadge, TrustScoreBadge, PageLoading, EmptyState } from '../../components/shared';
import { Complaint } from '../../types';
import toast from 'react-hot-toast';
import { Spinner } from '../../components/shared';
import { FileText } from 'lucide-react';

export function DeptComplaintsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [assignModal, setAssignModal] = useState<{ complaintId: string; currentAssignee?: string } | null>(null);
  const [selectedAdmin, setSelectedAdmin] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['complaints', 'dept', page, search, statusFilter, priorityFilter],
    queryFn: () => complaintsApi.list({ page, limit: 15, search: search || undefined, status: statusFilter || undefined, priority: priorityFilter || undefined }),
    refetchInterval: 20_000,
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin-users', 'dept'],
    queryFn: () => adminApi.listUsers({ role: 'DEPARTMENT_ADMIN', limit: 50 }),
    enabled: !!assignModal,
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, adminId }: { id: string; adminId: string }) => complaintsApi.assign(id, { assignedToId: adminId }),
    onSuccess: () => {
      toast.success('Complaint assigned');
      setAssignModal(null);
      queryClient.invalidateQueries({ queryKey: ['complaints', 'dept'] });
    },
    onError: () => toast.error('Failed to assign'),
  });

  const complaints: Complaint[] = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;
  const admins = usersData?.data?.data ?? [];

  if (isLoading) return <PageLoading />;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Department Complaints</h1>
        <p className="page-subtitle">Review and manage all complaints assigned to your department</p>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '1rem 1.25rem' }}>
        <div className="search-wrapper" style={{ flex: '1 1 200px' }}>
          <Search size={16} className="search-icon" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="form-input search-input" placeholder="Search complaints..." />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="form-select" style={{ minWidth: 160 }}>
          <option value="">All Statuses</option>
          {['SUBMITTED','CATEGORIZED','ASSIGNED','UNDER_INVESTIGATION','INFORMATION_REQUESTED','ESCALATED','RESOLUTION_PROPOSED','RESOLVED','CLOSED','REJECTED'].map(s => (
            <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }} className="form-select" style={{ minWidth: 140 }}>
          <option value="">All Priorities</option>
          {['LOW','MEDIUM','HIGH','URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {complaints.length === 0 ? (
        <div className="card"><EmptyState icon={<FileText />} title="No complaints" description="No complaints match your filters." /></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrapper" style={{ borderRadius: 'var(--radius-md)' }}>
            <table>
              <thead>
                <tr>
                  <th>Complaint #</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Trust</th>
                  <th>Assigned To</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {complaints.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{c.complaintNumber}</td>
                    <td style={{ maxWidth: 180 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{c.title}</div>
                    </td>
                    <td><StatusBadge status={c.status} /></td>
                    <td><PriorityBadge priority={c.priority} /></td>
                    <td><TrustScoreBadge trustScore={c.trustScore} /></td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                      {c.assignedTo ? `${c.assignedTo.firstName} ${c.assignedTo.lastName}` : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ color: 'var(--color-warning)', fontSize: '0.75rem' }}>Unassigned</span>
                          <button onClick={() => setAssignModal({ complaintId: c.id })} className="btn btn-ghost btn-sm" style={{ color: 'var(--color-primary)' }}>
                            <UserCheck size={14} /> Assign
                          </button>
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td style={{ display: 'flex', gap: '0.375rem' }}>
                      <Link to={`/admin/dept/complaints/${c.id}`} className="btn btn-ghost btn-sm">View</Link>
                      <Link to={`/admin/dept/complaints/${c.id}/investigate`} className="btn btn-ghost btn-sm">Investigate</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="pagination" style={{ padding: '1rem' }}>
              <button className="page-btn" disabled={!pagination.hasPrev} onClick={() => setPage(p => p - 1)}>←</button>
              {Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="page-btn" disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)}>→</button>
            </div>
          )}
        </div>
      )}

      {/* Assign modal */}
      {assignModal && (
        <div className="modal-overlay" onClick={() => setAssignModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Assign Complaint</h3>
              <button onClick={() => setAssignModal(null)} className="btn-icon"><span>✕</span></button>
            </div>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label">Select Administrator</label>
              <select value={selectedAdmin} onChange={(e) => setSelectedAdmin(e.target.value)} className="form-select">
                <option value="">Choose an administrator...</option>
                {admins.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.firstName} {a.lastName} — {a.adminProfile?.designation ?? 'Admin'}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setAssignModal(null)} className="btn btn-secondary btn-sm">Cancel</button>
              <button
                onClick={() => selectedAdmin && assignMutation.mutate({ id: assignModal.complaintId, adminId: selectedAdmin })}
                disabled={!selectedAdmin || assignMutation.isPending}
                className="btn btn-primary btn-sm"
              >
                {assignMutation.isPending ? <Spinner size={14} color="#fff" /> : <UserCheck size={14} />}
                Assign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
