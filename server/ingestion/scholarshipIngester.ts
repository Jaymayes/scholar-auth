// SCHOLARSHIP DATA INGESTION PIPELINE - MVP v0.9
// Handles ingestion from APIs, partner uploads, and curated feeds with full provenance tracking

import { storage } from "../storage";
import { type InsertScholarship } from "@shared/schema";

export interface IngestionSource {
  id: string;
  name: string;
  type: 'api' | 'partner' | 'crawl' | 'manual';
  description: string;
  baseUrl?: string;
  apiKey?: string;
  priority: number; // Higher number = higher priority for deduplication
}

export interface RawScholarshipData {
  // Core fields
  name: string;
  description?: string;
  provider: string;
  providerWebsite?: string;
  
  // Award details  
  awardAmount: string;
  awardCurrency?: string;
  isRenewable?: boolean;
  renewalCriteria?: string;
  
  // Dates
  applicationDeadline?: string | Date;
  applicationOpenDate?: string | Date;
  awardNotificationDate?: string | Date;
  
  // Eligibility (structured)
  eligibilityText?: string; // Raw text that needs parsing
  targetDemographics?: string[];
  gpaMinimum?: string;
  majorsEligible?: string[];
  statesEligible?: string[];
  
  // Application details
  applicationUrl?: string;
  applicationMethod?: string;
  requiredDocuments?: string[];
  essayRequired?: boolean;
  essayPrompts?: string[];
  
  // Source metadata
  sourceId?: string;
  sourceUrl?: string;
  lastUpdated?: string | Date;
}

export class ScholarshipIngester {
  
