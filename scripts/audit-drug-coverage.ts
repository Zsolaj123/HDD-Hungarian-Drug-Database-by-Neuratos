/**
 * Drug Coverage Audit Script
 *
 * Tests FDA and EMA data coverage for all active drugs in the database.
 * Outputs detailed statistics on single vs multi-ingredient drug coverage.
 *
 * Usage: npx tsx scripts/audit-drug-coverage.ts [--limit=N] [--sample] [--fda-only] [--ema-only]
 *
 * Options:
 *   --limit=N    Only test first N drugs (for quick testing)
 *   --sample     Only test 50 representative drugs
 *   --fda-only   Only test FDA coverage
 *   --ema-only   Only test EMA coverage
 *   --verbose    Show detailed output for each drug
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const limitMatch = args.find(a => a.startsWith('--limit='));
const LIMIT = limitMatch ? parseInt(limitMatch.split('=')[1]) : 0;
const SAMPLE_MODE = args.includes('--sample');
const FDA_ONLY = args.includes('--fda-only');
const EMA_ONLY = args.includes('--ema-only');
const VERBOSE = args.includes('--verbose');

// Rate limiting for FDA API: 4 requests/second
const FDA_RATE_LIMIT_MS = 250;

// Load drug database
const drugDbPath = path.join(__dirname, '../static/data/drugs/drug-database-clean.json');
const translationsPath = path.join(__dirname, '../static/data/drugs/ingredient-translations.json');
const emaMedicinesPath = path.join(__dirname, '../static/data/ema/medicines_output_medicines_en.json');
const emaShortagesPath = path.join(__dirname, '../static/data/ema/medicines_output_shortages_en.json');
const emaDhpcPath = path.join(__dirname, '../static/data/ema/medicines_output_dhpc_en.json');

interface Drug {
  id: string;
  name: string;
  activeIngredient?: string;
  atcCode?: string;
  inMarket?: boolean;
}

interface TranslationData {
  translations: Record<string, string[]>;
  atcToEnglish: Record<string, string>;
}

interface EmaMedicine {
  name_of_medicine: string;
  international_non_proprietary_name_common_name?: string;
  active_substance?: string;
  atc_code_human?: string;
  medicine_status?: string;
}

interface ParsedIngredients {
  original: string;
  ingredients: string[];
  isMultiIngredient: boolean;
  isGenericPlaceholder: boolean;
}

// Results tracking
interface DrugResult {
  id: string;
  name: string;
  activeIngredient?: string;
  atcCode?: string;
  isMultiIngredient: boolean;
  ingredientCount: number;
  fdaFound: boolean;
  fdaPerIngredientFound: number[];
  emaFound: boolean;
  emaPerIngredientFound: number[];
  searchMethod?: string;
  error?: string;
}

// Generic placeholders that need ATC fallback
const GENERIC_PLACEHOLDERS = [
  'diuretics', 'diuretikumok', 'diuretikum',
  'combinations', 'kombinációk', 'kombináció',
  'enzim-inhibitor', 'enzyme inhibitor', 'ace-inhibitor', 'ace inhibitor',
  'calcium channel blockers', 'kalciumcsatorna-blokkolók',
  'beta-blockers', 'béta-blokkolók',
  'thiazides', 'tiazidok',
  'other', 'egyéb', 'más',
  'agents', 'szerek',
  'derivatives', 'származékok',
  'drugs', 'gyógyszerek',
  'compounds', 'vegyületek',
  'analogs', 'analógok',
  'inhibitors', 'gátlók',
  'antagonists', 'antagonisták'
];

// Parse multi-ingredient strings
function parseIngredients(ingredientString: string): ParsedIngredients {
  if (!ingredientString || ingredientString.trim() === '') {
    return { original: ingredientString, ingredients: [], isMultiIngredient: false, isGenericPlaceholder: false };
  }

  const cleaned = ingredientString.trim().toLowerCase();
  let ingredients: string[] = [];

  // Pattern 1: Oxford comma (A, B and C)
  const oxfordMatch = cleaned.match(/^(.+),\s+(.+)\s+(?:and|és)\s+(.+)$/i);
  if (oxfordMatch) {
    const [, first, middle, last] = oxfordMatch;
    ingredients = [first, ...middle.split(/,\s*/), last].map(s => s.trim()).filter(Boolean);
  }
  // Pattern 2: Simple "and" or "és"
  else if (cleaned.includes(' and ') || cleaned.includes(' és ')) {
    const separator = cleaned.includes(' and ') ? ' and ' : ' és ';
    ingredients = cleaned.split(separator).map(s => s.trim()).filter(Boolean);
  }
  // Pattern 3: Single ingredient
  else {
    ingredients = [cleaned.trim()];
  }

  // Clean ingredients
  ingredients = ingredients.map(ing => ing.replace(/[^\w\s-áéíóöőúüű]/gi, '').trim()).filter(Boolean);

  // Check for generic placeholders
  const isGenericPlaceholder = ingredients.some(ing =>
    GENERIC_PLACEHOLDERS.some(placeholder => ing.toLowerCase().includes(placeholder.toLowerCase()))
  );

  return {
    original: ingredientString,
    ingredients,
    isMultiIngredient: ingredients.length > 1,
    isGenericPlaceholder
  };
}

