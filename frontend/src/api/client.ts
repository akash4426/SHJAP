import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attach JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: handle 401 refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const res = await axios.post('/api/auth/refresh', { refreshToken });
          const { token, refreshToken: newRefresh } = res.data.data;
          localStorage.setItem('token', token);
          localStorage.setItem('refreshToken', newRefresh);
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        } catch {
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
        }
      } else {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ─── Auth ───────────────────────────────────────────────────
export const authApi = {
  register: (data: object) => api.post('/auth/register', data),
  login: (data: object) => api.post('/auth/login', data),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }),
};

// ─── Complaints ─────────────────────────────────────────────
export const complaintsApi = {
  create: (data: object) => api.post('/complaints', data),
  list: (params?: object) => api.get('/complaints', { params }),
  getById: (id: string) => api.get(`/complaints/${id}`),
  assign: (id: string, data: object) => api.post(`/complaints/${id}/assign`, data),
  assess: (id: string, data: object) => api.post(`/complaints/${id}/assess`, data),
  escalate: (id: string, data: object) => api.post(`/complaints/${id}/escalate`, data),
  resolve: (id: string, data: object) => api.post(`/complaints/${id}/resolve`, data),
  close: (id: string, reason?: string) => api.post(`/complaints/${id}/close`, { reason }),
  getHistory: (id: string) => api.get(`/complaints/${id}/history`),
  review: (id: string, data: { decision: 'APPROVE' | 'REJECT'; reviewNotes?: string }) =>
    api.post(`/complaints/${id}/review`, data),
  getMessages: (id: string) => api.get(`/complaints/${id}/messages`),
  sendMessage: (id: string, data: object) => api.post(`/complaints/${id}/messages`, data),
  getTrustScore: (id: string) => api.get(`/complaints/${id}/trust-score`),
  submitFeedback: (id: string, data: object) => api.post(`/complaints/${id}/feedback`, data),
  getFeedback: (id: string) => api.get(`/complaints/${id}/feedback`),
};

// ─── Anonymous ──────────────────────────────────────────────
export const anonymousApi = {
  create: (data: object) => api.post('/anonymous/complaints', data),
  track: (trackingId: string) => api.get(`/anonymous/complaints/${trackingId}`),
};

// ─── Evidence ───────────────────────────────────────────────
export const evidenceApi = {
  upload: (complaintId: string, formData: FormData) =>
    api.post(`/complaints/${complaintId}/evidence`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  list: (complaintId: string) => api.get(`/complaints/${complaintId}/evidence`),
  getDownloadUrl: (complaintId: string, evidenceId: string) =>
    api.get(`/complaints/${complaintId}/evidence/${evidenceId}/download`),
  // Download that works for both storage drivers: local streams raw bytes,
  // S3 returns a JSON body with a presigned URL.
  download: async (complaintId: string, evidenceId: string, fileName?: string) => {
    const res = await api.get(`/complaints/${complaintId}/evidence/${evidenceId}/download`, {
      responseType: 'blob',
    });
    const blob = res.data as Blob;
    if (blob.type.includes('application/json')) {
      const text = await blob.text();
      const { downloadUrl } = JSON.parse(text).data ?? {};
      if (downloadUrl) {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName ?? 'evidence';
        a.click();
      }
      return;
    }
    // Local driver: response content-disposition carries the filename
    const url = URL.createObjectURL(blob);
    const cd = (res.headers['content-disposition'] as string | undefined) ?? '';
    const match = /filename="?([^";]+)"?/.exec(cd);
    const a = document.createElement('a');
    a.href = url;
    a.download = match?.[1] ?? fileName ?? 'evidence';
    a.click();
    URL.revokeObjectURL(url);
  },
  verify: (complaintId: string, evidenceId: string) =>
    api.post(`/complaints/${complaintId}/evidence/${evidenceId}/verify`, {}),
  delete: (complaintId: string, evidenceId: string) =>
    api.delete(`/complaints/${complaintId}/evidence/${evidenceId}`),
};

// ─── Notifications ──────────────────────────────────────────
export const notificationsApi = {
  list: (params?: object) => api.get('/notifications', { params }),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
};

// ─── Admin ──────────────────────────────────────────────────
export const adminApi = {
  listUsers: (params?: object) => api.get('/admin/users', { params }),
  createUser: (data: object) => api.post('/admin/users', data),
  updateUser: (id: string, data: object) => api.patch(`/admin/users/${id}`, data),
  updateRoles: (id: string, data: { roles: string[]; collegeId?: string | null; departmentId?: string | null }) =>
    api.patch(`/admin/users/${id}/roles`, data),
  listDepartments: () => api.get('/admin/departments'),
  createDepartment: (data: object) => api.post('/admin/departments', data),
  listColleges: () => api.get('/admin/colleges'),
  createCollege: (data: object) => api.post('/admin/colleges', data),
  listCategories: () => api.get('/admin/categories'),
  createCategory: (data: object) => api.post('/admin/categories', data),
};

// ─── Analytics ──────────────────────────────────────────────
export const analyticsApi = {
  overview: () => api.get('/analytics/overview'),
  departments: () => api.get('/analytics/departments'),
  categories: () => api.get('/analytics/categories'),
  trustScores: () => api.get('/analytics/trust-scores'),
  resolutionTimes: () => api.get('/analytics/resolution-times'),
};

// ─── Audit ──────────────────────────────────────────────────
export const auditApi = {
  list: (params?: object) => api.get('/audit-logs', { params }),
};
