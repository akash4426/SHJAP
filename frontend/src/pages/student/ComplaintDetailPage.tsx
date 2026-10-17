import React, { useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { complaintsApi, evidenceApi } from '../../api/client';
import toast from 'react-hot-toast';
import type { Complaint, StatusHistory } from '../../types';
import {
  ArrowLeft, MessageSquare, FileText, Upload, Star, Send, ChevronDown, ChevronUp,
  Download, Shield, AlertTriangle, Trash2
} from 'lucide-react';
import {
  StatusBadge, PriorityBadge, TrustScoreBadge, ComplaintTimeline,
  StarRating, Spinner, PageLoading
} from '../../components/shared';
import { useAuth } from '../../contexts/AuthContext';

export function ComplaintDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [messageText, setMessageText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [showTimeline, setShowTimeline] = useState(true);
  const [activeTab, setActiveTab] = useState<'details' | 'messages' | 'evidence' | 'feedback'>('details');

  const { data, isLoading } = useQuery({
    queryKey: ['complaint', id],
    queryFn: () => complaintsApi.getById(id!),
    enabled: !!id,
  });

  const { data: messagesData } = useQuery({
    queryKey: ['complaint-messages', id],
    queryFn: () => complaintsApi.getMessages(id!),
    enabled: !!id,
    refetchInterval: 10000,
  });

  const complaint = data?.data?.data as Complaint | undefined;
  const messages = messagesData?.data?.data ?? [];

  const sendMessageMutation = useMutation({
    mutationFn: (msg: string) => complaintsApi.sendMessage(id!, {
      recipientId: complaint?.assignedTo?.id ?? '',
      message: msg,
    }),
    onSuccess: () => {
      setMessageText('');
      queryClient.invalidateQueries({ queryKey: ['complaint-messages', id] });
      toast.success('Message sent');
    },
    onError: () => toast.error('Failed to send message'),
  });

  const feedbackMutation = useMutation({
    mutationFn: () => complaintsApi.submitFeedback(id!, { rating: feedbackRating, comment: feedbackComment }),
    onSuccess: () => {
      toast.success('Feedback submitted. Thank you!');
      queryClient.invalidateQueries({ queryKey: ['complaint', id] });
    },
    onError: () => toast.error('Failed to submit feedback'),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadEvidenceMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return evidenceApi.upload(id!, fd);
    },
    onSuccess: () => {
      toast.success('Evidence uploaded');
      queryClient.invalidateQueries({ queryKey: ['complaint', id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Upload failed'),
  });

  const downloadEvidence = async (evidenceId: string, fileName: string) => {
    try {
      await evidenceApi.download(id!, evidenceId, fileName);
    } catch {
      toast.error('Download failed');
    }
  };

  const evidenceDeleteMutation = useMutation({
    mutationFn: (evidenceId: string) => evidenceApi.delete(id!, evidenceId),
    onSuccess: () => {
      toast.success('Evidence removed');
      queryClient.invalidateQueries({ queryKey: ['complaint', id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Failed to delete evidence'),
  });

  if (isLoading) return <PageLoading />;
  if (!complaint) return <div className="card"><p style={{ color: 'var(--color-text-muted)' }}>Complaint not found.</p></div>;

  const canFeedback = ['RESOLVED', 'CLOSED'].includes(complaint.status) && !complaint.feedback;
  const canMessage = complaint.assignedTo && !complaint.isAnonymous;
  const canAddEvidence = !complaint.isAnonymous && !['RESOLVED', 'CLOSED', 'REJECTED'].includes(complaint.status);

  const tabs = [
    { key: 'details', label: 'Details' },
    { key: 'messages', label: `Messages${messages.length > 0 ? ` (${messages.length})` : ''}`, disabled: complaint.isAnonymous || !complaint.assignedTo },
    { key: 'evidence', label: `Evidence${(complaint.evidence?.length ?? 0) > 0 ? ` (${complaint.evidence?.length})` : ''}` },
    { key: 'feedback', label: 'Feedback', disabled: !canFeedback && !complaint.feedback },
  ];

  return (
    <div className="fade-in">
      {/* Back */}
      <Link to="/student/complaints" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
        <ArrowLeft size={16} /> Back to complaints
      </Link>

      {/* Header */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <StatusBadge status={complaint.status} />
              <PriorityBadge priority={complaint.priority} />
              <span className={`badge ${complaint.isAnonymous ? 'badge-purple' : 'badge-blue'}`} style={{ fontSize: '0.6875rem' }}>
                {complaint.isAnonymous ? '🔒 Anonymous' : '✓ Verified'}
              </span>
            </div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>{complaint.title}</h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
              {complaint.complaintNumber} · Submitted {new Date(complaint.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
            {complaint.trustScore && <TrustScoreBadge trustScore={complaint.trustScore} />}
            {complaint.department && (
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Dept: {complaint.department.name}</span>
            )}
          </div>
        </div>

        {/* Anonymous tracking ID */}
        {complaint.isAnonymous && (
          <div className="alert alert-warning" style={{ fontSize: '0.8125rem', marginBottom: '0' }}>
            <Shield size={16} style={{ flexShrink: 0 }} />
            <div>
              <strong>Anonymous Complaint</strong> — Tracking ID: <span style={{ fontFamily: 'monospace' }}>{complaint.trackingId}</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem' }} className="detail-grid">
        {/* Main content */}
        <div>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: '1.5rem', gap: '0.25rem', overflowX: 'auto' }}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => !tab.disabled && setActiveTab(tab.key as any)}
                disabled={tab.disabled}
                style={{
                  padding: '0.625rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  border: 'none',
                  background: 'none',
                  cursor: tab.disabled ? 'not-allowed' : 'pointer',
                  color: activeTab === tab.key ? 'var(--color-primary)' : tab.disabled ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
                  borderBottom: `2px solid ${activeTab === tab.key ? 'var(--color-primary)' : 'transparent'}`,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Details tab */}
          {activeTab === 'details' && (
            <div className="fade-in">
              <div className="card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.875rem' }}>Description</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{complaint.description}</p>
                {complaint.additionalInfo && (
                  <>
                    <div className="divider" />
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>Additional Info</h4>
                    <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.7 }}>{complaint.additionalInfo}</p>
                  </>
                )}
              </div>

              {/* Resolution */}
              {complaint.resolution && (
                <div className="card" style={{ marginBottom: '1rem', border: '1px solid rgba(16,185,129,0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)' }} />
                    <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-success)' }}>Resolution</h3>
                  </div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>{complaint.resolution.summary}</p>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.7, marginBottom: '0.75rem' }}>{complaint.resolution.detailedResolution}</p>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                    <strong>Action taken:</strong> {complaint.resolution.actionTaken}
                  </div>
                  {complaint.resolution.resolvedBy && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '0.5rem' }}>
                      Resolved by {complaint.resolution.resolvedBy.firstName} {complaint.resolution.resolvedBy.lastName}
                    </div>
                  )}
                </div>
              )}

              {/* Assessments */}
              {complaint.assessments && complaint.assessments.length > 0 && (
                <div className="card">
                  <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.875rem' }}>Investigation Notes</h3>
                  {complaint.assessments.map((a) => (
                    <div key={a.id}>
                      {a.investigationNotes && <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.7 }}>{a.investigationNotes}</p>}
                      {a.isInformationRequested && (
                        <div className="alert alert-warning" style={{ marginTop: '0.75rem', fontSize: '0.8125rem' }}>
                          <AlertTriangle size={16} />
                          <div><strong>Additional info requested:</strong> {a.informationRequested}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages tab */}
          {activeTab === 'messages' && (
            <div className="fade-in">
              <div className="card" style={{ marginBottom: '1rem', maxHeight: 400, overflow: 'auto' }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                    <MessageSquare size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.3 }} />
                    <p style={{ fontSize: '0.875rem' }}>No messages yet. Start the conversation.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {messages.map((m: any) => {
                      const isOwn = m.senderId === user?.id;
                      return (
                        <div key={m.id} style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
                          <div style={{
                            maxWidth: '75%',
                            background: isOwn ? 'var(--color-primary)' : 'var(--color-surface-2)',
                            color: isOwn ? '#fff' : 'var(--color-text)',
                            borderRadius: isOwn ? 'var(--radius-md) var(--radius-md) 0 var(--radius-md)' : 'var(--radius-md) var(--radius-md) var(--radius-md) 0',
                            padding: '0.625rem 0.875rem',
                            fontSize: '0.875rem',
                          }}>
                            <div style={{ fontSize: '0.6875rem', opacity: 0.7, marginBottom: '0.25rem' }}>
                              {m.sender?.firstName} {m.sender?.lastName}
                            </div>
                            {m.message}
                            <div style={{ fontSize: '0.6875rem', opacity: 0.6, marginTop: '0.25rem', textAlign: 'right' }}>
                              {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {canMessage && (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    className="form-textarea"
                    placeholder="Type your message..."
                    rows={2}
                    style={{ flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && messageText.trim()) {
                        e.preventDefault();
                        sendMessageMutation.mutate(messageText);
                      }
                    }}
                  />
                  <button
                    onClick={() => messageText.trim() && sendMessageMutation.mutate(messageText)}
                    disabled={!messageText.trim() || sendMessageMutation.isPending}
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-end' }}
                  >
                    {sendMessageMutation.isPending ? <Spinner size={16} color="#fff" /> : <Send size={16} />}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Evidence tab */}
          {activeTab === 'evidence' && (
            <div className="fade-in">
              {(!complaint.evidence || complaint.evidence.length === 0) ? (
                <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                  <FileText size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.3 }} />
                  <p style={{ fontSize: '0.875rem' }}>No evidence attached to this complaint.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {complaint.evidence.map((ev) => (
                    <div key={ev.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1rem' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: 'var(--color-primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <FileText size={18} color="var(--color-primary)" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.originalName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {ev.type} · {(ev.fileSize / 1024).toFixed(1)}KB · {new Date(ev.createdAt).toLocaleDateString()}
                          {ev.isVerified && <span style={{ color: 'var(--color-success)', marginLeft: '0.5rem' }}>✓ Verified</span>}
                        </div>
                      </div>
                      <button onClick={() => downloadEvidence(ev.id, ev.originalName)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }} title="Download">
                        <Download size={14} />
                      </button>
                      {ev.uploadedBy?.id === user?.id && (
                        <button
                          onClick={() => { if (window.confirm('Delete this evidence?')) evidenceDeleteMutation.mutate(ev.id); }}
                          className="btn btn-outline"
                          style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem', color: 'var(--color-danger)' }}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {canAddEvidence && (
                <div className="card" style={{ marginTop: '0.75rem' }}>
                  <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.5rem' }}>Attach Additional Evidence</h3>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.875rem' }}>
                    Images (JPEG/PNG/WebP/GIF), PDFs, and common documents up to 10 MB.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadEvidenceMutation.mutate(f); }}
                    className="form-input"
                    style={{ fontSize: '0.8125rem' }}
                  />
                  {uploadEvidenceMutation.isPending && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                      <Spinner size={14} /> Uploading...
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Feedback tab */}
          {activeTab === 'feedback' && (
            <div className="fade-in">
              {complaint.feedback ? (
                <div className="card">
                  <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.875rem' }}>Your Feedback</h3>
                  <StarRating rating={complaint.feedback.rating} />
                  {complaint.feedback.comment && (
                    <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.75rem', lineHeight: 1.7 }}>{complaint.feedback.comment}</p>
                  )}
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '0.75rem' }}>
                    Submitted {new Date(complaint.feedback.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ) : canFeedback ? (
                <div className="card">
                  <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.5rem' }}>Rate Your Experience</h3>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>How satisfied are you with how your complaint was handled?</p>
                  <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '1.25rem' }}>
                    {[1,2,3,4,5].map((star) => (
                      <button key={star} type="button" onClick={() => setFeedbackRating(star)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '2rem', color: star <= feedbackRating ? 'var(--color-warning)' : 'var(--color-border-light)', transition: 'color 0.15s, transform 0.15s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.2)')}
                        onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                      >★</button>
                    ))}
                  </div>
                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="form-label">Comment (Optional)</label>
                    <textarea value={feedbackComment} onChange={(e) => setFeedbackComment(e.target.value)} className="form-textarea" rows={3} placeholder="Share your experience..." />
                  </div>
                  <button onClick={() => feedbackRating > 0 && feedbackMutation.mutate()} disabled={feedbackRating === 0 || feedbackMutation.isPending} className="btn btn-primary">
                    {feedbackMutation.isPending ? <Spinner size={16} color="#fff" /> : <Star size={16} />}
                    Submit Feedback
                  </button>
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                  <Star size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.3 }} />
                  <p style={{ fontSize: '0.875rem' }}>Feedback is available once your complaint is resolved.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Info */}
          <div className="card">
            <h3 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Complaint Info</h3>
            {[
              { label: 'Number', value: complaint.complaintNumber, mono: true },
              { label: 'Category', value: complaint.category?.name ?? 'Uncategorized' },
              { label: 'Department', value: complaint.department?.name ?? 'Unassigned' },
              { label: 'Assigned To', value: complaint.assignedTo ? `${complaint.assignedTo.firstName} ${complaint.assignedTo.lastName}` : 'Unassigned' },
              { label: 'Submitted', value: new Date(complaint.createdAt).toLocaleDateString() },
              { label: 'Last Updated', value: new Date(complaint.updatedAt).toLocaleDateString() },
              ...(complaint.resolvedAt ? [{ label: 'Resolved', value: new Date(complaint.resolvedAt).toLocaleDateString() }] : []),
            ].map(({ label, value, mono }) => (
              <div key={label} style={{ marginBottom: '0.625rem' }}>
                <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginBottom: '0.125rem' }}>{label}</div>
                <div style={{ fontSize: '0.8125rem', fontFamily: mono ? 'monospace' : 'inherit', fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <div className="card">
            <button onClick={() => setShowTimeline(!showTimeline)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)', fontSize: '0.875rem', fontWeight: 600, marginBottom: showTimeline ? '1rem' : 0 }}>
              Status Timeline {showTimeline ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showTimeline && complaint.statusHistory && (
              <ComplaintTimeline history={complaint.statusHistory.map((h: StatusHistory) => ({
                newStatus: h.newStatus,
                reason: h.reason,
                changedAt: h.changedAt,
                changedBy: h.changedBy,
              }))} />
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}
