import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../../api/client';
import toast from 'react-hot-toast';
import { Shield, Mail } from 'lucide-react';
import { Spinner } from '../../components/shared';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
      toast.success('Reset link sent!');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', boxShadow: 'var(--shadow-glow)' }}>
          {sent ? <Mail size={24} color="#fff" /> : <Shield size={24} color="#fff" />}
        </div>

        {sent ? (
          <>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Check your email</h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
              A password reset link has been sent to <strong>{email}</strong>
            </p>
            <Link to="/login" className="btn btn-primary" style={{ display: 'inline-flex' }}>Back to Sign In</Link>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Forgot Password?</h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
              Enter your email and we'll send you a reset link.
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                  placeholder="your@email.com"
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ justifyContent: 'center' }}>
                {loading ? <Spinner size={16} color="#fff" /> : null}
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
            <div className="divider" />
            <Link to="/login" style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', textDecoration: 'none' }}>← Back to Sign In</Link>
          </>
        )}
      </div>
    </div>
  );
}
