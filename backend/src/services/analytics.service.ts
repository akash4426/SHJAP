import { prisma } from '../config/database.js';
import { AccessControlService } from './access-control.service.js';
import { UserRole } from '@prisma/client';

/**
 * Role-scoped analytics for dashboards and reports.
 * Students never reach these routes; each admin tier sees its own scope.
 */
export class AnalyticsService {
  static async overview(user: { id: string; roles: UserRole[] }) {
    const where = await AccessControlService.buildComplaintListWhere(user, {});

    const complaints = await prisma.complaint.findMany({
      where,
      select: {
        status: true,
        priority: true,
        submissionMode: true,
        createdAt: true,
        resolvedAt: true,
        department: { select: { id: true, name: true, code: true } },
        category: { select: { id: true, name: true } },
        trustScore: { select: { score: true, status: true } },
        feedback: { select: { rating: true } },
      },
    });

    const resolved = complaints.filter((c) => ['RESOLVED', 'CLOSED'].includes(c.status));
    const escalated = complaints.filter((c) => c.status === 'ESCALATED');
    const withResolvedTime = resolved.filter((c) => c.resolvedAt);

    const avgResolutionHours = withResolvedTime.length
      ? Math.round(
          withResolvedTime.reduce((sum, c) => sum + ((c.resolvedAt ?? c.createdAt).getTime() - c.createdAt.getTime()), 0) /
            withResolvedTime.length /
            (1000 * 60 * 60)
        )
      : null;

    const groupCount = <T extends string>(selector: (c: (typeof complaints)[number]) => T) =>
      complaints.reduce<Record<string, number>>((acc, c) => {
        const key = selector(c);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

    const feedbacks = complaints.map((c) => c.feedback?.rating).filter((r): r is number => typeof r === 'number');
    const trustScores = complaints.map((c) => c.trustScore?.score).filter((s): s is number => typeof s === 'number');

    // Complaints over the last 14 days
    const days: Array<{ date: string; submitted: number; resolved: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - i);
      const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
      days.push({
        date: day.toISOString().slice(0, 10),
        submitted: complaints.filter((c) => c.createdAt >= day && c.createdAt < next).length,
        resolved: complaints.filter((c) => c.resolvedAt && c.resolvedAt >= day && c.resolvedAt < next).length,
      });
    }

    return {
      total: complaints.length,
      resolved: resolved.length,
      escalated: escalated.length,
      active: complaints.filter((c) =>
        ['SUBMITTED', 'CATEGORIZED', 'ASSIGNED', 'UNDER_INVESTIGATION', 'INFORMATION_REQUESTED', 'RESOLUTION_PROPOSED'].includes(c.status)
      ).length,
      pendingFeedback: complaints.filter((c) => c.status === 'RESOLVED' && !c.feedback).length,
      resolutionRate: complaints.length ? Math.round((resolved.length / complaints.length) * 100) : 0,
      escalationRate: complaints.length ? Math.round((escalated.length / complaints.length) * 100) : 0,
      avgResolutionHours,
      avgSatisfaction: feedbacks.length ? Math.round((feedbacks.reduce((a, b) => a + b, 0) / feedbacks.length) * 10) / 10 : null,
      avgTrustScore: trustScores.length ? Math.round(trustScores.reduce((a, b) => a + b, 0) / trustScores.length) : null,
      byStatus: groupCount((c) => c.status),
      byPriority: groupCount((c) => c.priority),
      bySubmissionMode: groupCount((c) => c.submissionMode),
      byDepartment: Object.entries(groupCount((c) => c.department?.name ?? 'Unassigned')).map(([name, count]) => ({ name, count })),
      byCategory: Object.entries(groupCount((c) => c.category?.name ?? 'Uncategorized')).map(([name, count]) => ({ name, count })),
      overTime: days,
    };
  }

  static async departmentPerformance(user: { id: string; roles: UserRole[] }) {
    const complaints = await prisma.complaint.findMany({
      where: await AccessControlService.buildComplaintListWhere(user, {}),
      select: {
        status: true,
        createdAt: true,
        resolvedAt: true,
        department: { select: { id: true, name: true, code: true } },
        trustScore: { select: { score: true } },
      },
    });

    const byDept = new Map<string, {
      id: string; name: string; code: string;
      total: number; resolved: number; escalated: number; active: number;
      avgResolutionHours: number | null; avgTrustScore: number | null;
    }>();

    for (const c of complaints) {
      const deptId = c.department?.id ?? 'unassigned';
      const entry = byDept.get(deptId) ?? {
        id: deptId,
        name: c.department?.name ?? 'Unassigned',
        code: c.department?.code ?? '—',
        total: 0, resolved: 0, escalated: 0, active: 0,
        avgResolutionHours: null, avgTrustScore: null,
      };
      entry.total += 1;
      if (['RESOLVED', 'CLOSED'].includes(c.status)) entry.resolved += 1;
      if (c.status === 'ESCALATED') entry.escalated += 1;
      if (['ASSIGNED', 'UNDER_INVESTIGATION', 'INFORMATION_REQUESTED'].includes(c.status)) entry.active += 1;
      byDept.set(deptId, entry);
    }

    for (const [id, entry] of byDept) {
      if (entry.code === '—') continue; // skip synthetic group
      const deptComplaints = complaints.filter((c) => c.department?.id === id);
      const resolvedTimes = deptComplaints
        .filter((c) => c.resolvedAt)
        .map((c) => (c.resolvedAt!.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60));
      const scores = deptComplaints.map((c) => c.trustScore?.score).filter((s): s is number => typeof s === 'number');
      entry.avgResolutionHours = resolvedTimes.length ? Math.round(resolvedTimes.reduce((a, b) => a + b, 0) / resolvedTimes.length) : null;
      entry.avgTrustScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    }

    return Array.from(byDept.values()).sort((a, b) => b.total - a.total);
  }

  static async trustScoreDistribution(user: { id: string; roles: UserRole[] }) {
    const complaints = await prisma.complaint.findMany({
      where: await AccessControlService.buildComplaintListWhere(user, {}),
      select: { trustScore: { select: { score: true, status: true } } },
    });

    const buckets = { PENDING: 0, LOW: 0, MEDIUM: 0, HIGH: 0 };
    const ranges = { '0-25': 0, '26-50': 0, '51-75': 0, '76-100': 0 };
    let sum = 0;
    let count = 0;

    for (const c of complaints) {
      const ts = c.trustScore;
      if (!ts) {
        buckets.PENDING += 1;
        continue;
      }
      if (ts.status === 'PENDING' || ts.score === null) {
        buckets.PENDING += 1;
        continue;
      }
      if (typeof ts.score === 'number') {
        sum += ts.score;
        count += 1;
        if (ts.score <= 25) ranges['0-25'] += 1;
        else if (ts.score <= 50) ranges['26-50'] += 1;
        else if (ts.score <= 75) ranges['51-75'] += 1;
        else ranges['76-100'] += 1;
        if (ts.status in buckets) buckets[ts.status as 'LOW' | 'MEDIUM' | 'HIGH'] += 1;
      }
    }

    return {
      byStatus: buckets,
      byRange: ranges,
      avg: count ? Math.round(sum / count) : null,
      totalScored: count,
      totalPending: buckets.PENDING,
    };
  }

  static async resolutionTimes(user: { id: string; roles: UserRole[] }) {
    const complaints = await prisma.complaint.findMany({
      where: { AND: [await AccessControlService.buildComplaintListWhere(user, {}), { resolvedAt: { not: null } }] },
      select: { createdAt: true, resolvedAt: true, category: { select: { name: true } }, department: { select: { name: true } }, priority: true },
    });

    const hours = complaints.map((c) => ({
      hours: (c.resolvedAt!.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60),
      category: c.category?.name ?? 'Uncategorized',
      department: c.department?.name ?? 'Unassigned',
      priority: c.priority,
    }));

    const avg = hours.length ? Math.round(hours.reduce((a, b) => a + b.hours, 0) / hours.length) : null;

    const byCategory: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const h of hours) {
      byCategory[h.category] = byCategory[h.category] ?? 0;
      byCategory[h.category] += h.hours;
    }
    for (const h of hours) {
      byPriority[h.priority] = byPriority[h.priority] ?? 0;
      byPriority[h.priority] += h.hours;
    }
    for (const key of Object.keys(byCategory)) {
      const n = hours.filter((h) => h.category === key).length || 1;
      byCategory[key] = Math.round(byCategory[key] / n);
    }
    for (const key of Object.keys(byPriority)) {
      const n = hours.filter((h) => h.priority === key).length || 1;
      byPriority[key] = Math.round(byPriority[key] / n);
    }

    return {
      averageResolutionHours: avg,
      totalResolved: hours.length,
      byCategory,
      byPriority,
    };
  }

  static async satisfaction(user: { id: string; roles: UserRole[] }) {
    const where = await AccessControlService.buildComplaintListWhere(user, {});
    const feedbacks = await prisma.feedback.findMany({
      where: { complaint: where },
      select: { rating: true, createdAt: true },
    });

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<string, number>;
    for (const f of feedbacks) distribution[String(f.rating)] = (distribution[String(f.rating)] ?? 0) + 1;

    const avg = feedbacks.length ? Math.round((feedbacks.reduce((a, b) => a + b.rating, 0) / feedbacks.length) * 10) / 10 : null;

    return { total: feedbacks.length, average: avg, distribution };
  }
}