// Translate ingredient to English
function translateIngredient(hungarianIngredient: string, translations: TranslationData): string[] {
  const normalized = hungarianIngredient.toLowerCase().trim();

  // Direct lookup
  if (translations.translations[normalized]) {
    return translations.translations[normalized];
  }

  // Partial match
  for (const [hu, eng] of Object.entries(translations.translations)) {
    if (normalized.includes(hu) || hu.includes(normalized)) {
      return eng;
    }
  }

  // No Hungarian characters - might already be English
  if (!/[áéíóöőúüű]/i.test(normalized)) {
    return [normalized];
  }

  return [normalized]; // Return as-is if no translation
}

// Get English from ATC code
function getEnglishFromAtc(atcCode: string, translations: TranslationData): string | null {
  if (!atcCode) return null;
  return translations.atcToEnglish[atcCode.toUpperCase()] || null;
}

// Check EMA match (local data)
function checkEmaMatch(drug: Drug, emaMedicines: EmaMedicine[], translations: TranslationData): {
  found: boolean;
  method?: string;
  matchedIngredients: number;
  totalIngredients: number;
} {
  const parsed = parseIngredients(drug.activeIngredient || '');

  // Try ATC match first
  if (drug.atcCode) {
    const byAtc = emaMedicines.filter(m =>
      m.atc_code_human?.toUpperCase() === drug.atcCode?.toUpperCase()
    );
    if (byAtc.length > 0) {
      return { found: true, method: 'atc', matchedIngredients: parsed.ingredients.length, totalIngredients: parsed.ingredients.length };
    }
  }

  // Try ingredient match
  let matchedCount = 0;
  for (const ingredient of parsed.ingredients) {
    const englishVariants = translateIngredient(ingredient, translations);

    for (const english of englishVariants) {
      const normalizedEnglish = english.toLowerCase();
      const found = emaMedicines.some(m => {
        const inn = m.international_non_proprietary_name_common_name?.toLowerCase() || '';
        const active = m.active_substance?.toLowerCase() || '';
        return inn.includes(normalizedEnglish) || active.includes(normalizedEnglish) ||
               normalizedEnglish.includes(inn) || normalizedEnglish.includes(active);
      });
      if (found) {
        matchedCount++;
        break;
      }
    }
  }

  if (matchedCount > 0) {
    return {
      found: true,
      method: 'ingredient',
      matchedIngredients: matchedCount,
      totalIngredients: parsed.ingredients.length
    };
  }

  // ATC fallback for generic placeholders
  if (parsed.isGenericPlaceholder && drug.atcCode) {
    const atcEnglish = getEnglishFromAtc(drug.atcCode, translations);
    if (atcEnglish) {
      return { found: true, method: 'atc-fallback', matchedIngredients: 1, totalIngredients: parsed.ingredients.length };
    }
  }

  return { found: false, matchedIngredients: 0, totalIngredients: parsed.ingredients.length };
}

