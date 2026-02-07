// AALIYAH THOMPSON - CANONICAL TEST PROFILE
// Executive-approved validation profile for scholarship matching accuracy

import { type InsertStudentProfile, type StudentProfile } from "@shared/schema";
import { storage } from "../storage";
import { scholarshipMatcher } from "../matching/scholarshipMatcher";

/**
 * Aaliyah Thompson - Canonical Test Profile
 * 
 * Demographics: Black, female, first-generation college student
 * Location: Georgia resident 
 * Academic: CS major, GPA 3.6-3.9 range
 * Financial: FAFSA filed, household income <$60k
 * Interests: AI/robotics focus
 * Timeline: Applying this semester
 * 
 * This profile represents our core target demographic for precision/recall validation
 */
export const AALIYAH_CANONICAL_PROFILE: InsertStudentProfile = {
  userId: 'aaliyah-test-profile', // Test user ID
  
  // Academic Profile
  gpa: '3.75', // Mid-range of 3.6-3.9 
  gpaScale: '4.0',
  satScore: '1280', // Above average for CS programs
  graduationDate: '2025-05-15', // Current senior
  intendedMajor: 'Computer Science',
  intendedMinor: 'Mathematics',
  academicInterests: ['Artificial Intelligence', 'Robotics', 'Machine Learning', 'Software Engineering'],
  
  // Target Demographics (Critical for CEO criteria)
  ethnicity: ['Black', 'African American'],
  gender: 'Female',
  isFirstGeneration: true, // First in family to attend college
  
  // Financial Profile
  householdIncome: '$45,000', // Under $60k threshold
  citizenshipStatus: 'US Citizen',
  
  // Geographic Profile (GA targeting)
  state: 'GA',
  city: 'Atlanta',
  zipCode: '30309',
  schoolName: 'Benjamin E. Mays High School',
  
  // Activities & Achievements
  extracurriculars: [
    'Girls Who Code Club President',
    'National Honor Society',
    'Robotics Team Captain',
    'Computer Science Tutor'
  ],
  workExperience: [
    {
      title: 'IT Support Intern',
      company: 'Local Community Center',
      duration: '6 months',
      description: 'Helping seniors with computer literacy'
    }
  ],
  volunteerHours: '150',
  awards: [
    'Regional Science Fair - 1st Place Computer Science',
    'Georgia STEM Achievement Award',
    'Principal\'s Honor Roll (4 years)'
  ],
  
  // College Planning
  preferredStates: ['GA', 'FL', 'NC', 'TX', 'CA'],
  collegeInterests: [
    'Georgia Institute of Technology',
    'Emory University', 
    'University of Georgia',
    'Spelman College'
  ],
  
  // Application Documents
  documentsUploaded: [
    'transcript_official',
    'fafsa_form',
    'recommendation_letters'
  ]
};

/**
 * Expected scholarship matches for Aaliyah's profile
 * Used for precision/recall validation
 */
export const AALIYAH_EXPECTED_MATCHES = [
  // High-confidence matches (actual database IDs)
  '9bf66aa2-765c-4d6c-a7d4-72f2707360e9', // Georgia Tech President's Scholarship for Women in Computing
  'e4969a0e-8094-4abb-8388-1bb65dcf82e9', // Emory University Diversity in STEM Scholarship  
  'b7d91de6-0c9c-4e07-a162-12796ae3249c', // United Negro College Fund Georgia Scholars Program
  '5e5153e5-80c3-46ea-9743-73bc81aea480', // Google Computer Science Scholarship for Underrepresented Groups
  'c3ff713b-9459-44d1-8812-b1bf891bc181', // Spelman College Computer Science Excellence Award
  'e166b4e9-b30f-40e1-ab8c-8ec86877860a', // Georgia State University First Generation Scholarship
  'f40c5ab2-2c72-42d6-93ac-85fdcc71d80a', // National Society of Black Engineers Scholarship
  
  // Medium-confidence matches 
  '0c6fcfb1-5aa8-4ac4-995e-e92134e1b5f7', // Microsoft Diversity in Technology Scholarship
  'a06a269b-2d2c-4229-93e5-b0628c03113b'  // Georgia HOPE Scholarship for Computer Science
];

/**
 * Test profile variations for comprehensive validation
 */
