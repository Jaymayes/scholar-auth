// SCHOLARSHIP MATCHING ENGINE - v1.0 HYBRID SEARCH
// Hard Filters + Soft Scoring to eliminate False Positives (Trust Leak Fix)
// Target: 50%+ FPR reduction, <200ms P95 response

import { storage } from "../storage";
import { type StudentProfile, type Scholarship } from "@shared/schema";

// HYBRID SEARCH CONFIGURATION - Hard Filters
export const HARD_FILTER_CONFIG = {
  enabled: true,
  gpa_tolerance: 0.0,  // No tolerance - strict GPA enforcement
  major_fuzzy_threshold: 0.7,
  deadline_buffer_days: 0,  // No expired scholarships
  log_rejections: true
};

export interface MatchResult {
  scholarshipId: string;
  scholarship: Scholarship;
  fitScore: number; // 0-100 compatibility score
  eligibilityScore: number; // 0-100 eligibility confidence  
  competitionLevel: 'low' | 'medium' | 'high';
  matchReasons: string[];
  eligibilityGaps: string[];
  timeToCompleteEstimate: number; // minutes
}

export interface MatchingCriteria {
  minFitScore?: number;
  maxResults?: number;
  includeExpired?: boolean;
  onlyHighConfidence?: boolean;
}

export class ScholarshipMatcher {
  // PERFORMANCE: Scholarship cache to reduce database queries
  private scholarshipCache: { scholarships: Scholarship[]; timestamp: number } | null = null;
  private cacheTTL = 5 * 60 * 1000; // 5 minutes cache
  