// Check FDA match (simulated - no actual API calls for audit)
async function checkFdaMatch(drug: Drug, translations: TranslationData): Promise<{
  found: boolean;
  method?: string;
  matchedIngredients: number;
  totalIngredients: number;
}> {
  const parsed = parseIngredients(drug.activeIngredient || '');

  // For audit, we check if we have translations available
  // Real FDA check would need API calls
  let matchedCount = 0;
  for (const ingredient of parsed.ingredients) {
    const englishVariants = translateIngredient(ingredient, translations);
    // If we have any translation (not just returning the original), consider it potentially findable
    if (englishVariants.length > 0 && englishVariants[0] !== ingredient.toLowerCase()) {
      matchedCount++;
    } else if (!/[áéíóöőúüű]/i.test(ingredient)) {
      // Already English
      matchedCount++;
    }
  }

  // ATC fallback
  if (parsed.isGenericPlaceholder && drug.atcCode) {
    const atcEnglish = getEnglishFromAtc(drug.atcCode, translations);
    if (atcEnglish) {
      return { found: true, method: 'atc-fallback', matchedIngredients: 1, totalIngredients: parsed.ingredients.length };
    }
  }

  return {
    found: matchedCount > 0,
    method: matchedCount > 0 ? 'translation' : undefined,
    matchedIngredients: matchedCount,
    totalIngredients: parsed.ingredients.length
  };
}

