import { describe, it, expect } from 'vitest';
import { CategorizationService } from '../../src/services/categorization.service.js';

describe('CategorizationService.classify (unit)', () => {
  it('routes IT keywords (title-weighted) to IT services with HIGH confidence', () => {
    const result = CategorizationService.classify(
      'Portal login rejected with valid password on wifi',
      'When trying to login to the course registration portal from campus wifi my valid password is repeatedly rejected.'
    );
    expect(result).not.toBeNull();
    expect(result!.categoryCode).toBe('IT_SERVICES');
    expect(result!.departmentCode).toBe('IT');
    expect(result!.confidence).toBe('HIGH');
  });

  it('routes exam/result complaints to academic assessment even with overlapping words', () => {
    const result = CategorizationService.classify(
      'Exam result for humanities elective is missing twice',
      'My humanities elective final result is missing from the result system both midterm and final. Advisor says record was sent twice. I have attached the advisor confirmation email and my student record printout for the course.'
    );
    expect(result).not.toBeNull();
    expect(result!.categoryCode).toBe('ACADEMIC_ASSESSMENT');
    expect(result!.departmentCode).toBe('ACADEMICS');
  });

  it('routes harassment keywords to student affairs', () => {
    const result = CategorizationService.classify(
      'A staff member is bullying me repeatedly',
      'A lecturer keeps verbally abusing students during meetings and the behaviour is intimidating and discriminatory.'
    );
    expect(result).not.toBeNull();
    expect(result!.categoryCode).toBe('HARASSMENT');
    expect(result!.departmentCode).toBe('STUDENT_AFFAIRS');
  });

  it('routes fee/refund complaints to finance', () => {
    const result = CategorizationService.classify(
      'Refund of duplicate scholarship payment',
      'A scholarship payment was issued twice and the bursary needs to refund one invoice.'
    );
    expect(result).not.toBeNull();
    expect(result!.departmentCode).toBe('FINANCE');
  });

  it('routes facility complaints (toilet/washroom/building) to facilities', () => {
    const result = CategorizationService.classify(
      'Broken heater in classroom 14 is a risk',
      'The classroom heater sparks when switched on and one panel is visibly damaged. It is used every morning by a full class.'
    );
    expect(result).not.toBeNull();
    expect(result!.departmentCode).toBe('FACILITIES');
  });

  it('flags an exact tie between two categories as AMBIGUOUS', () => {
    // "record" matches ADMINISTRATIVE; "email" matches IT_SERVICES — forced tie
    const result = CategorizationService.classify('Record email', 'record email');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('AMBIGUOUS');
  });

  it('returns null when nothing matches', () => {
    expect(CategorizationService.classify('Unrelated matter', 'Nothing here corresponds to any rule keyword.')).toBeNull();
  });

  it('requires description of at least matched content to not match', () => {
    const result = CategorizationService.classify(
      'Fluffy crescent moonlight',
      'Vermilion doves parading over rotating mirrors beneath silent auroras.'
    );
    expect(result).toBeNull();
  });
});
