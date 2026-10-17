import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { complaintsApi, evidenceApi } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  ArrowLeft, MessageSquare, FileText, Send, CheckCircle,
  ArrowUpCircle, ClipboardList, AlertTriangle, Download, Trash2, ShieldCheck, Gavel
} from 'lucide-react';
import { StatusBadge, PriorityBadge, TrustScoreBadge, ComplaintTimeline, Spinner, PageLoading } from '../../components/shared';

export function AdminComplaintDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, primaryRole } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'details' | 'messages' | 'evidence' | 'assess' | 'escalate' | 'resolve' | 'review'>('details');
  const [messageText, setMessageText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['complaint', id],
    queryFn: () => complaintsApi.getById(id!),
    enabled: !!id,
  });

  const { data: msgsData } = useQuery({
    queryKey: ['complaint-messages', id],
    queryFn: () => complaintsApi.getMessages(id!),
    enabled: !!id,
  });

  const complaint = data?.data?.data;
  const messages = msgsData?.data?.data ?? [];

  const assessForm = useForm({ defaultValues: {
    investigationNotes: '', evidenceAssessment: '', findings: '',
    recommendedAction: '', resolutionDecision: '',
    isInformationRequested: false, informationRequested: '',
  }});

  const escalateForm = useForm({ defaultValues: { reason: '', notes: '' } });

  const resolveForm = useForm({ defaultValues: { summary: '', detailedResolution: '', actionTaken: '' } });

  const assessMutation = useMutation({
    mutationFn: (data: object) => complaintsApi.assess(id!, data),
    onSuccess: () => { toast.success('Assessment saved'); queryClient.invalidateQueries({ queryKey: ['complaint', id] }); },
    onError: () => toast.error('Failed to save assessment'),
  });

  const escalateMutation = useMutation({
    mutationFn: (data: object) => complaintsApi.escalate(id!, data),
    onSuccess: () => { toast.success('Complaint escalated'); queryClient.invalidateQueries({ queryKey: ['complaint', id] }); setActiveTab('details'); },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Failed to escalate'),
  });

  const resolveMutation = useMutation({
    mutationFn: (data: object) => complaintsApi.resolve(id!, data),
    onSuccess: () => { toast.success('Complaint resolved'); queryClient.invalidateQueries({ queryKey: ['complaint', id] }); setActiveTab('details'); },
    onError: () => toast.error('Failed to resolve complaint'),
  });

  const sendMessageMutation = useMutation({
    mutationFn: (msg: string) => complaintsApi.sendMessage(id!, {
      recipientId: complaint?.submittedBy?.id ?? '',
      message: msg,
    }),
    onSuccess: () => { setMessageText(''); queryClient.invalidateQueries({ queryKey: ['complaint-messages', id] }); toast.success('Message sent'); },
    onError: () => toast.error('Failed to send message'),
  });

  const verifyEvidenceMutation = useMutation({
    mutationFn: (evidenceId: string) => evidenceApi.verify(id!, evidenceId),
    onSuccess: () => { toast.success('Evidence verified'); queryClient.invalidateQueries({ queryKey: ['complaint', id] }); },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Failed to verify evidence'),
  });

  const deleteEvidenceMutation = useMutation({
    mutationFn: (evidenceId: string) => evidenceApi.delete(id!, evidenceId),
    onSuccess: () => { toast.success('Evidence removed'); queryClient.invalidateQueries({ queryKey: ['complaint', id] }); },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Failed to delete evidence'),
  });

  const downloadEvidence = async (evidenceId: string, fileName: string) => {
    try {
      await evidenceApi.download(id!, evidenceId, fileName);
    } catch {
      toast.error('Download failed');
    }
  };

  const reviewForm = useForm({
    defaultValues: { decision: 'APPROVE' as 'APPROVE' | 'REJECT', reviewNotes: '' },
  });

  const reviewMutation = useMutation({
    mutationFn: (data: { decision: 'APPROVE' | 'REJECT'; reviewNotes?: string }) =>
      complaintsApi.review(id!, data),
    onSuccess: () => { toast.success('Escalation reviewed'); queryClient.invalidateQueries({ queryKey: ['complaint', id] }); setActiveTab('details'); },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? 'Review failed'),
  });

  if (isLoading) return <PageLoading />;
  if (!complaint) return <div className="card"><p style={{ color: 'var(--color-text-muted)' }}>Complaint not found.</p></div>;

  const isDeptAdmin = primaryRole === 'DEPARTMENT_ADMIN';
  const isCollegeAdmin = primaryRole === 'COLLEGE_ADMIN';
  const isUniversityAdmin = primaryRole === 'UNIVERSITY_ADMIN';

  const basePath = isDeptAdmin ? '/admin/dept' : isCollegeAdmin ? '/admin/college' : isUniversityAdmin ? '/admin/university' : '/admin/main';

  const tabs = [
    { key: 'details', label: 'Details' },
    { key: 'messages', label: `Messages (${messages.length})`, disabled: complaint.isAnonymous },
    { key: 'evidence', label: `Evidence (${complaint.evidence?.length ?? 0})` },
    ...(isDeptAdmin ? [
      { key: 'assess', label: 'Assess' },
      { key: 'escalate', label: 'Escalate', disabled: complaint.status === 'ESCALATED' || complaint.status === 'RESOLVED' || complaint.status === 'CLOSED' },
      { key: 'resolve', label: 'Resolve', disabled: complaint.status === 'RESOLVED' || complaint.status === 'CLOSED' },
    ] : isCollegeAdmin || isUniversityAdmin ? [
      { key: 'resolve', label: 'Resolve', disabled: complaint.status === 'RESOLVED' || complaint.status === 'CLOSED' },
      { key: 'escalate', label: 'Escalate', disabled: complaint.status === 'RESOLVED' || complaint.status === 'CLOSED'},
    ] : []),
    ...(isCollegeAdmin && complaint.status === 'ESCALATED' ? [{ key: 'review', label: 'Review Escalation' }] : []),
  ];

  return (
    <div className="fade-in">
      <Link to={`${basePath}/complaints`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
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
              {complaint.complaintNumber} · {new Date(complaint.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
            <TrustScoreBadge trustScore={complaint.trustScore} />
            {complaint.submittedBy && !complaint.isAnonymous && (
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                By: {complaint.submittedBy.firstName} {complaint.submittedBy.lastName}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1.5rem' }} className="detail-grid">
        <div>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: '1.5rem', gap: '0.25rem', overflowX: 'auto' }}>
            {tabs.map((tab) => (
              <button key={tab.key} onClick={() => !(tab as any).disabled && setActiveTab(tab.key as any)}
                disabled={(tab as any).disabled}
                style={{
                  padding: '0.625rem 1rem', fontSize: '0.875rem', fontWeight: 500,
                  border: 'none', background: 'none',
                  cursor: (tab as any).disabled ? 'not-allowed' : 'pointer',
                  color: activeTab === tab.key ? 'var(--color-primary)' : (tab as any).disabled ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
                  borderBottom: `2px solid ${activeTab === tab.key ? 'var(--color-primary)' : 'transparent'}`,
                  whiteSpace: 'nowrap', transition: 'all 0.2s',
                }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Details */}
          {activeTab === 'details' && (
            <div className="fade-in">
              <div className="card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.875rem' }}>Description</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{complaint.description}</p>
                {complaint.additionalInfo && (
                  <>
                    <div className="divider" />
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>Additional Information</h4>
                    <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.7 }}>{complaint.additionalInfo}</p>
                  </>
                )}
                {complaint.location && (
                  <>
                    <div className="divider" />
                    <div style={{ fontSize: '0.8125rem' }}><strong>Location:</strong> {complaint.location}</div>
                  </>
                )}
              </div>

              {/* Trust Score breakdown */}
              {complaint.trustScore && complaint.trustScore.score != null && (
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.875rem' }}>Trust Score Breakdown</h3>
                  <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)' }}>{complaint.trustScore.score}</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>/ 100 — <TrustScoreBadge trustScore={complaint.trustScore} /></div>
                  </div>
                  {[
                    { label: 'Evidence Integrity', value: complaint.trustScore.evidenceIntegrity, max: 25 },
                    { label: 'Evidence Completeness', value: complaint.trustScore.evidenceCompleteness, max: 25 },
                    { label: 'History Consistency', value: complaint.trustScore.historyConsistency, max: 25 },
                    { label: 'Process Transparency', value: complaint.trustScore.processTransparency, max: 25 },
                  ].map(({ label, value, max }) => (
                    <div key={label} style={{ marginBottom: '0.625rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
                        <span style={{ fontWeight: 500 }}>{value ?? 0}/{max}</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--color-surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${((value ?? 0) / max) * 100}%`, background: 'var(--color-primary)', borderRadius: 3, transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Resolution if exists */}
              {complaint.resolution && (
                <div className="card" style={{ border: '1px solid rgba(16,185,129,0.3)' }}>
                  <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-success)', marginBottom: '0.875rem' }}>✓ Resolution</h3>
                  <p style={{ fontWeight: 500, marginBottom: '0.5rem' }}>{complaint.resolution.summary}</p>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem', lineHeight: 1.7 }}>{complaint.resolution.detailedResolution}</p>
                  <div style={{ fontSize: '0.8125rem' }}><strong>Action taken:</strong> {complaint.resolution.actionTaken}</div>
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          {activeTab === 'messages' && (
            <div className="fade-in">
              <div className="card" style={{ marginBottom: '1rem', maxHeight: 450, overflow: 'auto' }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                    <MessageSquare size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.3 }} />
                    <p style={{ fontSize: '0.875rem' }}>No messages yet.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {messages.map((m: any) => {
                      const isOwn = m.senderId === user?.id;
                      return (
                        <div key={m.id} style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
                          <div style={{
                            maxWidth: '75%', background: isOwn ? 'var(--color-primary)' : 'var(--color-surface-2)',
                            color: isOwn ? '#fff' : 'var(--color-text)',
                            borderRadius: isOwn ? 'var(--radius-md) var(--radius-md) 0 var(--radius-md)' : 'var(--radius-md) var(--radius-md) var(--radius-md) 0',
                            padding: '0.625rem 0.875rem', fontSize: '0.875rem',
                          }}>
                            <div style={{ fontSize: '0.6875rem', opacity: 0.7, marginBottom: '0.25rem' }}>
                              {m.sender?.firstName} {m.sender?.lastName} ({m.sender?.roles?.[0]?.replace(/_/g,' ')})
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
              {!complaint.isAnonymous && complaint.submittedBy && (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} className="form-textarea" rows={2} placeholder="Reply to student..." style={{ flex: 1 }} />
                  <button onClick={() => messageText.trim() && sendMessageMutation.mutate(messageText)} disabled={!messageText.trim() || sendMessageMutation.isPending} className="btn btn-primary" style={{ alignSelf: 'flex-end' }}>
                    {sendMessageMutation.isPending ? <Spinner size={16} color="#fff" /> : <Send size={16} />}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Evidence */}
          {activeTab === 'evidence' && (
            <div className="fade-in">
              {!complaint.evidence || complaint.evidence.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                  <FileText size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.3 }} />
                  <p>No evidence attached.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {complaint.evidence.map((ev: any) => (
                    <div key={ev.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1rem' }}>
                      <FileText size={20} color="var(--color-primary)" />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{ev.originalName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{ev.type} · {(ev.fileSize / 1024).toFixed(1)}KB</div>
                      </div>
                      {ev.isVerified ? (
                        <span className="badge badge-green" style={{ fontSize: '0.6875rem' }}>Verified</span>
                      ) : (
                        <button
                          onClick={() => verifyEvidenceMutation.mutate(ev.id)}
                          disabled={verifyEvidenceMutation.isPending}
                          className="btn btn-outline"
                          style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}
                          title={isDeptAdmin || isCollegeAdmin || isUniversityAdmin || user?.roles.includes('MAIN_ADMIN') ? 'Mark evidence as verified' : 'Admin verification required'}
                        >
                          <ShieldCheck size={14} /> Verify
                        </button>
                      )}
                      <button onClick={() => downloadEvidence(ev.id, ev.originalName)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                        <Download size={14} />
                      </button>
                      {(ev.uploadedById === user?.id || user?.roles.includes('MAIN_ADMIN')) && (
                        <button
                          onClick={() => { if (window.confirm('Delete this evidence permanently?')) deleteEvidenceMutation.mutate(ev.id); }}
                          disabled={deleteEvidenceMutation.isPending}
                          className="btn btn-outline"
                          style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem', color: 'var(--color-danger)' }}
                          title="Delete evidence"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Assess */}
          {activeTab === 'assess' && isDeptAdmin && (
            <form className="fade-in card" onSubmit={assessForm.handleSubmit((d) => assessMutation.mutate(d))}>
              <h3 style={{ fontWeight: 600, marginBottom: '1rem' }}>Complaint Assessment</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {[
                  { field: 'investigationNotes', label: 'Investigation Notes', placeholder: 'Document your investigation findings...' },
                  { field: 'evidenceAssessment', label: 'Evidence Assessment', placeholder: 'Assess the quality and relevance of submitted evidence...' },
                  { field: 'findings', label: 'Key Findings', placeholder: 'Summarize your key findings...' },
                  { field: 'recommendedAction', label: 'Recommended Action', placeholder: 'What action do you recommend?' },
                  { field: 'resolutionDecision', label: 'Resolution Decision', placeholder: 'Your proposed resolution...' },
                ].map(({ field, label, placeholder }) => (
                  <div key={field} className="form-group">
                    <label className="form-label">{label}</label>
                    <textarea {...assessForm.register(field as any)} className="form-textarea" rows={3} placeholder={placeholder} />
                  </div>
                ))}

                <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', padding: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: '0.75rem' }}>
                    <input type="checkbox" {...assessForm.register('isInformationRequested')} style={{ width: 16, height: 16 }} />
                    <span style={{ fontWeight: 500 }}>Request Additional Information</span>
                  </label>
                  {assessForm.watch('isInformationRequested') && (
                    <div className="form-group">
                      <label className="form-label">What information is needed?</label>
                      <textarea {...assessForm.register('informationRequested')} className="form-textarea" rows={2} placeholder="Describe what additional information you need..." />
                    </div>
                  )}
                </div>

                <button type="submit" className="btn btn-primary" disabled={assessMutation.isPending}>
                  {assessMutation.isPending ? <Spinner size={16} color="#fff" /> : <ClipboardList size={16} />}
                  Save Assessment
                </button>
              </div>
            </form>
          )}

          {/* Escalate */}
          {activeTab === 'escalate' && (
            <form className="fade-in card" onSubmit={escalateForm.handleSubmit((d) => escalateMutation.mutate(d))}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <ArrowUpCircle size={20} color="var(--color-warning)" />
                <h3 style={{ fontWeight: 600 }}>Escalate Complaint</h3>
              </div>
              <div className="alert alert-warning" style={{ marginBottom: '1rem', fontSize: '0.8125rem' }}>
                <AlertTriangle size={16} />
                Escalating this complaint will forward it to the {isCollegeAdmin ? 'University' : 'College'} Administrator for review.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Escalation Reason *</label>
                  <textarea {...escalateForm.register('reason', { required: true, minLength: 10 })} className="form-textarea" rows={3} placeholder="Explain why you are escalating this complaint (min 10 characters)..." />
                  {escalateForm.formState.errors.reason && <span className="form-error">Reason is required (min 10 chars)</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Additional Notes (Optional)</label>
                  <textarea {...escalateForm.register('notes')} className="form-textarea" rows={3} placeholder="Any additional context for the reviewing administrator..." />
                </div>
                <button type="submit" className="btn btn-danger" disabled={escalateMutation.isPending}>
                  {escalateMutation.isPending ? <Spinner size={16} color="#fff" /> : <ArrowUpCircle size={16} />}
                  Escalate Complaint
                </button>
              </div>
            </form>
          )}

          {/* Resolve */}
          {activeTab === 'resolve' && (
            <form className="fade-in card" onSubmit={resolveForm.handleSubmit((d) => resolveMutation.mutate(d))}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <CheckCircle size={20} color="var(--color-success)" />
                <h3 style={{ fontWeight: 600 }}>Resolve Complaint</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Resolution Summary *</label>
                  <input {...resolveForm.register('summary', { required: true, minLength: 10 })} className="form-input" placeholder="Brief summary of the resolution" />
                  {resolveForm.formState.errors.summary && <span className="form-error">Summary is required</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Detailed Resolution *</label>
                  <textarea {...resolveForm.register('detailedResolution', { required: true, minLength: 20 })} className="form-textarea" rows={4} placeholder="Provide a detailed explanation of how the complaint was resolved..." />
                  {resolveForm.formState.errors.detailedResolution && <span className="form-error">Detailed resolution is required</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Action Taken *</label>
                  <textarea {...resolveForm.register('actionTaken', { required: true, minLength: 10 })} className="form-textarea" rows={3} placeholder="What specific actions were taken to resolve this complaint?" />
                  {resolveForm.formState.errors.actionTaken && <span className="form-error">Action taken is required</span>}
                </div>
                <button type="submit" className="btn btn-primary" disabled={resolveMutation.isPending} style={{ background: 'var(--color-success)' }}>
                  {resolveMutation.isPending ? <Spinner size={16} color="#fff" /> : <CheckCircle size={16} />}
                  Mark as Resolved
                </button>
              </div>
            </form>
          )}
          {/* Review (college admin, escalated complaints) */}
          {activeTab === 'review' && isCollegeAdmin && (
            <form className="fade-in card" onSubmit={reviewForm.handleSubmit((d) => reviewMutation.mutate(d))}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <Gavel size={20} color="var(--color-primary)" />
                <h3 style={{ fontWeight: 600 }}>Review Escalated Complaint</h3>
              </div>
              <div className="alert alert-info" style={{ marginBottom: '1rem', fontSize: '0.8125rem' }}>
                <AlertTriangle size={16} />
                Approve closes this escalation as resolved. Reject sends it back to Under Investigation for further work.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Decision *</label>
                  <select {...reviewForm.register('decision')} className="form-input">
                    <option value="APPROVE">Approve — mark resolved</option>
                    <option value="REJECT">Reject — return to investigation</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Review Notes</label>
                  <textarea {...reviewForm.register('reviewNotes')} className="form-textarea" rows={3} placeholder="Document the basis of your decision..." />
                </div>
                <button type="submit" className="btn btn-primary" disabled={reviewMutation.isPending}>
                  {reviewMutation.isPending ? <Spinner size={16} color="#fff" /> : <Gavel size={16} />}
                  Submit Review
                </button>
              </div>
            </form>
          )}
        </div>
        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <h3 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Complaint Info</h3>
            {[
              { label: 'Number', value: complaint.complaintNumber, mono: true },
              { label: 'Category', value: complaint.category?.name ?? '—' },
              { label: 'Department', value: complaint.department?.name ?? '—' },
              { label: 'Submitted', value: new Date(complaint.createdAt).toLocaleDateString() },
              { label: 'Last Updated', value: new Date(complaint.updatedAt).toLocaleDateString() },
              ...(complaint.isAnonymous ? [] : complaint.submittedBy ? [{ label: 'Student', value: `${complaint.submittedBy.firstName} ${complaint.submittedBy.lastName}` }] : []),
            ].map(({ label, value, mono }) => (
              <div key={label} style={{ marginBottom: '0.625rem' }}>
                <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{label}</div>
                <div style={{ fontSize: '0.8125rem', fontFamily: (mono as any) ? 'monospace' : 'inherit', fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>

          {complaint.statusHistory && (
            <div className="card">
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timeline</h3>
              <ComplaintTimeline history={complaint.statusHistory.map((h: any) => ({
                newStatus: h.newStatus, reason: h.reason, changedAt: h.changedAt, changedBy: h.changedBy,
              }))} />
            </div>
          )}
        </div>
      </div>

      <style>{`@media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
