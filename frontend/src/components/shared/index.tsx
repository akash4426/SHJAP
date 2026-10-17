import React from 'react';
import { ComplaintStatus, ComplaintPriority, TrustScore } from '../../types';

// ─── Status Badge ────────────────────────────────────────────
const statusConfig: Record<ComplaintStatus, { label: string; className: string }> = {
  SUBMITTED: { label: 'Submitted', className: 'badge-blue' },
  CATEGORIZED: { label: 'Categorized', className: 'badge-cyan' },
  ASSIGNED: { label: 'Assigned', className: 'badge-purple' },
  UNDER_INVESTIGATION: { label: 'Under Investigation', className: 'badge-yellow' },
  INFORMATION_REQUESTED: { label: 'Info Requested', className: 'badge-yellow' },
  ESCALATED: { label: 'Escalated', className: 'badge-red' },
  RESOLUTION_PROPOSED: { label: 'Resolution Proposed', className: 'badge-cyan' },
  RESOLVED: { label: 'Resolved', className: 'badge-green' },
  CLOSED: { label: 'Closed', className: 'badge-gray' },
  REJECTED: { label: 'Rejected', className: 'badge-red' },
};

export function StatusBadge({ status }: { status: ComplaintStatus }) {
  const cfg = statusConfig[status] ?? { label: status, className: 'badge-gray' };
  return <span className={`badge ${cfg.className}`}>{cfg.label}</span>;
}

// ─── Priority Badge ──────────────────────────────────────────
const priorityConfig: Record<ComplaintPriority, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'badge-green' },
  MEDIUM: { label: 'Medium', className: 'badge-blue' },
  HIGH: { label: 'High', className: 'badge-yellow' },
  URGENT: { label: 'Urgent', className: 'badge-red' },
};

export function PriorityBadge({ priority }: { priority: ComplaintPriority }) {
  const cfg = priorityConfig[priority] ?? { label: priority, className: 'badge-gray' };
  return <span className={`badge ${cfg.className}`}>{cfg.label}</span>;
}

// ─── Trust Score Badge ───────────────────────────────────────
export function TrustScoreBadge({ trustScore }: { trustScore?: TrustScore | null }) {
  if (!trustScore) return <span className="badge badge-gray">–</span>;

  const statusMap = {
    PENDING: { label: 'Pending', className: 'badge-gray' },
    LOW: { label: 'Low Trust', className: 'badge-red' },
    MEDIUM: { label: 'Medium Trust', className: 'badge-yellow' },
    HIGH: { label: 'High Trust', className: 'badge-green' },
  };

  const cfg = statusMap[trustScore.status] ?? statusMap.PENDING;
  return (
    <span className={`badge ${cfg.className}`}>
      {trustScore.score != null ? `${trustScore.score}/100` : ''} {cfg.label}
    </span>
  );
}

// ─── Loading Spinner ─────────────────────────────────────────
export function Spinner({ size = 20, color = 'var(--color-primary)' }: { size?: number; color?: string }) {
  return (
    <>
      <div style={{
        width: size, height: size,
        border: `2px solid ${color}33`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        display: 'inline-block',
        flexShrink: 0,
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ─── Page Loading ────────────────────────────────────────────
export function PageLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
      <Spinner size={32} />
    </div>
  );
}

// ─── Error Message ───────────────────────────────────────────
export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
      <span>⚠️</span> {message}
    </div>
  );
}

// ─── Star Rating Display ─────────────────────────────────────
export function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div style={{ display: 'flex', gap: '0.2rem' }}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} style={{ color: i < rating ? 'var(--color-warning)' : 'var(--color-border-light)', fontSize: '1rem' }}>
          ★
        </span>
      ))}
    </div>
  );
}

// ─── Confirmation Modal ──────────────────────────────────────
export function ConfirmModal({
  open, title, message, onConfirm, onCancel, danger = false, loading = false,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  loading?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>{message}</p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Spinner size={14} color="#fff" />}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────
export function EmptyState({ icon, title, description, action }: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-text" style={{ marginBottom: '1.5rem' }}>{description}</p>}
      {action}
    </div>
  );
}

// ─── Complaint Timeline ──────────────────────────────────────
const statusColors: Record<string, string> = {
  SUBMITTED: 'var(--color-primary)',
  CATEGORIZED: 'var(--color-info)',
  ASSIGNED: 'var(--color-accent)',
  UNDER_INVESTIGATION: 'var(--color-warning)',
  INFORMATION_REQUESTED: 'var(--color-warning)',
  ESCALATED: 'var(--color-danger)',
  RESOLUTION_PROPOSED: 'var(--color-info)',
  RESOLVED: 'var(--color-success)',
  CLOSED: 'var(--color-text-subtle)',
  REJECTED: 'var(--color-danger)',
};

export function ComplaintTimeline({ history }: { history: Array<{ newStatus: string; reason?: string; changedAt: string; changedBy?: { firstName?: string; lastName?: string } }> }) {
  return (
    <div className="timeline">
      {history.map((item, i) => (
        <div key={i} className="timeline-item">
          <div
            className="timeline-dot"
            style={{ background: statusColors[item.newStatus] ?? 'var(--color-border-light)' }}
          />
          <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <StatusBadge status={item.newStatus as ComplaintStatus} />
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {new Date(item.changedAt).toLocaleString()}
              </span>
            </div>
            {item.reason && <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.375rem' }}>{item.reason}</p>}
            {item.changedBy && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '0.25rem' }}>
                by {item.changedBy.firstName} {item.changedBy.lastName}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
