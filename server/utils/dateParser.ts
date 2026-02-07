import { parse, isValid, differenceInYears } from 'date-fns';

const SUPPORTED_DATE_FORMATS = [
  'yyyy-MM-dd',    // ISO format: 2000-01-15
  'MM/dd/yyyy',    // US format: 01/15/2000
  'dd/MM/yyyy',    // European format: 15/01/2000
  'MM-dd-yyyy',    // US with dashes: 01-15-2000
  'dd-MM-yyyy',    // European with dashes: 15-01-2000
  'yyyy/MM/dd',    // Alternative ISO: 2000/01/15
];

export function parseFlexibleDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const trimmed = dateStr.trim();

  for (const format of SUPPORTED_DATE_FORMATS) {
    const parsed = parse(trimmed, format, new Date());
    if (isValid(parsed)) {
      return parsed;
    }
  }

  const nativeParsed = new Date(trimmed);
  if (isValid(nativeParsed) && !isNaN(nativeParsed.getTime())) {
    return nativeParsed;
  }

  return null;
}

export function calculateAgeFromDate(dateOfBirth: Date): number {
  return differenceInYears(new Date(), dateOfBirth);
}

export function isValidBirthDate(date: Date): { valid: boolean; error?: string } {
  const today = new Date();
  
  if (date > today) {
    return { valid: false, error: 'Date of birth cannot be in the future' };
  }

  const maxAge = 120;
  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - maxAge);
  
  if (date < minDate) {
    return { valid: false, error: 'Invalid date of birth' };
  }

  return { valid: true };
}

export function toISODateString(date: Date): string {
  return date.toISOString().split('T')[0];
}
