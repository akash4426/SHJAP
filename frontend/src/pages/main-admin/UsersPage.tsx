import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../api/client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Search, Plus, Edit2, User, Shield, Building2 } from 'lucide-react';
import { PageLoading, EmptyState, Spinner } from '../../components/shared';
import { passwordSchema, PASSWORD_HINT } from '../../utils/validation';

const createUserSchema = z.object({
  email: z.string().email('Valid email is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  password: passwordSchema,
  role: z.enum(['STUDENT','DEPARTMENT_ADMIN','COLLEGE_ADMIN','UNIVERSITY_ADMIN','MAIN_ADMIN']),
  employeeId: z.string().optional(),
  designation: z.string().optional(),
  studentId: z.string().optional(),
  collegeId: z.string().optional(),
  departmentId: z.string().optional(),
}).superRefine((d, ctx) => {
  if (d.role === 'DEPARTMENT_ADMIN' && !d.departmentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['departmentId'], message: 'Select the department this admin manages' });
  }
  if (d.role === 'COLLEGE_ADMIN' && !d.collegeId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['collegeId'], message: 'Select the college this admin manages' });
  }
});

type CreateUserData = z.infer<typeof createUserSchema>;

const roleColors: Record<string, string> = {
  STUDENT: 'badge-blue',
  DEPARTMENT_ADMIN: 'badge-purple',
  COLLEGE_ADMIN: 'badge-green',
  UNIVERSITY_ADMIN: 'badge-yellow',
  MAIN_ADMIN: 'badge-red',
};

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, search, roleFilter],
    queryFn: () => adminApi.listUsers({ page, limit: 15, search: search || undefined, role: roleFilter || undefined }),
  });

  const { data: deptData } = useQuery({
    queryKey: ['departments-list'],
    queryFn: () => adminApi.listDepartments(),
    enabled: showCreate || !!editUser,
  });

  const { data: collegeData } = useQuery({
    queryKey: ['colleges-list'],
    queryFn: () => adminApi.listColleges(),
    enabled: showCreate || !!editUser,
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<CreateUserData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { role: 'STUDENT' },
  });

  const selectedRole = watch('role');

  const createMutation = useMutation({
    // Backend expects `roles: [...]` (array) — the form field is a single role.
    mutationFn: (data: CreateUserData) => {
      // Department admins inherit their college automatically.
      const collegesList: Array<{ id: string; departments?: Array<{ id: string }> }> = collegeData?.data?.data ?? [];
      const deptCollegeId = new Map<string, string>(
        collegesList.flatMap((c) => (c.departments ?? []).map((d) => [d.id, c.id])),
      );
      const collegeId =
        data.role === 'DEPARTMENT_ADMIN'
          ? deptCollegeId.get(data.departmentId ?? '') || undefined
          : data.collegeId || undefined;
      return adminApi.createUser({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        password: data.password,
        roles: [data.role],
        studentId: data.studentId || undefined,
        employeeId: data.employeeId || undefined,
        designation: data.designation || undefined,
        collegeId,
        departmentId: data.departmentId || undefined,
      });
    },
    onSuccess: () => {
      toast.success('User created successfully');
      setShowCreate(false);
      reset();
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: any) => {
      const be = err?.response?.data?.error;
      const first = be?.details?.[0];
      const msg = first ? `${first.path ? first.path + ': ' : ''}${first.message}` : (be?.message ?? 'Failed to create user');
      toast.error(msg);
    },
  });

  const updateRolesMutation = useMutation({
    mutationFn: (input: { id: string; roles: string[]; collegeId?: string | null; departmentId?: string | null }) =>
      adminApi.updateRoles(input.id, { roles: input.roles, collegeId: input.collegeId, departmentId: input.departmentId }),
    onSuccess: () => {
      toast.success('User role updated');
      setEditUser(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: any) => {
      const be = err?.response?.data?.error;
      const first = be?.details?.[0];
      const msg = first ? `${first.path ? first.path + ': ' : ''}${first.message}` : (be?.message ?? 'Failed to update role');
      toast.error(msg);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => adminApi.updateUser(id, { isActive }),
    onSuccess: () => { toast.success('User status updated'); queryClient.invalidateQueries({ queryKey: ['users'] }); },
    onError: () => toast.error('Failed to update status'),
  });

  const users = data?.data?.data ?? [];
  const pagination = data?.data?.pagination;
  const departments = deptData?.data?.data ?? [];
  const colleges = collegeData?.data?.data ?? [];

  if (isLoading) return <PageLoading />;

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage all portal users and their roles</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">
          <Plus size={16} /> Create User
        </button>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '1rem 1.25rem' }}>
        <div className="search-wrapper" style={{ flex: '1 1 200px' }}>
          <Search size={16} className="search-icon" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="form-input search-input" placeholder="Search by name or email..." />
        </div>
        <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} className="form-select" style={{ minWidth: 180 }}>
          <option value="">All Roles</option>
          <option value="STUDENT">Student</option>
          <option value="DEPARTMENT_ADMIN">Department Admin</option>
          <option value="COLLEGE_ADMIN">College Admin</option>
          <option value="UNIVERSITY_ADMIN">University Admin</option>
          <option value="MAIN_ADMIN">Main Admin</option>
        </select>
      </div>

      {/* Users table */}
      {users.length === 0 ? (
        <div className="card"><EmptyState icon={<User />} title="No users found" description="Try adjusting your search." /></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrapper" style={{ borderRadius: 'var(--radius-md)' }}>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                          {u.firstName[0]}{u.lastName[0]}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{u.firstName} {u.lastName}</div>
                          {u.studentProfile && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>ID: {u.studentProfile.studentId}</div>}
                          {u.adminProfile && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{u.adminProfile.designation ?? 'Admin'}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{u.email}</td>
                    <td>
                      <span className={`badge ${roleColors[u.roles[0]] ?? 'badge-gray'}`} style={{ fontSize: '0.6875rem' }}>
                        {u.roles[0]?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'badge-green' : 'badge-red'}`} style={{ fontSize: '0.6875rem' }}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.375rem' }}>
                        <button onClick={() => setEditUser(u)} className="btn btn-ghost btn-sm" title="Edit role">
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => toggleActiveMutation.mutate({ id: u.id, isActive: !u.isActive })}
                          className={`btn btn-sm ${u.isActive ? 'btn-secondary' : 'btn-ghost'}`}
                          style={{ fontSize: '0.6875rem' }}
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="pagination" style={{ padding: '1rem' }}>
              <button className="page-btn" disabled={!pagination.hasPrev} onClick={() => setPage(p => p - 1)}>←</button>
              {Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="page-btn" disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)}>→</button>
            </div>
          )}
        </div>
      )}

      {/* Create User Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create New User</h3>
              <button onClick={() => setShowCreate(false)} className="btn-icon"><span>✕</span></button>
            </div>
            <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">First Name *</label>
                  <input {...register('firstName')} className={`form-input ${errors.firstName ? 'error' : ''}`} placeholder="First name" />
                </div>
                <div className="form-group">
                  <label className="form-label">Last Name *</label>
                  <input {...register('lastName')} className={`form-input ${errors.lastName ? 'error' : ''}`} placeholder="Last name" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input {...register('email')} type="email" className={`form-input ${errors.email ? 'error' : ''}`} placeholder="email@example.com" />
                {errors.email && <span className="form-error">{errors.email.message}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Password *</label>
                <input {...register('password')} type="password" className={`form-input ${errors.password ? 'error' : ''}`} placeholder={PASSWORD_HINT} />
                {errors.password && <span className="form-error">{errors.password.message}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Role *</label>
                <select {...register('role')} className="form-select">
                  <option value="STUDENT">Student</option>
                  <option value="DEPARTMENT_ADMIN">Department Admin</option>
                  <option value="COLLEGE_ADMIN">College Admin</option>
                  <option value="UNIVERSITY_ADMIN">University Admin</option>
                  <option value="MAIN_ADMIN">Main Admin</option>
                </select>
              </div>
              {selectedRole === 'STUDENT' && (
                <div className="form-group">
                  <label className="form-label">Student ID (auto-generated if blank)</label>
                  <input {...register('studentId')} className="form-input" placeholder="e.g. STU2024001" />
                </div>
              )}
              {selectedRole !== 'STUDENT' && (
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Employee ID</label>
                    <input {...register('employeeId')} className="form-input" placeholder="e.g. EMP001" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Designation</label>
                    <input {...register('designation')} className="form-input" placeholder="Job title" />
                  </div>
                </div>
              )}
              {selectedRole === 'STUDENT' || selectedRole === 'COLLEGE_ADMIN' ? (
                <div className="form-group">
                  <label className="form-label">College {selectedRole === 'COLLEGE_ADMIN' ? '*' : ''}</label>
                  <select {...register('collegeId')} className={`form-select ${errors.collegeId ? 'error' : ''}`}>
                    <option value="">— None / unspecified —</option>
                    {colleges.map((c: { id: string; name: string; code: string }) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                  {errors.collegeId && <span className="form-error">{errors.collegeId.message}</span>}
                </div>
              ) : null}
              {selectedRole === 'DEPARTMENT_ADMIN' && (
                <div className="form-group">
                  <label className="form-label">Department * (college auto-assigned)</label>
                  <select {...register('departmentId')} className={`form-select ${errors.departmentId ? 'error' : ''}`}>
                    <option value="">— Select department —</option>
                    {departments.map((d: { id: string; name: string; code: string; college?: { name: string } | null }) => (
                      <option key={d.id} value={d.id}>{d.name} — {d.college?.name ?? 'no college'}</option>
                    ))}
                  </select>
                  {errors.departmentId && <span className="form-error">{errors.departmentId.message}</span>}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary btn-sm">Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={createMutation.isPending}>
                  {createMutation.isPending ? <Spinner size={14} color="#fff" /> : <Plus size={14} />}
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit User Role</h3>
              <button onClick={() => setEditUser(null)} className="btn-icon"><span>✕</span></button>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              {editUser.firstName} {editUser.lastName} — {editUser.email}
            </p>
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label className="form-label">New Role</label>
              <select defaultValue={editUser.roles[0]} id="edit-role-select" className="form-select">
                <option value="STUDENT">Student</option>
                <option value="DEPARTMENT_ADMIN">Department Admin</option>
                <option value="COLLEGE_ADMIN">College Admin</option>
                <option value="UNIVERSITY_ADMIN">University Admin</option>
                <option value="MAIN_ADMIN">Main Admin</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label className="form-label">Department <span style={{ color: 'var(--color-text-muted)' }}>(scope for Department Admin)</span></label>
              <select defaultValue={editUser.studentProfile?.departmentId ?? editUser.adminProfile?.departmentId ?? ''} id="edit-dept-select" className="form-select">
                <option value="">— None —</option>
                {departments.map((d: { id: string; name: string; code: string; college?: { name: string } | null }) => (
                  <option key={d.id} value={d.id}>{d.name} — {d.college?.name ?? 'no college'}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditUser(null)} className="btn btn-secondary btn-sm">Cancel</button>
              <button
                onClick={() => {
                  const roleEl = document.getElementById('edit-role-select') as HTMLSelectElement;
                  const deptEl = document.getElementById('edit-dept-select') as HTMLSelectElement;
                  const collegesList: Array<{ id: string; departments?: Array<{ id: string }> }> = collegeData?.data?.data ?? [];
                  const deptCollegeId = new Map<string, string>(
                    collegesList.flatMap((c) => (c.departments ?? []).map((d) => [d.id, c.id])),
                  );
                  const departmentId = deptEl.value || null;
                  const collegeId = departmentId ? (deptCollegeId.get(departmentId) ?? null) : null;
                  updateRolesMutation.mutate({ id: editUser.id, roles: [roleEl.value], collegeId, departmentId });
                }}
                className="btn btn-primary btn-sm"
                disabled={updateRolesMutation.isPending}
              >
                {updateRolesMutation.isPending ? <Spinner size={14} color="#fff" /> : <Shield size={14} />}
                Update Role
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