export const AALIYAH_PROFILE_VARIANTS = {
  
  // Lower GPA variant (tests GPA thresholds)
  lowerGPA: {
    ...AALIYAH_CANONICAL_PROFILE,
    gpa: '3.2',
    userId: 'aaliyah-lowgpa-variant'
  },
  
  // Out-of-state variant (tests geographic restrictions)  
  outOfState: {
    ...AALIYAH_CANONICAL_PROFILE,
    state: 'FL',
    city: 'Miami', 
    zipCode: '33101',
    userId: 'aaliyah-florida-variant'
  },
  
  // Non-first-gen variant (tests demographic targeting)
  nonFirstGen: {
    ...AALIYAH_CANONICAL_PROFILE,
    isFirstGeneration: false,
    householdIncome: '$85,000',
    userId: 'aaliyah-nonfirstgen-variant'
  },
  
  // Different major variant (tests academic matching)
  engineeringMajor: {
    ...AALIYAH_CANONICAL_PROFILE,
    intendedMajor: 'Electrical Engineering',
    academicInterests: ['Electronics', 'Circuits', 'Power Systems'],
    userId: 'aaliyah-engineering-variant'
  }
};

/**
 * Validation test suite for Aaliyah profile
 */
export class AaliyahValidationSuite {
  
  /**
   * Create Aaliyah test profile in database
   */
  async createTestProfile(): Promise<StudentProfile> {
    try {
      const profile = await storage.createStudentProfile(AALIYAH_CANONICAL_PROFILE);
      console.log(`✅ Created Aaliyah Thompson test profile: ${profile.id}`);
      return profile;
    } catch (error) {
      console.error('❌ Failed to create Aaliyah test profile:', error);
      throw error;
    }
  }
  
  /**
   * Run matching validation against Aaliyah profile
   */
  async validateMatching(): Promise<{
    totalMatches: number;
    highConfidenceMatches: number;
    expectedMatchesFound: number;
    precision: number;
    recall: number;
    avgFitScore: number;
    avgEligibilityScore: number;
    processingTime: number;
  }> {
    
    const startTime = Date.now();
    
    try {
      // Get or create Aaliyah's profile
      let profile = await storage.getStudentProfile('aaliyah-test-profile');
      if (!profile) {
        profile = await this.createTestProfile();
      }
      
      // Generate matches
      const matches = await scholarshipMatcher.generateMatches(profile, {
        minFitScore: 60,
        maxResults: 50
      });
      
      const processingTime = Date.now() - startTime;
      
      // Analyze results
      const highConfidenceMatches = matches.filter(m => m.fitScore >= 80).length;
      const matchedScholarshipIds = new Set(matches.map(m => m.scholarshipId));
      const expectedMatchesFound = AALIYAH_EXPECTED_MATCHES.filter(id => 
        matchedScholarshipIds.has(id)
      ).length;
      
      // Calculate precision/recall against expected matches
      const precision = expectedMatchesFound / matches.length || 0;
      const recall = expectedMatchesFound / AALIYAH_EXPECTED_MATCHES.length || 0;
      
      // Calculate average scores
      const avgFitScore = matches.length > 0 
        ? matches.reduce((sum, m) => sum + m.fitScore, 0) / matches.length 
        : 0;
      const avgEligibilityScore = matches.length > 0
        ? matches.reduce((sum, m) => sum + m.eligibilityScore, 0) / matches.length
        : 0;
      
      const results = {
        totalMatches: matches.length,
        highConfidenceMatches,
        expectedMatchesFound,
        precision: Math.round(precision * 100) / 100,
        recall: Math.round(recall * 100) / 100,
        avgFitScore: Math.round(avgFitScore),
        avgEligibilityScore: Math.round(avgEligibilityScore),
        processingTime
      };
      
      console.log('🎯 Aaliyah Matching Validation Results:');
      console.log(`   Total Matches: ${results.totalMatches}`);
      console.log(`   High Confidence (≥80): ${results.highConfidenceMatches}`);
      console.log(`   Expected Matches Found: ${results.expectedMatchesFound}/${AALIYAH_EXPECTED_MATCHES.length}`);
      console.log(`   Precision: ${results.precision}`);
      console.log(`   Recall: ${results.recall}`);
      console.log(`   Avg Fit Score: ${results.avgFitScore}`);
      console.log(`   Avg Eligibility Score: ${results.avgEligibilityScore}`);
      console.log(`   Processing Time: ${results.processingTime}ms`);
      
      // Performance validation
      if (processingTime > 120) {
        console.warn(`⚠️ Performance issue: ${processingTime}ms > 120ms P95 target`);
      } else {
        console.log(`✅ Performance target met: ${processingTime}ms ≤ 120ms`);
      }
      
      return results;
      
    } catch (error) {
      console.error('❌ Aaliyah validation failed:', error);
      throw error;
    }
  }
  