  /**
   * Main matching method - generates ranked scholarship matches for a student
   */
  async generateMatches(
    studentProfile: StudentProfile,
    criteria: MatchingCriteria = {}
  ): Promise<MatchResult[]> {
    
    const startTime = Date.now();
    
    // Set defaults
    const {
      minFitScore = 60,
      maxResults = 50,
      includeExpired = false,
      onlyHighConfidence = false
    } = criteria;
    
    try {
      // 1. Fetch active scholarships (cached/optimized query)
      const scholarships = await this.getEligibleScholarships(studentProfile, includeExpired);
      
      // 2. Score each scholarship against student profile
      const scoredMatches: MatchResult[] = [];
      
      for (const scholarship of scholarships) {
        const matchResult = await this.scoreScholarshipMatch(studentProfile, scholarship);
        
        // Apply filtering
        if (matchResult.fitScore >= minFitScore) {
          if (!onlyHighConfidence || matchResult.eligibilityScore >= 85) {
            scoredMatches.push(matchResult);
          }
        }
      }
      
      // 3. Sort by composite score (fit + eligibility)
      const rankedMatches = scoredMatches
        .sort((a, b) => this.getCompositeScore(b) - this.getCompositeScore(a))
        .slice(0, maxResults);
      
      // 4. Performance monitoring
      const processingTime = Date.now() - startTime;
      console.log(`🎯 Matching completed: ${rankedMatches.length}/${scholarships.length} matches in ${processingTime}ms`);
      
      if (processingTime > 200) {
        console.warn(`⚠️ Matching exceeded 200ms target: ${processingTime}ms`);
      }
      
      return rankedMatches;
      
    } catch (error) {
      console.error('❌ Matching engine error:', error);
      throw new Error(`Matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Fetch scholarships that could potentially match this student (with caching)
   */
  private async getEligibleScholarships(
    studentProfile: StudentProfile,
    includeExpired: boolean
  ): Promise<Scholarship[]> {
    
    // PERFORMANCE: Check cache first to avoid repeated database queries
    const now = Date.now();
    if (this.scholarshipCache && (now - this.scholarshipCache.timestamp) < this.cacheTTL) {
      // Use cached scholarships and apply student-specific filtering
      return this.filterScholarshipsForStudent(this.scholarshipCache.scholarships, studentProfile, includeExpired);
    }
    
    // Cache miss - fetch from database
    const filters: any = {
      status: 'active',
      limit: 500 // Reasonable upper bound for performance
    };
    
    const scholarships = await storage.getScholarships(filters);
    
    // PERFORMANCE: Cache the raw scholarships for 5 minutes
    this.scholarshipCache = {
      scholarships,
      timestamp: now
    };
    
    // Apply student-specific filtering
    return this.filterScholarshipsForStudent(scholarships, studentProfile, includeExpired);
  }
  
  /**
   * HARD FILTER: Apply strict eligibility filters BEFORE scoring
   * This eliminates False Positives by rejecting ineligible scholarships early
   */
  private applyHardFilters(
    scholarships: Scholarship[], 
    studentProfile: StudentProfile, 
    includeExpired: boolean
  ): { eligible: Scholarship[]; rejected: { scholarship: Scholarship; reason: string }[] } {
    
    const eligible: Scholarship[] = [];
    const rejected: { scholarship: Scholarship; reason: string }[] = [];
    
    const today = new Date();
    const studentGpa = studentProfile.gpa ? parseFloat(studentProfile.gpa) : null;
    const studentState = studentProfile.state;
    const studentMajor = studentProfile.intendedMajor?.toLowerCase() || '';
    
    for (const scholarship of scholarships) {
      let isEligible = true;
      let rejectionReason = '';
      
      // HARD FILTER 1: Deadline Check (Expired = REJECT, with buffer days)
      if (!includeExpired && scholarship.applicationDeadline) {
        const deadline = new Date(scholarship.applicationDeadline);
        const bufferMs = HARD_FILTER_CONFIG.deadline_buffer_days * 24 * 60 * 60 * 1000;
        const adjustedToday = new Date(today.getTime() - bufferMs);
        if (deadline < adjustedToday) {
          isEligible = false;
          rejectionReason = `EXPIRED_DEADLINE: ${scholarship.applicationDeadline}`;
        }
      }
      
      // HARD FILTER 2: GPA Minimum (Below threshold = REJECT)
      if (isEligible && HARD_FILTER_CONFIG.enabled) {
        const academicReqs = scholarship.academicRequirements as any;
        if (academicReqs?.gpa_min && studentGpa !== null) {
          const requiredGpa = parseFloat(academicReqs.gpa_min);
          if (studentGpa < requiredGpa - HARD_FILTER_CONFIG.gpa_tolerance) {
            isEligible = false;
            rejectionReason = `GPA_TOO_LOW: Student ${studentGpa} < Required ${requiredGpa}`;
          }
        }
      }
      
      // HARD FILTER 3: Geographic Residency (Wrong state = REJECT)
      if (isEligible && HARD_FILTER_CONFIG.enabled) {
        const geoRestrictions = scholarship.geographicRestrictions as any;
        if (geoRestrictions?.states && Array.isArray(geoRestrictions.states) && studentState) {
          const eligibleStates = geoRestrictions.states as string[];
          if (!eligibleStates.includes(studentState)) {
            isEligible = false;
            rejectionReason = `WRONG_STATE: ${studentState} not in [${eligibleStates.join(', ')}]`;
          }
        }
      }
      
      // HARD FILTER 4: Major Eligibility (Wrong major = REJECT, with fuzzy matching)
      if (isEligible && HARD_FILTER_CONFIG.enabled && studentMajor) {
        const academicReqs = scholarship.academicRequirements as any;
        if (academicReqs?.majors && Array.isArray(academicReqs.majors)) {
          const eligibleMajors = academicReqs.majors.map((m: string) => m.toLowerCase());
          
          // Check for exact or fuzzy match
          const hasMatch = eligibleMajors.some((major: string) => 
            studentMajor.includes(major) || 
            major.includes(studentMajor) ||
            this.fuzzyMajorMatch(studentMajor, major)
          );
          
          if (!hasMatch) {
            isEligible = false;
            rejectionReason = `WRONG_MAJOR: ${studentMajor} not in [${academicReqs.majors.join(', ')}]`;
          }
        }
      }
      
      if (isEligible) {
        eligible.push(scholarship);
      } else {
        rejected.push({ scholarship, reason: rejectionReason });
        if (HARD_FILTER_CONFIG.log_rejections) {
          console.log(`🚫 HARD_FILTER_REJECT: ${scholarship.name} - ${rejectionReason}`);
        }
      }
    }
    
    return { eligible, rejected };
  }
  
  /**
   * Fuzzy major matching to reduce False Negatives
   * Handles cases like "Computer Science" matching "CS" or "Computing"
   * Uses major_fuzzy_threshold to control matching strictness
   */
  private fuzzyMajorMatch(studentMajor: string, scholarshipMajor: string): boolean {
    const threshold = HARD_FILTER_CONFIG.major_fuzzy_threshold;
    
    // If threshold is 1.0, require exact match (disable fuzzy)
    if (threshold >= 1.0) {
      return studentMajor === scholarshipMajor;
    }
    
    const majorMappings: Record<string, string[]> = {
      'computer science': ['cs', 'computing', 'software', 'informatics', 'computer engineering', 'information systems'],
      'engineering': ['mechanical', 'electrical', 'civil', 'chemical', 'aerospace', 'systems'],
      'business': ['commerce', 'management', 'entrepreneurship', 'mba', 'accounting'],
      'biology': ['life sciences', 'biomedical', 'biochemistry', 'biotechnology'],
      'psychology': ['behavioral science', 'counseling', 'mental health', 'neuroscience'],
      'communications': ['journalism', 'media studies', 'public relations', 'broadcasting'],
      'stem': ['science', 'technology', 'engineering', 'mathematics', 'computer science']
    };
    
    // Calculate similarity score based on mapping matches
    let matchScore = 0;
    
    for (const [baseMajor, aliases] of Object.entries(majorMappings)) {
      const studentMatch = studentMajor.includes(baseMajor) || aliases.some(a => studentMajor.includes(a));
      const scholarshipMatch = scholarshipMajor.includes(baseMajor) || aliases.some(a => scholarshipMajor.includes(a));
      
      if (studentMatch && scholarshipMatch) {
        matchScore = 1.0;  // Full match through mapping
        break;
      }
      
      // Partial match - same category family
      if (studentMatch || scholarshipMatch) {
        matchScore = Math.max(matchScore, 0.5);
      }
    }
    
    // Direct substring matching for unknown majors (lower confidence)
    if (matchScore === 0) {
      const words1 = studentMajor.split(/\s+/);
      const words2 = scholarshipMajor.split(/\s+/);
      const commonWords = words1.filter(w => words2.includes(w) && w.length > 3);
      if (commonWords.length > 0) {
        matchScore = 0.3 * (commonWords.length / Math.max(words1.length, words2.length));
      }
    }
    
    return matchScore >= threshold;
  }
  
  /**
   * Legacy method - now calls applyHardFilters
   */
  private filterScholarshipsForStudent(
    scholarships: Scholarship[], 
    studentProfile: StudentProfile, 
    includeExpired: boolean
  ): Scholarship[] {
    const { eligible } = this.applyHardFilters(scholarships, studentProfile, includeExpired);
    return eligible;
  }
  
  /**
   * Core matching algorithm - scores a scholarship against student profile  
   */
  private async scoreScholarshipMatch(
    student: StudentProfile,
    scholarship: Scholarship
  ): Promise<MatchResult> {
    
    const matchReasons: string[] = [];
    const eligibilityGaps: string[] = [];
    
    // SCORING COMPONENTS (weighted)
    let demographicScore = 0; // 30% weight
    let academicScore = 0;    // 35% weight  
    let geographicScore = 0;  // 15% weight
    let interestScore = 0;    // 20% weight
    
    // 1. DEMOGRAPHIC MATCHING (Critical for CEO criteria)
    if (scholarship.targetDemographics) {
      const targetDemo = scholarship.targetDemographics as string[];
      let demoMatches = 0;
      let demoTotal = targetDemo.length;
      
      for (const demographic of targetDemo) {
        const demo = demographic.toLowerCase();
        
        // Check ethnicity
        if (student.ethnicity && Array.isArray(student.ethnicity)) {
          const studentEthnicities = (student.ethnicity as string[]).map(e => e.toLowerCase());
          if ((demo.includes('black') || demo.includes('african')) && 
              studentEthnicities.some(e => e.includes('black') || e.includes('african'))) {
            demoMatches++;
            matchReasons.push(`Matches Black/African American demographic`);
          }
          if (demo.includes('hispanic') && 
              studentEthnicities.some(e => e.includes('hispanic') || e.includes('latino'))) {
            demoMatches++;
            matchReasons.push(`Matches Hispanic/Latino demographic`);
          }
        }
        
        // Check gender
        if (student.gender && 
            ((demo.includes('female') || demo.includes('women')) && 
             student.gender.toLowerCase().includes('female'))) {
          demoMatches++;
          matchReasons.push(`Matches female demographic`);
        }
        
        // Check first-generation status
        if (student.isFirstGeneration && 
            (demo.includes('first-generation') || demo.includes('first generation'))) {
          demoMatches++;
          matchReasons.push(`Matches first-generation college student demographic`);
        }
      }
      
      demographicScore = demoTotal > 0 ? (demoMatches / demoTotal) * 100 : 0;
      
      if (demoMatches === 0 && demoTotal > 0) {
        eligibilityGaps.push(`Does not match required demographics: ${targetDemo.join(', ')}`);
      }
    } else {
      demographicScore = 70; // Neutral score for scholarships without demographic restrictions
    }
    
    // 2. ACADEMIC MATCHING
    const academicReqs = scholarship.academicRequirements as any;
    let academicMatches = 0;
    let academicTotal = 0;
    
    // GPA check
    if (academicReqs?.gpa_min) {
      academicTotal++;
      const requiredGpa = parseFloat(academicReqs.gpa_min);
      const studentGpa = student.gpa ? parseFloat(student.gpa) : 0;
      
      if (studentGpa >= requiredGpa) {
        academicMatches++;
        matchReasons.push(`Meets GPA requirement (${student.gpa} ≥ ${academicReqs.gpa_min})`);
      } else {
        eligibilityGaps.push(`GPA too low (${student.gpa} < ${academicReqs.gpa_min} required)`);
      }
    }
    
    // Major matching
    if (academicReqs?.majors && Array.isArray(academicReqs.majors)) {
      academicTotal++;
      const eligibleMajors = academicReqs.majors.map((m: string) => m.toLowerCase());
      const studentMajor = student.intendedMajor?.toLowerCase() || '';
      
      const majorMatch = eligibleMajors.some((major: string) => 
        studentMajor.includes(major.toLowerCase()) || 
        (studentMajor.includes('computer') && major.includes('computer')) ||
        (studentMajor.includes('software') && major.includes('software'))
      );
      
      if (majorMatch) {
        academicMatches++;
        matchReasons.push(`Major matches scholarship focus (${student.intendedMajor})`);
      } else {
        eligibilityGaps.push(`Major not eligible (need: ${academicReqs.majors.join(', ')})`);
      }
    }
    
    academicScore = academicTotal > 0 ? (academicMatches / academicTotal) * 100 : 85;
    
    // 3. GEOGRAPHIC MATCHING
    const geoRestrictions = scholarship.geographicRestrictions as any;
    if (geoRestrictions && geoRestrictions.states && Array.isArray(geoRestrictions.states)) {
      const eligibleStates = geoRestrictions.states as string[];
      if (student.state && eligibleStates.includes(student.state)) {
        geographicScore = 100;
        matchReasons.push(`Eligible in student's state (${student.state})`);
      } else {
        geographicScore = 0;
        eligibilityGaps.push(`Not available in student's state (${student.state})`);
      }
    } else {
      geographicScore = 100; // No restrictions = perfect score
    }
    
    // 4. INTEREST/FIELD MATCHING
    const studentInterests = student.academicInterests as string[] || [];
    const scholarshipTags = scholarship.tags as string[] || [];
    
    let interestMatches = 0;
    const relevantInterests = ['computer_science', 'technology', 'engineering', 'stem', 'coding', 'software'];
    
    for (const interest of relevantInterests) {
      if (studentInterests.some(si => si.toLowerCase().includes(interest)) &&
          scholarshipTags.some(st => st.toLowerCase().includes(interest))) {
        interestMatches++;
      }
    }
    
    interestScore = (interestMatches / relevantInterests.length) * 100;
    if (interestScore === 0 && student.intendedMajor?.toLowerCase().includes('computer')) {
      interestScore = 60; // Boost for CS majors even without explicit interest tags
    }
    
    // COMPOSITE SCORING
    const fitScore = Math.round(
      (demographicScore * 0.30) +
      (academicScore * 0.35) + 
      (geographicScore * 0.15) +
      (interestScore * 0.20)
    );
    
    const eligibilityScore = Math.round(
      (academicScore * 0.60) + (geographicScore * 0.40)
    );
    
    // COMPETITION LEVEL ESTIMATION
    let competitionLevel: 'low' | 'medium' | 'high' = 'medium';
    
    const awardAmount = this.parseAwardAmount(scholarship.awardAmount);
    if (awardAmount > 10000) competitionLevel = 'high';
    if (awardAmount < 2500) competitionLevel = 'low';
    
    if (scholarship.targetDemographics && (scholarship.targetDemographics as string[]).length > 2) {
      competitionLevel = 'low'; // More specific targeting = less competition
    }
    
    // TIME ESTIMATE
    let timeEstimate = 60; // Base 1 hour
    if (scholarship.hasEssayRequirement) timeEstimate += 120; // Add 2 hours for essays
    if ((scholarship.requiredMaterials as string[])?.length > 3) timeEstimate += 30;
    
    return {
      scholarshipId: scholarship.id,
      scholarship,
      fitScore,
      eligibilityScore,
      competitionLevel,
      matchReasons,
      eligibilityGaps,
      timeToCompleteEstimate: timeEstimate
    };
  }
  
