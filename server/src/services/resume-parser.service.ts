/**
 * Resume Parser Service
 * Converts PDF resumes to JSON/text format
 */

import { extractText } from 'unpdf';
import { ResumeRepository } from '../repositories/resume.repository.js';
import type { ParsedResume } from '../types/bamboohr.types.js';
import type { CachedResume } from '../types/summary.types.js';

export class ResumeParserService {
  private resumeRepository: ResumeRepository;

  constructor() {
    this.resumeRepository = new ResumeRepository();
  }

  /**
   * Parse PDF buffer to text and metadata (with caching)
   */
  async parsePdfToJson(
    pdfBuffer: Buffer | Uint8Array,
    resumeFileId?: number
  ): Promise<ParsedResume> {
    try {
      // Check cache first if resumeFileId is provided
      if (resumeFileId) {
        const cached = await this.resumeRepository.getResume(resumeFileId);
        if (cached) {
          console.info(`Using cached parsed resume ${resumeFileId}`);
          return {
            text: cached.text,
            metadata: cached.metadata,
          };
        }
      }

      // Convert Buffer to Uint8Array if needed
      const uint8Array = pdfBuffer instanceof Buffer 
        ? new Uint8Array(pdfBuffer) 
        : pdfBuffer;
      
      // Extract text from PDF using unpdf
      const { text, totalPages } = await extractText(uint8Array, {
        mergePages: true,
      });
      
      const parsedResume: ParsedResume = {
        text,
        metadata: {
          pages: totalPages,
          info: {},
        },
      };

      // Cache the parsed resume if resumeFileId is provided
      if (resumeFileId) {
        const extractedData = this.extractStructuredData(text);
        const cached: CachedResume = {
          text,
          metadata: parsedResume.metadata,
          extractedData,
          cachedAt: new Date().toISOString(),
        };
        await this.resumeRepository.saveResume(resumeFileId, cached);
      }

      return parsedResume;
    } catch (error) {
      console.error('Failed to parse PDF resume', error);
      throw new Error('Failed to parse PDF resume');
    }
  }

  /**
   * Extract structured information from parsed resume text
   * This is a simple implementation - can be enhanced with NLP/ML
   */
  private extractStructuredData(resumeText: string): { emails: string[]; phones: string[]; urls: string[]; lines: string[]; } {
    const lines = resumeText.split('\n').map(line => line.trim()).filter(Boolean);

    // Basic extraction patterns
    const emailPattern = /[\w.-]+@[\w.-]+\.\w+/g;
    const phonePattern = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const urlPattern = /(https?:\/\/[^\s]+)/g;

    const emails = resumeText.match(emailPattern) || [];
    const phones = resumeText.match(phonePattern) || [];
    const urls = resumeText.match(urlPattern) || [];

    return {
      emails,
      phones,
      urls,
      lines,
    };
  }
}
