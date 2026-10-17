import { prisma } from '../config/database.js';

interface TrustFactors {
  evidenceIntegrity: number;      // 0-25: files uploaded, verified
  evidenceCompleteness: number;   // 0-25: description detail, attachments, additional info
  historyConsistency: number;     // 0-25: reporter track record
  processTransparency: number;    // 0-25: responsiveness, notes, assessments
}

interface TrustInput {
  evidence: Array<{ isVerified: boolean }>;
  assessments: unknown[];
  messages: unknown[];
  description: string;
  additionalInfo: string | null;
  isAnonymous: boolean;
  reporterPrevious: Array<{ status: string }>;
}

export class TrustScoreService {
  /** Max points per factor; total normalized to 0-100 */
  static readonly WEIGHTS = {
    evidenceIntegrity: 25,
    evidenceCompleteness: 25,
    historyConsistency: 25,
    processTransparency: 25,
  } as const;

  /**
   * Calculate and persist a Trust Score for a complaint.
   * Score = weighted sum of 4 explainable factors (0-25 each) → 0-100.
   * Status: PENDING while there is too little data to judge, otherwise
   * HIGH/MEDIUM/LOW bands for administrator visibility.
   */
  static async calculate(complaintId: string): Promise<void> {
    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      include: {
        evidence: { select: { isVerified: true } },
        assessments: { select: { id: true } },
        messages: { select: { id: true } },
        submittedBy: {
          select: {
            submittedComplaints: { select: { status: true } },
          },
        },
      },
    });

    if (!complaint) return;

    const input: TrustInput = {
      evidence: complaint.evidence,
      assessments: complaint.assessments,
      messages: complaint.messages,
      description: complaint.description,
      additionalInfo: complaint.additionalInfo,
      isAnonymous: complaint.isAnonymous,
      reporterPrevious: complaint.isAnonymous
        ? []
        : (complaint.submittedBy?.submittedComplaints ?? []).map((c) => ({ status: c.status })),
    };

    const factors = TrustScoreService.computeFactors(input);
    const score = Math.max(0, Math.min(
      100,
      factors.evidenceIntegrity +
      factors.evidenceCompleteness +
      factors.historyConsistency +
      factors.processTransparency
    ));

    const status = TrustScoreService.getStatus(score, input.evidence.length, input.assessments.length);

    await prisma.trustScore.upsert({
      where: { complaintId },
      update: {
        score,
        status,
        evidenceIntegrity: factors.evidenceIntegrity,
        evidenceCompleteness: factors.evidenceCompleteness,
        historyConsistency: factors.historyConsistency,
        processTransparency: factors.processTransparency,
        factors: { ...factors, weights: TrustScoreService.WEIGHTS },
        calculatedAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        complaintId,
        score,
        status,
        evidenceIntegrity: factors.evidenceIntegrity,
        evidenceCompleteness: factors.evidenceCompleteness,
        historyConsistency: factors.historyConsistency,
        processTransparency: factors.processTransparency,
        factors: { ...factors, weights: TrustScoreService.WEIGHTS },
      },
    });
  }

  /**
   * Pure factor computation — unit-testable and explainable in the UI.
   */
  static computeFactors(input: TrustInput): TrustFactors {
    // 1) Evidence Integrity (0-25): verified evidence is weighted highest
    let evidenceIntegrity = 0;
    const verified = input.evidence.filter((e) => e.isVerified).length;
    if (input.evidence.length === 0) {
      evidenceIntegrity = 5; // nothing to validate; neutral-low
    } else {
      evidenceIntegrity = Math.min(15, 8 + input.evidence.length * 3);
      evidenceIntegrity += Math.min(10, verified * 5);
    }

    // 2) Evidence Completeness (0-25): detail quality of the report itself
    let evidenceCompleteness = 0;
    if (input.description.length > 100) evidenceCompleteness += 10;
    else if (input.description.length > 50) evidenceCompleteness += 6;
    else evidenceCompleteness += 3;
    if (input.additionalInfo && input.additionalInfo.length > 20) evidenceCompleteness += 5;
    evidenceCompleteness += Math.min(10, input.evidence.length * 3);
    evidenceCompleteness = Math.min(25, evidenceCompleteness);

    // 3) History Consistency (0-25): reporter track record (anonymous → neutral)
    let historyConsistency = 18; // default for new/anonymous reporters
    if (input.reporterPrevious.length > 3) {
      const rejected = input.reporterPrevious.filter((c) => c.status === 'REJECTED').length;
      const rejectedRate = rejected / input.reporterPrevious.length;
      historyConsistency = Math.round(25 * (1 - rejectedRate));
    }

    // 4) Process Transparency (0-25): cooperation + administrative follow-up
    let processTransparency = 10;
    if (input.messages.length > 0) processTransparency += 8;
    if (input.assessments.length > 0) processTransparency += 7;

    return {
      evidenceIntegrity: clamp(evidenceIntegrity, 0, 25),
      evidenceCompleteness: clamp(evidenceCompleteness, 0, 25),
      historyConsistency: clamp(historyConsistency, 0, 25),
      processTransparency: clamp(processTransparency, 0, 25),
    };
  }

  private static getStatus(score: number, evidenceCount: number, assessmentCount: number): string {
    // Insufficient data: never evaluated by an admin and no supporting evidence
    if (evidenceCount === 0 && assessmentCount === 0) return 'PENDING';
    if (score >= 70) return 'HIGH';
    if (score >= 45) return 'MEDIUM';
    return 'LOW';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