  /**
   * Calculate composite score for ranking
   */
  private getCompositeScore(match: MatchResult): number {
    return (match.fitScore * 0.6) + (match.eligibilityScore * 0.4);
  }
  
  /**
   * Parse award amount to numeric value for competition estimation
   */
  private parseAwardAmount(amount: string): number {
    const numbers = amount.match(/\d+/g);
    if (!numbers) return 0;
    
    // Take the maximum if it's a range
    return Math.max(...numbers.map(Number));
  }
  
  /**
   * Save generated matches to database
   */
  async saveMatches(
    studentProfileId: string,
    matches: MatchResult[]
  ): Promise<void> {
    
    // Clear existing matches for this student  
    // TODO: Implement clearMatchesByStudent method in storage
    
    // Save new matches
    for (const match of matches) {
      try {
        await storage.createScholarshipMatch({
          studentProfileId,
          scholarshipId: match.scholarshipId,
          fitScore: match.fitScore.toString(),
          eligibilityScore: match.eligibilityScore.toString(),
          competitionLevel: match.competitionLevel,
          matchReasons: match.matchReasons,
          eligibilityGaps: match.eligibilityGaps,
          applicationStatus: 'not_started',
          timeToCompleteEstimate: match.timeToCompleteEstimate.toString()
        });
      } catch (error) {
        console.error(`Failed to save match for scholarship ${match.scholarshipId}:`, error);
      }
    }
  }
  
