import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '../../api/client';
import { Search, Shield } from 'lucide-react';
import { PageLoading, EmptyState } from '../../components/shared';

const actionColors: Record<string, string> = {
  LOGIN: 'badge-blue',
  LOGOUT: 'badge-gray',
  REGISTRATION: 'badge-green',
  COMPLAINT_SUBMITTED: 'badge-cyan',
  COMPLAINT_ASSIGNED: 'badge-purple',
  STATUS_CHANGED: 'badge-yellow',
  EVIDENCE_UPLOADED: 'badge-blue',
  EVIDENCE_ACCESSED: 'badge-gray',
  COMPLAINT_RESOLVED: 'badge-green',
  COMPLAINT_ESCALATED: 'badge-red',
  USER_UPDATED: 'badge-yellow',
  ASSESSMENT_SAVED: 'badge-cyan',
};

export function AuditLogsPage() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, search, actionFilter],
    queryFn: () => auditApi.list({ page, limit: 20, search: search || undefined, action: actionFilter || undefined }),
  });

  const logs = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;

  if (isLoading) return <PageLoading />;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Audit Logs</h1>
        <p className="page-subtitle">Tamper-evident, chained audit trail of all system events</p>
      </div>

      {/* Security info */}
      <div className="alert alert-info" style={{ marginBottom: '1.5rem', fontSize: '0.8125rem' }}>
        <Shield size={16} style={{ flexShrink: 0 }} />
        <div>
          <strong>Tamper-Evident Audit System</strong><br />
          All logs are chained using SHA-256 hashes. Any modification to historical records is mathematically detectable.
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '1rem 1.25rem' }}>
        <div className="search-wrapper" style={{ flex: '1 1 200px' }}>
          <Search size={16} className="search-icon" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="form-input search-input" placeholder="Search logs..." />
        </div>
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} className="form-select" style={{ minWidth: 200 }}>
          <option value="">All Actions</option>
          {['LOGIN','LOGOUT','REGISTRATION','COMPLAINT_SUBMITTED','COMPLAINT_ASSIGNED','STATUS_CHANGED','EVIDENCE_UPLOADED','COMPLAINT_RESOLVED','COMPLAINT_ESCALATED','USER_UPDATED','ASSESSMENT_SAVED'].map(a => (
            <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Logs table */}
      {logs.length === 0 ? (
        <div className="card"><EmptyState icon={<Shield />} title="No audit logs" description="No events match your filters." /></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrapper" style={{ borderRadius: 'var(--radius-md)' }}>
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Role</th>
                  <th>Entity</th>
                  <th>IP</th>
                  <th>Hash</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedLog(log)}>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <span className={`badge ${actionColors[log.action] ?? 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>
                      {log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : <span style={{ color: 'var(--color-text-subtle)' }}>System</span>}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {log.actorRole?.replace(/_/g, ' ') ?? '—'}
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                      {log.entityType}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                      {log.ipAddress ?? '—'}
                    </td>
                    <td>
                      <span title={log.hash} style={{ fontSize: '0.6875rem', fontFamily: 'monospace', color: 'var(--color-text-subtle)' }}>
                        {log.hash?.slice(0, 12)}…
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setSelectedLog(log); }}>
                        Details
                      </button>
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

      {/* Log detail modal */}
      {selectedLog && (
        <div className="modal-overlay" onClick={() => setSelectedLog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-header">
              <h3 className="modal-title">Audit Log Details</h3>
              <button onClick={() => setSelectedLog(null)} className="btn-icon"><span>✕</span></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
              {[
                { label: 'Log ID', value: selectedLog.id, mono: true },
                { label: 'Action', value: selectedLog.action },
                { label: 'Timestamp', value: new Date(selectedLog.createdAt).toLocaleString() },
                { label: 'Actor', value: selectedLog.actor ? `${selectedLog.actor.firstName} ${selectedLog.actor.lastName}` : 'System' },
                { label: 'Actor Role', value: selectedLog.actorRole ?? '—' },
                { label: 'Entity Type', value: selectedLog.entityType },
                { label: 'Entity ID', value: selectedLog.entityId, mono: true },
                { label: 'IP Address', value: selectedLog.ipAddress ?? '—', mono: true },
                { label: 'SHA-256 Hash', value: selectedLog.hash, mono: true },
                { label: 'Previous Hash', value: selectedLog.previousHash ?? 'Genesis (First Log)', mono: true },
              ].map(({ label, value, mono }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                  <span style={{ fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? '0.8125rem' : '0.875rem', wordBreak: 'break-all', color: 'var(--color-text)' }}>{value}</span>
                </div>
              ))}
              {selectedLog.newValue && (
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>New Value</span>
                  <pre style={{ fontSize: '0.75rem', background: 'var(--color-surface-2)', padding: '0.5rem', borderRadius: 'var(--radius-sm)', marginTop: '0.25rem', overflow: 'auto' }}>
                    {JSON.stringify(selectedLog.newValue, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
