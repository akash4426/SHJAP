import React from 'react';
import { Link } from 'react-router-dom';
import { Shield, FileText, Bell, Users, ChevronRight, Lock, Eye, BarChart } from 'lucide-react';

export function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={18} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: '1.0625rem' }}>SHJAP Grievance Portal</span>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Link to="/track" className="btn btn-ghost btn-sm">Track Complaint</Link>
          <Link to="/login" className="btn btn-secondary btn-sm">Sign In</Link>
          <Link to="/register" className="btn btn-primary btn-sm">Register</Link>
        </div>
      </header>

      {/* Hero */}
      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4rem 2rem' }}>
        <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '9999px', padding: '0.375rem 1rem', fontSize: '0.8125rem', color: 'var(--color-primary)', marginBottom: '1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{ width: 6, height: 6, background: 'var(--color-primary)', borderRadius: '50%', animation: 'pulse 2s infinite' }} />
          Secure • Transparent • Confidential
        </div>

        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 800, lineHeight: 1.1, marginBottom: '1.25rem', background: 'linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          University Grievance<br />Management System
        </h1>

        <p style={{ fontSize: '1.125rem', color: 'var(--color-text-muted)', maxWidth: 560, marginBottom: '2.5rem', lineHeight: 1.7 }}>
          Submit complaints, track their progress, and receive resolution — all in one secure, transparent platform designed for SHJAP University students and administrators.
        </p>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link to="/register" className="btn btn-primary btn-lg">
            Submit a Complaint <ChevronRight size={18} />
          </Link>
          <Link to="/track" className="btn btn-secondary btn-lg">
            Track Anonymous Complaint
          </Link>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '4rem 2rem', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <h2 style={{ textAlign: 'center', fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>How It Works</h2>
        <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginBottom: '3rem' }}>A transparent, end-to-end complaint management process</p>

        <div className="grid-4">
          {[
            { icon: <FileText size={24} />, title: 'Submit Complaint', desc: 'Lodge verified or anonymous grievances with optional evidence attachments', color: 'var(--color-primary)' },
            { icon: <Eye size={24} />, title: 'Track Progress', desc: 'Real-time status updates with complete timeline visibility', color: 'var(--color-accent)' },
            { icon: <Users size={24} />, title: 'Expert Review', desc: 'Qualified administrators investigate and assess each complaint', color: 'var(--color-success)' },
            { icon: <Lock size={24} />, title: 'Secure & Private', desc: 'Tamper-evident audit logs and anonymity options protect your identity', color: 'var(--color-warning)' },
          ].map((f, i) => (
            <div key={i} className="card" style={{ textAlign: 'center', padding: '1.75rem 1.5rem' }}>
              <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-md)', background: `${f.color}15`, border: `1px solid ${f.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: f.color, margin: '0 auto 1rem' }}>
                {f.icon}
              </div>
              <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{f.title}</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Anonymous tracking CTA */}
      <section style={{ padding: '3rem 2rem', background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Submitted Anonymously?</h3>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.25rem', fontSize: '0.875rem' }}>Use your tracking ID to check the status of your anonymous complaint.</p>
        <Link to="/track" className="btn btn-primary">Track My Complaint</Link>
      </section>

      {/* Footer */}
      <footer style={{ padding: '1.5rem 2rem', borderTop: '1px solid var(--color-border)', textAlign: 'center', color: 'var(--color-text-subtle)', fontSize: '0.8125rem' }}>
        © 2024 SHJAP University. All rights reserved. | Grievance Portal v1.0
      </footer>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
