import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../../api/client';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { PageLoading } from '../../components/shared';
import { Notification } from '../../types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

const typeColors: Record<string, string> = {
  COMPLAINT_SUBMITTED: 'var(--color-primary)',
  COMPLAINT_ASSIGNED: 'var(--color-accent)',
  STATUS_CHANGED: 'var(--color-info)',
  INFO_REQUESTED: 'var(--color-warning)',
  ADMIN_MESSAGE: 'var(--color-primary)',
  COMPLAINT_ESCALATED: 'var(--color-danger)',
  COMPLAINT_RESOLVED: 'var(--color-success)',
  FEEDBACK_REQUESTED: 'var(--color-warning)',
};

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { primaryRole } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 50 }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications marked as read');
    },
  });

  const notifications: Notification[] = data?.data?.data?.notifications ?? [];
  const unreadCount: number = data?.data?.data?.unreadCount ?? 0;

  if (isLoading) return <PageLoading />;

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={() => markAllReadMutation.mutate()} className="btn btn-secondary btn-sm">
            <CheckCheck size={16} /> Mark All Read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Bell size={40} style={{ color: 'var(--color-text-subtle)', margin: '0 auto 1rem' }} />
          <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>No notifications</h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>You're all caught up!</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {notifications.map((n) => (
            <div
              key={n.id}
              className="card"
              style={{
                display: 'flex',
                gap: '1rem',
                padding: '1rem 1.25rem',
                cursor: 'pointer',
                background: n.isRead ? 'var(--color-surface)' : 'var(--color-surface-2)',
                borderLeft: `3px solid ${n.isRead ? 'transparent' : typeColors[n.type] ?? 'var(--color-primary)'}`,
                transition: 'all 0.2s',
              }}
              onClick={() => !n.isRead && markReadMutation.mutate(n.id)}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius)', flexShrink: 0,
                background: `${typeColors[n.type] ?? 'var(--color-primary)'}20`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Bell size={16} color={typeColors[n.type] ?? 'var(--color-primary)'} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: n.isRead ? 400 : 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{n.title}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{n.message}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '0.375rem' }}>
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
              {!n.isRead && (
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', flexShrink: 0, marginTop: '0.5rem' }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