  /**
   * Evaluate matching performance against test profiles
   */
  async evaluateMatchingAccuracy(
    testProfiles: Array<{
      profile: StudentProfile;
      expectedMatches: string[]; // scholarship IDs that should match
    }>
  ): Promise<{
    precision: number;
    recall: number;
    f1Score: number;
    details: Array<{
      profileId: string;
      truePositives: number;
      falsePositives: number;
      falseNegatives: number;
    }>;
  }> {
    
    let totalTp = 0, totalFp = 0, totalFn = 0;
    const details = [];
    
    for (const testCase of testProfiles) {
      const matches = await this.generateMatches(testCase.profile, { minFitScore: 70 });
      const predictedIds = new Set(matches.map(m => m.scholarshipId));
      const expectedIds = new Set(testCase.expectedMatches);
      
      const truePositives = Array.from(predictedIds).filter(id => expectedIds.has(id)).length;
      const falsePositives = predictedIds.size - truePositives;
      const falseNegatives = expectedIds.size - truePositives;
      
      totalTp += truePositives;
      totalFp += falsePositives; 
      totalFn += falseNegatives;
      
      details.push({
        profileId: testCase.profile.id,
        truePositives,
        falsePositives,
        falseNegatives
      });
    }
    
    const precision = totalTp / (totalTp + totalFp) || 0;
    const recall = totalTp / (totalTp + totalFn) || 0;
    const f1Score = 2 * (precision * recall) / (precision + recall) || 0;
    
    return {
      precision: Math.round(precision * 100) / 100,
      recall: Math.round(recall * 100) / 100,
      f1Score: Math.round(f1Score * 100) / 100,
      details
    };
  }
  
}