  /**
   * Test profile variants for edge cases
   */
  async validateProfileVariants(): Promise<{
    canonicalResults: any;
    lowerGpaResults: any;
    outOfStateResults: any;
    nonFirstGenResults: any;
    engineeringResults: any;
  }> {
    
    console.log('🧪 Testing Aaliyah profile variants...');
    
    // Create variant profiles
    const variants = ['lowerGPA', 'outOfState', 'nonFirstGen', 'engineeringMajor'] as const;
    const results: any = {};
    
    for (const variant of variants) {
      try {
        const profile = await storage.createStudentProfile(AALIYAH_PROFILE_VARIANTS[variant]);
        const matches = await scholarshipMatcher.generateMatches(profile, {
          minFitScore: 50,
          maxResults: 30
        });
        
        results[`${variant}Results`] = {
          totalMatches: matches.length,
          avgFitScore: Math.round(matches.reduce((sum, m) => sum + m.fitScore, 0) / matches.length || 0),
          topMatch: matches[0] ? {
            name: matches[0].scholarship.name,
            fitScore: matches[0].fitScore,
            eligibilityScore: matches[0].eligibilityScore
          } : null
        };
        
        console.log(`✅ ${variant}: ${matches.length} matches, avg fit: ${results[`${variant}Results`].avgFitScore}`);
        
      } catch (error) {
        console.error(`❌ Failed to test ${variant}:`, error);
        results[`${variant}Results`] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    
    // Run canonical profile
    results.canonicalResults = await this.validateMatching();
    
    return results;
  }
  
  /**
   * Executive validation report
   */
  async generateExecutiveReport(): Promise<{
    launchGateStatus: {
      precisionTarget: boolean; // ≥0.60
      performanceTarget: boolean; // ≤120ms
      coverageTarget: boolean; // ≥90% eligible scholarships
    };
    recommendations: string[];
    readinessLevel: 'Ready' | 'Needs Work' | 'Blocked';
  }> {
    
    console.log('📊 Generating Executive Validation Report...');
    
    const results = await this.validateMatching();
    
    // Evaluate against launch gates
    const launchGateStatus = {
      precisionTarget: results.precision >= 0.60,
      performanceTarget: results.processingTime <= 120,
      coverageTarget: results.totalMatches >= Math.floor(AALIYAH_EXPECTED_MATCHES.length * 0.9)
    };
    
    const recommendations: string[] = [];
    let readinessLevel: 'Ready' | 'Needs Work' | 'Blocked' = 'Ready';
    
    // Precision analysis
    if (!launchGateStatus.precisionTarget) {
      recommendations.push(`Improve precision: ${results.precision} < 0.60 target`);
      readinessLevel = 'Needs Work';
    }
    
    // Performance analysis  
    if (!launchGateStatus.performanceTarget) {
      recommendations.push(`Optimize performance: ${results.processingTime}ms > 120ms P95 target`);
      readinessLevel = 'Needs Work';
    }
    
    // Coverage analysis
    if (!launchGateStatus.coverageTarget) {
      recommendations.push(`Increase scholarship coverage: ${results.totalMatches} matches insufficient`);
      readinessLevel = 'Blocked';
    }
    
    if (results.totalMatches === 0) {
      recommendations.push('CRITICAL: No scholarships in database - populate data first');
      readinessLevel = 'Blocked';
    }
    
    const report = {
      launchGateStatus,
      recommendations,
      readinessLevel
    };
    
    console.log('📋 Executive Report Summary:');
    console.log(`   Readiness Level: ${report.readinessLevel}`);
    console.log(`   Precision Gate: ${launchGateStatus.precisionTarget ? '✅' : '❌'}`);
    console.log(`   Performance Gate: ${launchGateStatus.performanceTarget ? '✅' : '❌'}`);
    console.log(`   Coverage Gate: ${launchGateStatus.coverageTarget ? '✅' : '❌'}`);
    
    return report;
  }
}

export const aaliyahValidator = new AaliyahValidationSuite();