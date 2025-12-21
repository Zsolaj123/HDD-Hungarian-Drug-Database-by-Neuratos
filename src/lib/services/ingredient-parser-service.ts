/**
 * Ingredient Parser Service
 *
 * Parses multi-ingredient drug strings into individual components.
 * Handles Hungarian (és), English (and), and comma-separated patterns.
 *
 * Patterns detected:
 * - " and " - English (lamivudine and abacavir)
 * - " és " - Hungarian (ezetimib és roszuvasztatin)
 * - ", ... and/és " - Oxford comma (emtricitabine, tenofovir alafenamide and bictegravir)
 */

export interface ParsedIngredients {
  original: string;
  ingredients: string[];
  isMultiIngredient: boolean;
  isGenericPlaceholder: boolean; // e.g., "irbesartan and diuretics"
}

// Generic placeholders that need ATC fallback - these don't specify actual ingredients
const GENERIC_PLACEHOLDERS = [
  'diuretics', 'diuretikumok', 'vizelethajtók', 'vizelethajtó',
  'combinations', 'kombinációk', 'kombinációi', 'kombináció',
  'enzim-inhibitor', 'enzyme inhibitor', 'enzyme-inhibitor',
  'decarboxylase inhibitor', 'dekarboxiláz inhibitor',
  'comt inhibítor', 'comt inhibitor',
  'egyéb', 'other', 'others',
  'vakcinák', 'vaccines',
  'antibiotics', 'antibiotikumok',
  'antipsychotics', 'antipszichotikumok',
  'analgesics', 'fájdalomcsillapítók',
  'psycholeptics', 'pszicholeptikumok',
  'corticosteroids', 'kortikoszteroidok',
  'estrogen', 'ösztrogén', 'ösztrogének',
  'progestogen', 'progesztogén', 'progesztogének',
  'calcium channel blockers', 'kalciumcsatorna-blokkolók'
];

class IngredientParserService {
  /**
   * Parse an ingredient string into individual components
   */
  parse(ingredientString: string | undefined | null): ParsedIngredients {
    if (!ingredientString || ingredientString.trim() === '') {
      return {
        original: ingredientString || '',
        ingredients: [],
        isMultiIngredient: false,
        isGenericPlaceholder: false
      };
    }

    const trimmed = ingredientString.trim();

    // Check for generic placeholders
    const isGenericPlaceholder = this.hasGenericPlaceholder(trimmed);

    // Try to split by various patterns
    let ingredients = this.splitIngredients(trimmed);

    // Clean up each ingredient
    ingredients = ingredients
      .map(ing => this.cleanIngredient(ing))
      .filter(ing => ing.length > 0 && !this.isPlaceholderOnly(ing));

    return {
      original: trimmed,
      ingredients,
      isMultiIngredient: ingredients.length > 1,
      isGenericPlaceholder
    };
  }

  /**
   * Check if the string contains generic placeholders
   */
  private hasGenericPlaceholder(text: string): boolean {
    const lower = text.toLowerCase();
    return GENERIC_PLACEHOLDERS.some(
      placeholder => lower.includes(placeholder.toLowerCase())
    );
  }

  /**
   * Check if a string is only a placeholder (not useful on its own)
   */
  private isPlaceholderOnly(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return GENERIC_PLACEHOLDERS.some(
      placeholder => lower === placeholder.toLowerCase()
    );
  }

  /**
   * Split ingredients using multiple patterns
   */
  private splitIngredients(text: string): string[] {
    // Pattern priority: more specific first

    // 1. "ingredient1, ingredient2 and ingredient3" or "ingredient1, ingredient2 és ingredient3"
    // Handles: "emtricitabine, tenofovir alafenamide and bictegravir"
    // Handles: "valsartan, amlodipin és hydrochlorothiazid"
    const commaAndPattern = /^(.+),\s*(.+?)\s+(?:and|és)\s+(.+)$/i;
    const commaAndMatch = text.match(commaAndPattern);
    if (commaAndMatch) {
      const [, firstPart, second, third] = commaAndMatch;
      // First part might have more commas
      const firstParts = firstPart.split(/,\s*/).map(s => s.trim()).filter(s => s);
      return [...firstParts, second.trim(), third.trim()];
    }

    // 2. Simple "and" or "és" conjunction (two ingredients)
    // Handles: "lamivudine and abacavir", "ezetimib és roszuvasztatin"
    const andPattern = /^(.+?)\s+(?:and|és)\s+(.+)$/i;
    const andMatch = text.match(andPattern);
    if (andMatch) {
      const [, first, second] = andMatch;
      // Check if second part itself has more ingredients (nested pattern)
      const secondParts = this.splitIngredients(second);
      return [first.trim(), ...secondParts];
    }

    // 3. Comma-only separation with potential Hungarian "és" in the middle
    // Handles: "levodopa, decarboxylase inhibitor és comt inhibítor"
    if (text.includes(',') && text.includes(' és ')) {
      const parts = text.split(/,\s*(?=[^,]*\s+és\s+)|(?<=\s+és\s+[^,]*),\s*/i);
      if (parts.length > 1) {
        const result: string[] = [];
        for (const part of parts) {
          const subParts = this.splitIngredients(part);
          result.push(...subParts);
        }
        return result;
      }
    }

    // 4. Pure comma separation (less common, be conservative)
    const commaParts = text.split(/,\s*/);
    if (commaParts.length > 1 && commaParts.every(p => this.looksLikeIngredient(p))) {
      return commaParts.map(p => p.trim());
    }

    // Single ingredient
    return [text];
  }

  /**
   * Check if a string looks like an ingredient name (not a form or dosage)
   */
  private looksLikeIngredient(text: string): boolean {
    const trimmed = text.trim().toLowerCase();

    // Too short to be an ingredient
    if (trimmed.length < 3) return false;

    // Starts with number (likely dosage like "10 mg")
    if (/^\d/.test(trimmed)) return false;

    // Contains only numbers and units
    if (/^[\d.,]+\s*(mg|g|ml|l|iu|me|μg|mcg)$/i.test(trimmed)) return false;

    // Pharmaceutical form words (not ingredients)
    const formWords = [
      'tabletta', 'filmtabletta', 'kapszula', 'injekció', 'oldat',
      'tablet', 'capsule', 'injection', 'solution', 'cream', 'gel',
      'por', 'powder', 'spray', 'inhaler', 'patch', 'tapasz',
      'csepp', 'drops', 'syrup', 'szirup', 'suspension', 'szuszpenzió'
    ];
    if (formWords.some(w => trimmed.includes(w))) return false;

    return true;
  }

  /**
   * Clean up an ingredient string
   */
  private cleanIngredient(ingredient: string): string {
    return ingredient
      .trim()
      // Remove leading/trailing punctuation
      .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
      // Normalize multiple spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if ingredient needs ATC-based lookup (generic placeholder present)
   */
  needsAtcFallback(parsed: ParsedIngredients): boolean {
    return parsed.isGenericPlaceholder || parsed.ingredients.length === 0;
  }

  /**
   * Get the list of generic placeholder terms
   */
  getGenericPlaceholders(): string[] {
    return [...GENERIC_PLACEHOLDERS];
  }
}

export const ingredientParserService = new IngredientParserService();