// Missing storage method - need to add to schema
interface CreateScholarshipMatch {
  studentProfileId: string;
  scholarshipId: string;
  fitScore: string;
  eligibilityScore: string;
  competitionLevel: string;
  matchReasons: string[];
  eligibilityGaps: string[];
  applicationStatus: string;
  timeToCompleteEstimate: string;
}

// Extend storage interface
declare module "../storage" {
  interface IStorage {
    createScholarshipMatch(data: CreateScholarshipMatch): Promise<any>;
  }
}

export const scholarshipMatcher = new ScholarshipMatcher();

// STANDALONE EXPORT: Hard filter function for verification endpoint
// Uses synthetic scholarship format with simple properties
interface SyntheticScholarship {
  id: string;
  name: string;
  min_gpa?: number;
  eligible_majors?: string[] | null;
  eligible_states?: string[] | null;
  deadline?: string;
  amount?: number;
  description?: string;
}

interface SimpleStudentProfile {
  gpa: string;
  intendedMajor: string;
  state: string;
}

interface HardFilterResult {
  passed: SyntheticScholarship[];
  rejected: number;
  rejectionReasons: { scholarship: string; reason: string }[];
}

export function applyHardFilters(
  scholarships: SyntheticScholarship[],
  studentProfile: SimpleStudentProfile
): HardFilterResult {
  const passed: SyntheticScholarship[] = [];
  const rejectionReasons: { scholarship: string; reason: string }[] = [];
  
  const today = new Date();
  const studentGpa = parseFloat(studentProfile.gpa);
  const studentState = studentProfile.state?.toUpperCase();
  const studentMajor = studentProfile.intendedMajor?.toLowerCase() || '';
  
  for (const scholarship of scholarships) {
    let isEligible = true;
    let rejectionReason = '';
    
    // HARD FILTER 1: Deadline Check
    if (scholarship.deadline) {
      const deadline = new Date(scholarship.deadline);
      const bufferMs = HARD_FILTER_CONFIG.deadline_buffer_days * 24 * 60 * 60 * 1000;
      const adjustedToday = new Date(today.getTime() - bufferMs);
      if (deadline < adjustedToday) {
        isEligible = false;
        rejectionReason = `EXPIRED_DEADLINE: ${deadline.toISOString().split('T')[0]}`;
      }
    }
    
    // HARD FILTER 2: GPA Minimum
    if (isEligible && HARD_FILTER_CONFIG.enabled && scholarship.min_gpa !== undefined) {
      if (studentGpa < scholarship.min_gpa - HARD_FILTER_CONFIG.gpa_tolerance) {
        isEligible = false;
        rejectionReason = `GPA_TOO_LOW: Student ${studentGpa} < Required ${scholarship.min_gpa}`;
      }
    }
    
    // HARD FILTER 3: State Eligibility
    if (isEligible && HARD_FILTER_CONFIG.enabled && scholarship.eligible_states && scholarship.eligible_states.length > 0) {
      const eligibleStates = scholarship.eligible_states.map(s => s.toUpperCase());
      if (!eligibleStates.includes(studentState)) {
        isEligible = false;
        rejectionReason = `WRONG_STATE: ${studentState} not in [${scholarship.eligible_states.join(', ')}]`;
      }
    }
    
    // HARD FILTER 4: Major Eligibility
    if (isEligible && HARD_FILTER_CONFIG.enabled && scholarship.eligible_majors && scholarship.eligible_majors.length > 0) {
      const eligibleMajors = scholarship.eligible_majors.map(m => m.toLowerCase());
      const hasMatch = eligibleMajors.some(major => 
        studentMajor.includes(major) || 
        major.includes(studentMajor) ||
        fuzzyMajorMatch(studentMajor, major)
      );
      
      if (!hasMatch) {
        isEligible = false;
        rejectionReason = `WRONG_MAJOR: ${studentMajor} not in [${scholarship.eligible_majors.join(', ')}]`;
      }
    }
    
    if (isEligible) {
      passed.push(scholarship);
    } else {
      rejectionReasons.push({ scholarship: scholarship.name, reason: rejectionReason });
      if (HARD_FILTER_CONFIG.log_rejections) {
        console.log(`🚫 HARD_FILTER_REJECT: ${scholarship.name} - ${rejectionReason}`);
      }
    }
  }
  
  return { passed, rejected: rejectionReasons.length, rejectionReasons };
}