  /**
   * Main ingestion method - processes raw data with full provenance tracking
   */
  async ingestScholarship(
    rawData: RawScholarshipData,
    source: IngestionSource
  ): Promise<string> {
    
    // Create ingestion job for tracking
    const job = await storage.createIngestionJob({
      jobType: 'single_scholarship',
      sourceType: source.type,
      sourceName: source.name
    });
    
    try {
      // Update job status
      await storage.updateIngestionJob(job.id, {
        status: 'running',
        startedAt: new Date()
      });
      
      // Transform raw data to canonical format
      const canonicalData = await this.transformToCanonical(rawData, source);
      
      // Check for duplicates
      const existingScholarship = await this.findDuplicate(canonicalData);
      
      let scholarshipId: string;
      
      if (existingScholarship) {
        // Update existing with fresher data if source has higher priority
        scholarshipId = await this.handleDuplicate(existingScholarship, canonicalData, source);
        await storage.updateIngestionJob(job.id, {
          recordsUpdated: '1',
          recordsProcessed: '1'
        });
      } else {
        // Create new scholarship
        const scholarship = await storage.createScholarship(canonicalData);
        scholarshipId = scholarship.id;
        await storage.updateIngestionJob(job.id, {
          recordsCreated: '1', 
          recordsProcessed: '1'
        });
      }
      
      // Mark job complete
      await storage.updateIngestionJob(job.id, {
        status: 'completed',
        completedAt: new Date()
      });
      
      return scholarshipId;
      
    } catch (error) {
      // Mark job failed
      await storage.updateIngestionJob(job.id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorCount: '1',
        completedAt: new Date()
      });
      throw error;
    }
  }
  
  /**
   * Transform raw data to canonical scholarship format
   */
  private async transformToCanonical(
    raw: RawScholarshipData,
    source: IngestionSource
  ): Promise<InsertScholarship> {
    
    // Parse and normalize award amount
    const { awardAmountMin, awardAmountMax } = this.parseAwardAmount(raw.awardAmount);
    
    // Parse dates safely
    const applicationDeadline = raw.applicationDeadline ? 
      new Date(raw.applicationDeadline) : undefined;
    const applicationOpenDate = raw.applicationOpenDate ?
      new Date(raw.applicationOpenDate) : undefined;
      
    // Structure eligibility criteria
    const eligibilityCriteria = this.structureEligibility(raw);
    
    // Parse demographics
    const targetDemographics = raw.targetDemographics || [];
    
    // Academic requirements
    const academicRequirements = {
      gpa_min: raw.gpaMinimum,
      majors: raw.majorsEligible || []
    };
    
    // Geographic restrictions
    const geographicRestrictions = raw.statesEligible ? {
      states: raw.statesEligible,
      countries: ['US']
    } : undefined;
    
    // Required materials
    const requiredMaterials = raw.requiredDocuments || ['application'];
    if (raw.essayRequired) {
      requiredMaterials.push('essay');
    }
    
    // Essay requirements
    const essayRequirements = raw.essayRequired ? {
      required: true,
      prompts: raw.essayPrompts || []
    } : undefined;
    
    return {
      name: raw.name,
      description: raw.description,
      provider: raw.provider,
      providerWebsite: raw.providerWebsite,
      awardAmount: raw.awardAmount,
      awardAmountMin,
      awardAmountMax, 
      awardCurrency: raw.awardCurrency || 'USD',
      isRenewable: raw.isRenewable || false,
      renewalCriteria: raw.renewalCriteria,
      applicationDeadline,
      applicationOpenDate,
      awardNotificationDate: raw.awardNotificationDate ? new Date(raw.awardNotificationDate) : undefined,
      eligibilityCriteria,
      targetDemographics,
      academicRequirements,
      geographicRestrictions,
      otherRequirements: {},
      requiredMaterials,
      applicationMethod: raw.applicationMethod || 'online',
      applicationUrl: raw.applicationUrl,
      hasApplicationFee: false,
      essayRequirements,
      hasEssayRequirement: raw.essayRequired || false,
      status: 'active',
      sourceType: source.type,
      sourceId: raw.sourceId,
      sourceUrl: raw.sourceUrl,
      sourceMetadata: {
        ingestionDate: new Date().toISOString(),
        sourcePriority: source.priority,
        rawData: raw // Keep original for debugging
      },
      verificationStatus: 'pending',
      searchableText: `${raw.name} ${raw.description} ${raw.provider}`,
      tags: this.extractTags(raw)
    };
  }
  
  /**
   * Parse award amount string into min/max values
   */
  private parseAwardAmount(amount: string): { awardAmountMin?: string, awardAmountMax?: string } {
    // Handle ranges like "$1000-$5000"
    const rangeMatch = amount.match(/\$?(\d+)[\s]*-[\s]*\$?(\d+)/);
    if (rangeMatch) {
      return {
        awardAmountMin: rangeMatch[1],
        awardAmountMax: rangeMatch[2]
      };
    }
    
    // Handle single amounts like "$5000" or "Full Tuition"
    const singleMatch = amount.match(/\$?(\d+)/);
    if (singleMatch) {
      return {
        awardAmountMin: singleMatch[1],
        awardAmountMax: singleMatch[1]
      };
    }
    
    // Handle special cases like "Full Tuition", "Varies"
    return {};
  }
  
  /**
   * Structure raw eligibility text into searchable criteria
   */
  private structureEligibility(raw: RawScholarshipData): any {
    const criteria: any = {
      raw_text: raw.eligibilityText
    };
    
    if (raw.gpaMinimum) {
      criteria.gpa_minimum = parseFloat(raw.gpaMinimum);
    }
    
    if (raw.majorsEligible?.length) {
      criteria.eligible_majors = raw.majorsEligible;
    }
    
    if (raw.statesEligible?.length) {
      criteria.eligible_states = raw.statesEligible; 
    }
    
    return criteria;
  }
  
  /**
   * Extract searchable tags from raw data
   */
  private extractTags(raw: RawScholarshipData): string[] {
    const tags = [];
    
    // Add demographics as tags
    if (raw.targetDemographics) {
      tags.push(...raw.targetDemographics.map(d => d.toLowerCase()));
    }
    
    // Add major categories
    if (raw.majorsEligible) {
      tags.push(...raw.majorsEligible.map(m => m.toLowerCase().replace(/\s+/g, '_')));
    }
    
    // Add award type tags
    if (raw.awardAmount.toLowerCase().includes('tuition')) {
      tags.push('tuition');
    }
    if (raw.essayRequired) {
      tags.push('essay_required');
    }
    
    return Array.from(new Set(tags)); // Remove duplicates
  }
  
  /**
   * Find potential duplicate scholarships
   */
  private async findDuplicate(canonical: InsertScholarship): Promise<any> {
    // Simple duplicate detection based on name and provider
    const existing = await storage.getScholarships({
      limit: 100 // Search recent scholarships
    });
    
    return existing.find(scholarship => 
      scholarship.name.toLowerCase() === canonical.name.toLowerCase() &&
      scholarship.provider.toLowerCase() === canonical.provider.toLowerCase()
    );
  }
  
  /**
   * Handle duplicate scholarship - update if new source has higher priority
   */
  private async handleDuplicate(existing: any, canonical: InsertScholarship, source: IngestionSource): Promise<string> {
    const existingPriority = existing.sourceMetadata?.sourcePriority || 0;
    
    if (source.priority > existingPriority) {
      // Update with fresher data
      await storage.updateScholarship(existing.id, canonical);
    }
    
    return existing.id;
  }
  
  /**
   * Bulk ingestion for large datasets
   */
  async bulkIngest(
    rawDataList: RawScholarshipData[],
    source: IngestionSource
  ): Promise<{
    processed: number;
    created: number; 
    updated: number;
    failed: number;
    errors: string[];
  }> {
    
    const job = await storage.createIngestionJob({
      jobType: 'bulk_ingestion',
      sourceType: source.type,
      sourceName: source.name
    });
    
    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [] as string[]
    };
    
    try {
      await storage.updateIngestionJob(job.id, {
        status: 'running',
        startedAt: new Date()
      });
      
      for (const rawData of rawDataList) {
        try {
          await this.ingestScholarship(rawData, source);
          results.processed++;
          results.created++; // Simplified - would track actual create vs update
        } catch (error) {
          results.failed++;
          results.errors.push(`${rawData.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      await storage.updateIngestionJob(job.id, {
        status: 'completed',
        recordsProcessed: results.processed.toString(),
        recordsCreated: results.created.toString(), 
        recordsUpdated: results.updated.toString(),
        errorCount: results.failed.toString(),
        completedAt: new Date()
      });
      
    } catch (error) {
      await storage.updateIngestionJob(job.id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Bulk ingestion failed',
        completedAt: new Date()
      });
      throw error;
    }
    
    return results;
  }
}

export const scholarshipIngester = new ScholarshipIngester();