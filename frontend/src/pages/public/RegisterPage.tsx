import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { Shield, Eye, EyeOff, ArrowRight, ChevronLeft } from 'lucide-react';
import { Spinner } from '../../components/shared';
import { passwordSchema, PASSWORD_HINT } from '../../utils/validation';

const schema = z.object({
  firstName: z.string().min(1, 'First name required').max(50),
  lastName: z.string().min(1, 'Last name required').max(50),
  email: z.string().email('Invalid email'),
  studentId: z.string().min(1, 'Student ID required').max(20),
  program: z.string().optional(),
  year: z.number().int().min(1).max(10).optional(),
  phone: z.string().optional(),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormData = z.infer<typeof schema>;

export function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  const { register, handleSubmit, trigger, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const nextStep = async () => {
    const valid = await trigger(['firstName', 'lastName', 'email', 'studentId']);
    if (valid) setStep(2);
  };

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      // Only send fields the backend registerSchema accepts. confirmPassword is
      // a form-only field and must not travel to the API.
      const { confirmPassword: _confirm, ...payload } = data;
      await registerUser({
        ...payload,
        year: data.year ? Number(data.year) : undefined,
      });
      navigate('/student/dashboard');
      toast.success('Account created! Welcome to SHJAP Grievance Portal.');
    } catch (err: any) {
      const beMsg = err?.response?.data?.error?.message;
      const fieldErrors = err?.response?.data?.error?.details;
      const msg =
        (fieldErrors?.length ? `${fieldErrors[0].path ? fieldErrors[0].path + ': ' : ''}${fieldErrors[0].message}` : beMsg) ||
        'Registration failed.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: 52, height: 52, background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', boxShadow: 'var(--shadow-glow)' }}>
            <Shield size={24} color="#fff" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Create Student Account</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Join the SHJAP Grievance Portal</p>
        </div>

        {/* Step indicator */}
        <div className="step-indicator" style={{ marginBottom: '1.5rem' }}>
          <div className={`step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
            <div className="step-number">{step > 1 ? '✓' : '1'}</div>
          </div>
          <div className="step-line" />
          <div className={`step ${step >= 2 ? 'active' : ''}`}>
            <div className="step-number">2</div>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {step === 1 && (
            <>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">First Name</label>
                  <input {...register('firstName')} className={`form-input ${errors.firstName ? 'error' : ''}`} placeholder="John" />
                  {errors.firstName && <span className="form-error">{errors.firstName.message}</span>}
                </div>
                <div className="form-group">
                  <label className="form-label">Last Name</label>
                  <input {...register('lastName')} className={`form-input ${errors.lastName ? 'error' : ''}`} placeholder="Doe" />
                  {errors.lastName && <span className="form-error">{errors.lastName.message}</span>}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">University Email</label>
                <input {...register('email')} type="email" className={`form-input ${errors.email ? 'error' : ''}`} placeholder="student@shjap.edu" />
                {errors.email && <span className="form-error">{errors.email.message}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">Student ID</label>
                <input {...register('studentId')} className={`form-input ${errors.studentId ? 'error' : ''}`} placeholder="e.g. STU2024001" />
                {errors.studentId && <span className="form-error">{errors.studentId.message}</span>}
              </div>

              <button type="button" onClick={nextStep} className="btn btn-primary" style={{ justifyContent: 'center' }}>
                Continue <ArrowRight size={16} />
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="form-group">
                <label className="form-label">Program (Optional)</label>
                <input {...register('program')} className="form-input" placeholder="e.g. Computer Science" />
              </div>

              <div className="form-group">
                <label className="form-label">Phone (Optional)</label>
                <input {...register('phone')} className="form-input" placeholder="+234 80 0000 0000" />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    {...register('password')}
                    type={showPass ? 'text' : 'password'}
                    className={`form-input ${errors.password ? 'error' : ''}`}
                    placeholder={PASSWORD_HINT}
                    style={{ paddingRight: '2.75rem' }}
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex' }}>
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && <span className="form-error">{errors.password.message}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  {...register('confirmPassword')}
                  type="password"
                  className={`form-input ${errors.confirmPassword ? 'error' : ''}`}
                  placeholder="Re-enter password"
                />
                {errors.confirmPassword && <span className="form-error">{errors.confirmPassword.message}</span>}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={() => setStep(1)} className="btn btn-secondary" style={{ flex: '0 0 auto' }}>
                  <ChevronLeft size={16} /> Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1, justifyContent: 'center' }}>
                  {loading ? <Spinner size={16} color="#fff" /> : null}
                  {loading ? 'Creating account...' : 'Create Account'}
                </button>
              </div>
            </>
          )}
        </form>

        <div className="divider" />
        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 500 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
