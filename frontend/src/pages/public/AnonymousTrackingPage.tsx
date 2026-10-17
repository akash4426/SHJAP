import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { anonymousApi } from '../../api/client';
import toast from 'react-hot-toast';
import { Search, Shield } from 'lucide-react';
import { StatusBadge, ComplaintTimeline, Spinner } from '../../components/shared';
import { Complaint } from '../../types';

export function AnonymousTrackingPage() {
  const [trackingId, setTrackingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [complaint, setComplaint] = useState<Partial<Complaint> | null>(null);

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingId.trim()) return;
    setLoading(true);
    try {
      const res = await anonymousApi.track(trackingId.trim());
      setComplaint(res.data.data);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? 'Complaint not found. Check your tracking ID.';
      toast.error(msg);
      setComplaint(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '3rem 1.5rem' }}>
      <div style={{ width: '100%', maxWidth: 600 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            ← Back to Home
          </Link>
          <div style={{ width: 52, height: 52, background: 'linear-gradient(135deg, var(--color-accent), var(--color-primary))', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', boxShadow: 'var(--shadow-glow)' }}>
            <Search size={24} color="#fff" />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>Track Your Complaint</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            Enter your anonymous tracking ID to view the current status of your complaint.
          </p>
        </div>

        {/* Search form */}
        <form onSubmit={handleTrack} className="card" style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div className="search-wrapper" style={{ flex: 1 }}>
            <Search size={16} className="search-icon" />
            <input
              type="text"
              value={trackingId}
              onChange={(e) => setTrackingId(e.target.value)}
              className="form-input search-input"
              placeholder="e.g. TRK-A1B2C3D4E5F6G7H8"
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <Spinner size={16} color="#fff" /> : <Search size={16} />}
            {loading ? 'Searching...' : 'Track'}
          </button>
        </form>

        {/* Anonymity notice */}
        <div className="alert alert-info" style={{ marginBottom: '1.5rem', fontSize: '0.8125rem' }}>
          <Shield size={16} style={{ flexShrink: 0 }} />
          <div>
            <strong>Anonymity Protected</strong><br />
            Your identity is not linked to this complaint. Only use the tracking ID to follow progress.
          </div>
        </div>

        {/* Results */}
        {complaint && (
          <div className="card fade-in">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.25rem' }}>{complaint.title}</h2>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span className="badge badge-gray" style={{ fontFamily: 'monospace' }}>{complaint.complaintNumber}</span>
                  {complaint.status && <StatusBadge status={complaint.status} />}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                <div>Submitted: {new Date(complaint.createdAt!).toLocaleDateString()}</div>
                {complaint.resolvedAt && <div style={{ color: 'var(--color-success)' }}>Resolved: {new Date(complaint.resolvedAt).toLocaleDateString()}</div>}
              </div>
            </div>

            {complaint.category && (
              <div style={{ marginBottom: '1.25rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Category: </span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{complaint.category.name}</span>
              </div>
            )}

            <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '1rem' }}>Status Timeline</h3>
            {complaint.statusHistory && complaint.statusHistory.length > 0 ? (
              <ComplaintTimeline history={complaint.statusHistory.map(h => ({
                newStatus: h.newStatus,
                reason: h.reason,
                changedAt: h.changedAt,
              }))} />
            ) : (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No status history available.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