// Standalone fuzzy major matching
function fuzzyMajorMatch(studentMajor: string, scholarshipMajor: string): boolean {
  const threshold = HARD_FILTER_CONFIG.major_fuzzy_threshold;
  
  if (threshold >= 1.0) {
    return studentMajor === scholarshipMajor;
  }
  
  const majorMappings: Record<string, string[]> = {
    'computer science': ['cs', 'computing', 'software', 'informatics', 'computer engineering', 'information systems'],
    'engineering': ['mechanical', 'electrical', 'civil', 'chemical', 'aerospace', 'systems'],
    'business': ['commerce', 'management', 'entrepreneurship', 'mba', 'accounting'],
    'biology': ['life sciences', 'biomedical', 'biochemistry', 'biotechnology'],
    'psychology': ['behavioral science', 'counseling', 'mental health', 'neuroscience'],
    'communications': ['journalism', 'media studies', 'public relations', 'broadcasting'],
    'stem': ['science', 'technology', 'engineering', 'mathematics', 'computer science'],
    'art history': ['art', 'fine arts', 'visual arts', 'museum studies'],
    'music': ['performing arts', 'music performance', 'composition', 'musicology']
  };
  
  let matchScore = 0;
  
  for (const [baseMajor, aliases] of Object.entries(majorMappings)) {
    const studentMatch = studentMajor.includes(baseMajor) || aliases.some(a => studentMajor.includes(a));
    const scholarshipMatch = scholarshipMajor.includes(baseMajor) || aliases.some(a => scholarshipMajor.includes(a));
    
    if (studentMatch && scholarshipMatch) {
      matchScore = 1.0;
      break;
    }
    
    if (studentMatch || scholarshipMatch) {
      matchScore = Math.max(matchScore, 0.5);
    }
  }
  
  if (matchScore === 0) {
    const words1 = studentMajor.split(/\s+/);
    const words2 = scholarshipMajor.split(/\s+/);
    const commonWords = words1.filter(w => words2.includes(w) && w.length > 3);
    if (commonWords.length > 0) {
      matchScore = 0.3 * (commonWords.length / Math.max(words1.length, words2.length));
    }
  }
  
  return matchScore >= threshold;
}