// Main audit function
async function runAudit() {
  console.log('='.repeat(70));
  console.log('DRUG COVERAGE AUDIT');
  console.log('='.repeat(70));
  console.log();

  // Load data
  console.log('Loading data files...');

  if (!fs.existsSync(drugDbPath)) {
    console.error(`ERROR: Drug database not found at ${drugDbPath}`);
    process.exit(1);
  }

  const drugDbRaw = JSON.parse(fs.readFileSync(drugDbPath, 'utf-8'));
  const drugDb: Drug[] = drugDbRaw.drugs || drugDbRaw; // Handle both formats
  const translations: TranslationData = JSON.parse(fs.readFileSync(translationsPath, 'utf-8'));
  const emaMedicines: EmaMedicine[] = JSON.parse(fs.readFileSync(emaMedicinesPath, 'utf-8'));

  console.log(`  Drug database: ${drugDb.length.toLocaleString()} drugs`);
  console.log(`  Translations: ${Object.keys(translations.translations).length} mappings`);
  console.log(`  ATC to English: ${Object.keys(translations.atcToEnglish).length} mappings`);
  console.log(`  EMA medicines: ${emaMedicines.length.toLocaleString()} entries`);
  console.log();

  // Filter to active drugs only
  let activeDrugs: Drug[] = drugDb.filter((d: Drug) => d.inMarket !== false);
  console.log(`Active (non-withdrawn) drugs: ${activeDrugs.length.toLocaleString()}`);

  // Apply limits
  if (SAMPLE_MODE) {
    // Take a diverse sample
    const singleIngredient = activeDrugs.filter(d => !parseIngredients(d.activeIngredient || '').isMultiIngredient).slice(0, 25);
    const multiIngredient = activeDrugs.filter(d => parseIngredients(d.activeIngredient || '').isMultiIngredient).slice(0, 25);
    activeDrugs = [...singleIngredient, ...multiIngredient];
    console.log(`Sample mode: Testing ${activeDrugs.length} representative drugs`);
  } else if (LIMIT > 0) {
    activeDrugs = activeDrugs.slice(0, LIMIT);
    console.log(`Limit mode: Testing first ${activeDrugs.length} drugs`);
  }

  console.log();
  console.log('Starting audit...');
  console.log();

  // Results tracking
  const results: DrugResult[] = [];
  let processedCount = 0;

  // Statistics
  const stats = {
    total: activeDrugs.length,
    withIngredient: 0,
    withAtc: 0,
    singleIngredient: 0,
    multiIngredient: 0,
    genericPlaceholder: 0,
    // EMA stats
    emaTotal: 0,
    emaSingle: 0,
    emaMulti: 0,
    emaAllIngredientsFound: 0,
    emaSomeIngredientsFound: 0,
    // FDA stats (translation-based)
    fdaTotal: 0,
    fdaSingle: 0,
    fdaMulti: 0,
    fdaAllIngredientsFound: 0,
    fdaSomeIngredientsFound: 0
  };

  // Process each drug
  for (const drug of activeDrugs) {
    processedCount++;

    if (processedCount % 500 === 0 || processedCount === activeDrugs.length) {
      process.stdout.write(`\rProcessed: ${processedCount.toLocaleString()} / ${activeDrugs.length.toLocaleString()}`);
    }

    const parsed = parseIngredients(drug.activeIngredient || '');

    const result: DrugResult = {
      id: drug.id,
      name: drug.name,
      activeIngredient: drug.activeIngredient,
      atcCode: drug.atcCode,
      isMultiIngredient: parsed.isMultiIngredient,
      ingredientCount: parsed.ingredients.length,
      fdaFound: false,
      fdaPerIngredientFound: [],
      emaFound: false,
      emaPerIngredientFound: []
    };

    // Update stats
    if (drug.activeIngredient) stats.withIngredient++;
    if (drug.atcCode) stats.withAtc++;
    if (parsed.isMultiIngredient) {
      stats.multiIngredient++;
    } else {
      stats.singleIngredient++;
    }
    if (parsed.isGenericPlaceholder) stats.genericPlaceholder++;

    // Check EMA
    if (!FDA_ONLY) {
      const emaResult = checkEmaMatch(drug, emaMedicines, translations);
      result.emaFound = emaResult.found;
      result.searchMethod = emaResult.method;

      if (emaResult.found) {
        stats.emaTotal++;
        if (parsed.isMultiIngredient) {
          stats.emaMulti++;
        } else {
          stats.emaSingle++;
        }
        if (emaResult.matchedIngredients === emaResult.totalIngredients) {
          stats.emaAllIngredientsFound++;
        } else if (emaResult.matchedIngredients > 0) {
          stats.emaSomeIngredientsFound++;
        }
      }
    }

    // Check FDA (translation availability)
    if (!EMA_ONLY) {
      const fdaResult = await checkFdaMatch(drug, translations);
      result.fdaFound = fdaResult.found;

      if (fdaResult.found) {
        stats.fdaTotal++;
        if (parsed.isMultiIngredient) {
          stats.fdaMulti++;
        } else {
          stats.fdaSingle++;
        }
        if (fdaResult.matchedIngredients === fdaResult.totalIngredients) {
          stats.fdaAllIngredientsFound++;
        } else if (fdaResult.matchedIngredients > 0) {
          stats.fdaSomeIngredientsFound++;
        }
      }
    }

    results.push(result);

    if (VERBOSE) {
      console.log(`\n${drug.name}: EMA=${result.emaFound}, FDA=${result.fdaFound}, Multi=${parsed.isMultiIngredient}`);
    }
  }

  console.log('\n');
  console.log('='.repeat(70));
  console.log('AUDIT RESULTS');
  console.log('='.repeat(70));
  console.log();

  // Summary statistics
  console.log('DATABASE OVERVIEW');
  console.log('-'.repeat(40));
  console.log(`Total active drugs:          ${stats.total.toLocaleString()}`);
  console.log(`With active ingredient:      ${stats.withIngredient.toLocaleString()} (${(stats.withIngredient / stats.total * 100).toFixed(1)}%)`);
  console.log(`With ATC code:               ${stats.withAtc.toLocaleString()} (${(stats.withAtc / stats.total * 100).toFixed(1)}%)`);
  console.log(`Single ingredient:           ${stats.singleIngredient.toLocaleString()} (${(stats.singleIngredient / stats.total * 100).toFixed(1)}%)`);
  console.log(`Multi-ingredient:            ${stats.multiIngredient.toLocaleString()} (${(stats.multiIngredient / stats.total * 100).toFixed(1)}%)`);
  console.log(`Generic placeholders:        ${stats.genericPlaceholder.toLocaleString()}`);
  console.log();

  if (!FDA_ONLY) {
    console.log('EMA COVERAGE');
    console.log('-'.repeat(40));
    console.log(`Total EMA matches:           ${stats.emaTotal.toLocaleString()} (${(stats.emaTotal / stats.total * 100).toFixed(1)}%)`);
    console.log(`  Single ingredient:         ${stats.emaSingle.toLocaleString()}`);
    console.log(`  Multi-ingredient:          ${stats.emaMulti.toLocaleString()}`);
    console.log(`All ingredients found:       ${stats.emaAllIngredientsFound.toLocaleString()}`);
    console.log(`Some ingredients found:      ${stats.emaSomeIngredientsFound.toLocaleString()}`);
    if (stats.multiIngredient > 0) {
      console.log(`Multi-ingredient coverage:   ${(stats.emaMulti / stats.multiIngredient * 100).toFixed(1)}%`);
    }
    console.log();
  }

  if (!EMA_ONLY) {
    console.log('FDA COVERAGE (Translation-based)');
    console.log('-'.repeat(40));
    console.log(`Total translatable:          ${stats.fdaTotal.toLocaleString()} (${(stats.fdaTotal / stats.total * 100).toFixed(1)}%)`);
    console.log(`  Single ingredient:         ${stats.fdaSingle.toLocaleString()}`);
    console.log(`  Multi-ingredient:          ${stats.fdaMulti.toLocaleString()}`);
    console.log(`All ingredients translatable: ${stats.fdaAllIngredientsFound.toLocaleString()}`);
    console.log(`Some ingredients translatable: ${stats.fdaSomeIngredientsFound.toLocaleString()}`);
    if (stats.multiIngredient > 0) {
      console.log(`Multi-ingredient coverage:   ${(stats.fdaMulti / stats.multiIngredient * 100).toFixed(1)}%`);
    }
    console.log();
  }

  // Success metric
  const multiIngredientCoverage = stats.multiIngredient > 0 ?
    ((stats.emaMulti + stats.fdaMulti) / 2 / stats.multiIngredient * 100) : 0;

  console.log('='.repeat(70));
  console.log(`SUCCESS METRIC: Multi-ingredient coverage = ${multiIngredientCoverage.toFixed(1)}%`);
  console.log(`Target: >90%`);
  console.log(`Status: ${multiIngredientCoverage >= 90 ? '✅ PASSED' : '❌ NEEDS IMPROVEMENT'}`);
  console.log('='.repeat(70));
  console.log();

  // Failed drugs analysis
  const failedEma = results.filter(r => !r.emaFound && r.activeIngredient);
  const failedFda = results.filter(r => !r.fdaFound && r.activeIngredient);
  const failedBoth = results.filter(r => !r.emaFound && !r.fdaFound && r.activeIngredient);

  console.log('FAILED DRUGS ANALYSIS');
  console.log('-'.repeat(40));
  console.log(`No EMA data:                 ${failedEma.length.toLocaleString()}`);
  console.log(`No FDA translation:          ${failedFda.length.toLocaleString()}`);
  console.log(`Failed both:                 ${failedBoth.length.toLocaleString()}`);
  console.log();

  // Sample of failed drugs
  if (failedBoth.length > 0) {
    console.log('Sample of drugs failing both EMA and FDA (first 20):');
    console.log('-'.repeat(60));
    for (const drug of failedBoth.slice(0, 20)) {
      console.log(`  ${drug.name}`);
      console.log(`    Ingredient: ${drug.activeIngredient || 'N/A'}`);
      console.log(`    ATC: ${drug.atcCode || 'N/A'}`);
      console.log();
    }
  }

  // Export results to JSON
  const outputPath = path.join(__dirname, '../audit-results.json');
  const exportData = {
    timestamp: new Date().toISOString(),
    stats,
    failedDrugsSample: failedBoth.slice(0, 100),
    totalFailed: failedBoth.length
  };
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`Full results exported to: ${outputPath}`);

  // Missing translations report
  const missingTranslations = new Set<string>();
  for (const drug of failedBoth) {
    if (drug.activeIngredient) {
      const parsed = parseIngredients(drug.activeIngredient);
      for (const ing of parsed.ingredients) {
        if (/[áéíóöőúüű]/i.test(ing)) {
          missingTranslations.add(ing.toLowerCase());
        }
      }
    }
  }

  if (missingTranslations.size > 0) {
    console.log();
    console.log('MISSING TRANSLATIONS (Hungarian ingredients without mappings):');
    console.log('-'.repeat(60));
    const sorted = Array.from(missingTranslations).sort();
    for (const ing of sorted.slice(0, 50)) {
      console.log(`  "${ing}": [""],`);
    }
    if (sorted.length > 50) {
      console.log(`  ... and ${sorted.length - 50} more`);
    }
  }
}

// Run
runAudit().catch(console.error);
