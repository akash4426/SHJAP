import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { complaintsApi } from '../../api/client';
import { FileText, Search, Filter, ChevronRight, Plus } from 'lucide-react';
import { StatusBadge, PriorityBadge, PageLoading, EmptyState } from '../../components/shared';
import { Complaint, ComplaintStatus, ComplaintPriority } from '../../types';

export function MyComplaintsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['complaints', 'student', page, search, statusFilter, priorityFilter],
    queryFn: () => complaintsApi.list({
      page,
      limit: 15,
      search: search || undefined,
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
    }),
  });

  const complaints: Complaint[] = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;

  if (isLoading) return <PageLoading />;

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">My Complaints</h1>
          <p className="page-subtitle">View and track all your submitted grievances</p>
        </div>
        <Link to="/student/complaints/new" className="btn btn-primary">
          <Plus size={16} /> Lodge Complaint
        </Link>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '1rem 1.25rem' }}>
        <div className="search-wrapper" style={{ flex: '1 1 200px' }}>
          <Search size={16} className="search-icon" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input search-input"
            placeholder="Search complaints..."
          />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="form-select" style={{ minWidth: 160 }}>
          <option value="">All Statuses</option>
          {(['SUBMITTED','CATEGORIZED','ASSIGNED','UNDER_INVESTIGATION','INFORMATION_REQUESTED','ESCALATED','RESOLUTION_PROPOSED','RESOLVED','CLOSED','REJECTED'] as ComplaintStatus[]).map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }} className="form-select" style={{ minWidth: 140 }}>
          <option value="">All Priorities</option>
          {(['LOW','MEDIUM','HIGH','URGENT'] as ComplaintPriority[]).map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {complaints.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileText />}
            title="No complaints found"
            description={search || statusFilter ? 'Try adjusting your filters.' : 'You have not submitted any complaints yet.'}
            action={<Link to="/student/complaints/new" className="btn btn-primary btn-sm"><Plus size={14} /> Lodge First Complaint</Link>}
          />
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrapper" style={{ borderRadius: 'var(--radius-md)' }}>
            <table>
              <thead>
                <tr>
                  <th>Complaint #</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Mode</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {complaints.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{c.complaintNumber}</td>
                    <td style={{ fontWeight: 500, maxWidth: 220 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{c.category?.name ?? '—'}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td><PriorityBadge priority={c.priority} /></td>
                    <td>
                      <span className={`badge ${c.isAnonymous ? 'badge-purple' : 'badge-blue'}`} style={{ fontSize: '0.6875rem' }}>
                        {c.isAnonymous ? 'Anonymous' : 'Verified'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
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

          {/* Pagination */}
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
    </div>
  );
}
