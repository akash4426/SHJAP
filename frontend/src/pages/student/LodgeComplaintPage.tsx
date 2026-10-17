import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { complaintsApi, adminApi, evidenceApi } from '../../api/client';
import { anonymousApi } from '../../api/client';
import { Shield, Upload, X, FileText, AlertTriangle, Eye, ChevronRight, ChevronLeft } from 'lucide-react';
import { Spinner } from '../../components/shared';

const schema = z.object({
  submissionMode: z.enum(['VERIFIED', 'ANONYMOUS']),
  title: z.string().min(5, 'Title must be at least 5 characters').max(200),
  description: z.string().min(20, 'Description must be at least 20 characters').max(5000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  departmentId: z.string().uuid().optional().or(z.literal('')),
  location: z.string().max(200).optional(),
  additionalInfo: z.string().max(2000).optional(),
});

type FormData = z.infer<typeof schema>;

export function LodgeComplaintPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [submittedComplaint, setSubmittedComplaint] = useState<{ id?: string; trackingId: string; complaintNumber: string; isAnonymous: boolean } | null>(null);

  const { data: catData } = useQuery({ queryKey: ['categories'], queryFn: () => adminApi.listCategories() });
  const { data: deptData } = useQuery({ queryKey: ['departments-public'], queryFn: () => adminApi.listDepartments() });

  const categories = catData?.data?.data ?? [];
  const departments = deptData?.data?.data ?? [];

  const { register, handleSubmit, watch, trigger, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { submissionMode: 'VERIFIED', priority: 'MEDIUM' },
  });

  const submissionMode = watch('submissionMode');

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data,
        categoryId: data.categoryId || undefined,
        departmentId: data.departmentId || undefined,
      };

      if (data.submissionMode === 'ANONYMOUS') {
        const res = await anonymousApi.create(payload);
        return { ...res.data.data, isAnonymous: true };
      } else {
        const res = await complaintsApi.create(payload);
        return { id: res.data.data.id, trackingId: res.data.data.trackingId, complaintNumber: res.data.data.complaintNumber, isAnonymous: false };
      }
    },
    onSuccess: async (data) => {
      setSubmittedComplaint(data);

      // Upload evidence files if any
      if (files.length > 0 && data.id) {
        for (const file of files) {
          const fd = new FormData();
          fd.append('file', file);
          try {
            await evidenceApi.upload(data.id, fd);
          } catch {
            // non-blocking
          }
        }
      }

      toast.success('Complaint submitted successfully!');
      setStep(4); // confirmation step
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message ?? 'Failed to submit complaint');
    },
  });

  const nextStep = async () => {
    if (step === 1) {
      const valid = await trigger(['submissionMode']);
      if (valid) setStep(2);
    } else if (step === 2) {
      const valid = await trigger(['title', 'description', 'priority']);
      if (valid) setStep(3);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files ?? []);
    setFiles((prev) => [...prev, ...newFiles].slice(0, 5));
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const onSubmit = (data: FormData) => mutation.mutate(data);

  // Confirmation screen
  if (step === 4 && submittedComplaint) {
    return (
      <div className="fade-in" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <div style={{ width: 64, height: 64, background: 'var(--color-success-subtle)', border: '2px solid var(--color-success)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', fontSize: '1.75rem' }}>✓</div>
          <h2 style={{ fontSize: '1.375rem', fontWeight: 700, marginBottom: '0.5rem' }}>Complaint Submitted!</h2>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
            Your complaint has been received and will be reviewed shortly.
          </p>
          <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Complaint Number</span>
              <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{submittedComplaint.complaintNumber}</div>
            </div>
            {submittedComplaint.isAnonymous && (
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Anonymous Tracking ID — Save this!</span>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--color-warning)' }}>{submittedComplaint.trackingId}</div>
              </div>
            )}
          </div>
          {submittedComplaint.isAnonymous && (
            <div className="alert alert-warning" style={{ marginBottom: '1.5rem', textAlign: 'left', fontSize: '0.8125rem' }}>
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>Save your tracking ID. You will need it to track your complaint. We cannot recover it for you.</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {!submittedComplaint.isAnonymous && submittedComplaint.id && (
              <button onClick={() => navigate(`/student/complaints/${submittedComplaint.id}`)} className="btn btn-primary">
                View Complaint
              </button>
            )}
            <button onClick={() => navigate('/student/complaints')} className="btn btn-secondary">
              My Complaints
            </button>
            {submittedComplaint.isAnonymous && (
              <button onClick={() => navigate(`/track`)} className="btn btn-ghost">
                Track Anonymously
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="page-header">
        <h1 className="page-title">Lodge a Grievance</h1>
        <p className="page-subtitle">Submit your complaint securely</p>
      </div>

      {/* Step indicator */}
      <div className="step-indicator">
        {['Mode', 'Details', 'Evidence'].map((label, i) => (
          <React.Fragment key={i}>
            <div className={`step ${step > i + 1 ? 'completed' : step === i + 1 ? 'active' : ''}`}>
              <div className="step-number">{step > i + 1 ? '✓' : i + 1}</div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem', display: i < 2 ? 'block' : 'block' }}>{label}</span>
            </div>
            {i < 2 && <div className={`step-line ${step > i + 1 ? 'completed' : ''}`} />}
          </React.Fragment>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Step 1: Submission Mode */}
        {step === 1 && (
          <div className="fade-in">
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>How would you like to submit?</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                {
                  value: 'VERIFIED',
                  icon: <Eye size={24} />,
                  title: 'Verified Complaint',
                  desc: 'Your identity is linked to the complaint. Allows direct communication with administrators and follow-up.',
                  color: 'var(--color-primary)',
                },
                {
                  value: 'ANONYMOUS',
                  icon: <Shield size={24} />,
                  title: 'Anonymous Complaint',
                  desc: 'Your identity is NOT stored. You will receive a tracking ID to follow progress. Cannot be converted to verified later.',
                  color: 'var(--color-accent)',
                },
              ].map((opt) => (
                <label key={opt.value} style={{ cursor: 'pointer' }}>
                  <input type="radio" value={opt.value} {...register('submissionMode')} style={{ display: 'none' }} />
                  <div style={{
                    border: `2px solid ${submissionMode === opt.value ? opt.color : 'var(--color-border-light)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '1.25rem',
                    display: 'flex',
                    gap: '1rem',
                    background: submissionMode === opt.value ? `${opt.color}10` : 'var(--color-surface)',
                    transition: 'all 0.2s',
                  }}>
                    <div style={{ color: opt.color, flexShrink: 0, marginTop: '0.125rem' }}>{opt.icon}</div>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{opt.title}</div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{opt.desc}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
            {submissionMode === 'ANONYMOUS' && (
              <div className="alert alert-warning" style={{ marginBottom: '1rem', fontSize: '0.8125rem' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                Anonymous complaints cannot be converted to verified complaints. Your identity will NOT be stored.
              </div>
            )}
            <button type="button" onClick={nextStep} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
              Continue <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Step 2: Details */}
        {step === 2 && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Complaint Title *</label>
              <input {...register('title')} className={`form-input ${errors.title ? 'error' : ''}`} placeholder="Brief title of your complaint" />
              {errors.title && <span className="form-error">{errors.title.message}</span>}
            </div>

            <div className="form-group">
              <label className="form-label">Description *</label>
              <textarea {...register('description')} className={`form-textarea ${errors.description ? 'error' : ''}`} rows={5} placeholder="Describe your complaint in detail. Include dates, names, and specific incidents." style={{ minHeight: 120 }} />
              {errors.description && <span className="form-error">{errors.description.message}</span>}
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select {...register('priority')} className="form-select">
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Category (Optional)</label>
                <select {...register('categoryId')} className="form-select">
                  <option value="">Auto-detect</option>
                  {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Department (Optional)</label>
              <select {...register('departmentId')} className="form-select">
                <option value="">Auto-assign</option>
                {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Location / Context (Optional)</label>
              <input {...register('location')} className="form-input" placeholder="e.g. Block C Lecture Hall, Online Portal" />
            </div>

            <div className="form-group">
              <label className="form-label">Additional Information (Optional)</label>
              <textarea {...register('additionalInfo')} className="form-textarea" rows={3} placeholder="Any other relevant information..." />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" onClick={() => setStep(1)} className="btn btn-secondary">
                <ChevronLeft size={16} /> Back
              </button>
              <button type="button" onClick={nextStep} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Continue <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Evidence */}
        {step === 3 && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h3 style={{ fontWeight: 600, marginBottom: '0.375rem' }}>Attach Evidence (Optional)</h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                Upload supporting documents, screenshots, or images. Max 5 files, 10MB each.
                Allowed: JPEG, PNG, PDF, DOCX
              </p>
            </div>

            <label style={{ border: '2px dashed var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: '2rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s', display: 'block' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = Array.from(e.dataTransfer.files);
                setFiles((prev) => [...prev, ...dropped].slice(0, 5));
              }}>
              <Upload size={32} style={{ color: 'var(--color-text-subtle)', margin: '0 auto 0.5rem' }} />
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Drop files here or click to browse</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Up to 5 files</div>
              <input type="file" multiple accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx" onChange={handleFileChange} style={{ display: 'none' }} />
            </label>

            {files.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', padding: '0.625rem 0.75rem' }}>
                    <FileText size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>{(f.size / 1024).toFixed(1)}KB</span>
                    <button type="button" onClick={() => removeFile(i)} className="btn-icon" style={{ color: 'var(--color-danger)', flexShrink: 0 }}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="alert alert-info" style={{ fontSize: '0.8125rem' }}>
              <Shield size={16} style={{ flexShrink: 0 }} />
              Evidence is stored securely and only accessible to authorized administrators investigating your complaint.
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" onClick={() => setStep(2)} className="btn btn-secondary">
                <ChevronLeft size={16} /> Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={mutation.isPending} style={{ flex: 1, justifyContent: 'center' }}>
                {mutation.isPending ? <Spinner size={16} color="#fff" /> : null}
                {mutation.isPending ? 'Submitting...' : 'Submit Complaint'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
