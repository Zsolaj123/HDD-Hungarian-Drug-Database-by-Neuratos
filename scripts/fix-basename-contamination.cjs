/**
 * Fix baseName Contamination in Drug Database
 *
 * The baseName field has been contaminated with Hungarian form suffixes like:
 * - OLDATOS, OLDAT, OLDÓSZER
 * - INJEKCIÓ, INFÚZIÓ, INFÚZIÓHOZ
 * - KONCENTRÁTUM, KONCENTRÁTUMOS
 * - TABLETTA, KAPSZULA, KEMÉNY
 * - POR, GRANULÁTUM
 * etc.
 *
 * This script properly extracts the drug brand name from the full drug name.
 */

const fs = require('fs');
const path = require('path');

// Hungarian pharmaceutical form suffixes to remove
const HUNGARIAN_FORM_SUFFIXES = [
  // Solution/liquid forms
  'OLDATOS', 'OLDAT', 'OLDÓSZER', 'OLDÓSZERES',
  // Injection/infusion
  'INJEKCIÓ', 'INJEKCIÓHOZ', 'INFÚZIÓ', 'INFÚZIÓHOZ',
  'KONCENTRÁTUM', 'KONCENTRÁTUMOS',
  // Oral forms
  'TABLETTA', 'TABLETTÁHOZ', 'KAPSZULA', 'KAPSZULÁK',
  'KEMÉNY', 'LÁGY', 'BEVONT', 'FILMTABLETTA',
  'RÁGÓTABLETTA', 'PEZSGŐTABLETTA', 'SZOPOGATÓ',
  // Powder/granules
  'POR', 'PORHOZ', 'GRANULÁTUM', 'GRANULÁTUMOS',
  // Topical
  'KRÉM', 'KENŐCS', 'GÉL', 'EMULZIÓ', 'OLAJ',
  'SPRAY', 'ORRSPRAY', 'INHALÁCIÓ', 'ADAGOLÓS',
  // Suppository
  'KÚP', 'VÉGBÉLKÚP',
  // Eye/ear
  'SZEMCSEPP', 'FÜLCSEPP', 'SZEMKENŐCS',
  // Patches
  'TAPASZ', 'TRANSZDERMÁLIS',
  // Other forms
  'DISZPERZIÓS', 'SZUSZPENZIÓ', 'EMULZIÓS',
  'IMPLANTÁTUM', 'DEPOT', 'RETARD',
  // Packaging
  'PATRONBAN', 'FECSKENDŐBEN', 'ÜVEGBEN', 'AMPULLÁBAN',
  'KÉSZLET', 'ELŐRETÖLTÖTT', 'TOLL',
  // Action words
  'ALKALMAZOTT', 'ALKALMAZANDÓ', 'BEADÁSRA', 'HASZNÁLATRA',
  'VALÓ', 'VAGY', 'VAGYHOZ', 'ÉS', 'ÉSA',
  // Common Hungarian suffixes attached to drug names
  'OS', 'AS', 'ES', 'ÖS', 'AZ', 'EZ', 'OZ',
  // Extra forms
  'ELEKTROLITSZEGÉNY', 'MENTOL', 'BIFONAZOL',
  'SZÁJNYÁLKAHÁRTYÁN', 'TÚLNYOMÁS', 'TÚLNYOMÁSOS',
  'VÉGBÉL', 'VÉGBÉLOLDAT', 'ADAG'
];

// Units and dosage patterns to strip
const DOSAGE_PATTERNS = [
  /\d+(?:[.,]\d+)?\s*(?:MG|G|ML|MCG|µG|µG|NE|IU|U|EGYSÉG|E)(?:\/(?:ML|G|L|KG|M2|DAY|ADAG|NAP))?\s*/gi,
  /\d+(?:[.,]\d+)?\s*(?:MILLIÓ|MILLIÁRD|EZER)\s*/gi,
  /\d+(?:[.,]\d+)?\s*(?:MIKROGRAMM|MILLIGRAMM|GRAMM|LITER|MILLILITER)\s*/gi,
  /\d+(?:[-/]\d+)?\s*/g,  // Ranges like 10-20 or 10/20
  /\+\s*/g,  // Plus signs between doses
  /X\s*\d+\s*/gi,  // Multipliers like x10
  /\s*\/\s*(?:ML|L|G|KG)\s*/gi,  // Per-unit indicators
  /NEMZETKÖZI\s+EGYSÉG/gi,
];

// Manufacturer suffixes that should NOT be part of baseName
const MANUFACTURER_PATTERNS = [
  /-?(?:TEVA|SANDOZ|GENERICON|KRKA|ACCORD|MYLAN|ZENTIVA|STADA|EGIS|RICHTER|GEDEON|PHARMA|HEXAL|RATIOPHARM|ACTAVIS|BIOTECH|ROMPHARM|ANFARM|FRESENIUS|KABI|BAXTER|PFIZER|NOVARTIS|SANOFI|ROCHE|LILLY|MERCK|ABBOTT|BAYER|GSK|ASTRAZENECA|JOHNSON|JANSSEN|BOEHRINGER|TAKEDA|SERVIER|BERLIN|AZEVEDOS|APTAPHARMA|ONKOGEN|SINTETICA)(?:\s|$)/gi
];

/**
 * Extract clean baseName from full drug name
 * @param {string} fullName - Full drug name like "OCREVUS 920 MG OLDATOS INJEKCIÓ"
 * @param {string} brandName - Known brand name if available
 * @returns {string} Clean baseName like "OCREVUS"
 */
function extractBaseName(fullName, brandName) {
  if (!fullName) return '';

  let baseName = fullName.toUpperCase().trim();

  // If brandName is provided and valid, use it directly
  if (brandName && brandName.length > 2 && !brandName.includes(' ')) {
    return brandName.toUpperCase();
  }

  // Remove dosage patterns first
  for (const pattern of DOSAGE_PATTERNS) {
    baseName = baseName.replace(pattern, ' ');
  }

  // Remove manufacturer patterns
  for (const pattern of MANUFACTURER_PATTERNS) {
    baseName = baseName.replace(pattern, ' ');
  }

  // Remove Hungarian form suffixes
  for (const suffix of HUNGARIAN_FORM_SUFFIXES) {
    // Match the suffix as a separate word or attached to previous word
    const pattern = new RegExp(`\\b${suffix}\\b|(?<=[A-ZÁÉÍÓÖŐÚÜŰ])${suffix}$`, 'gi');
    baseName = baseName.replace(pattern, ' ');
  }

  // Clean up multiple spaces and trim
  baseName = baseName.replace(/\s+/g, ' ').trim();

  // Get the first meaningful word(s) - typically the drug brand name
  const words = baseName.split(' ').filter(w => w.length > 1);

  if (words.length === 0) {
    // Fallback to first word of original name
    return fullName.split(' ')[0].toUpperCase();
  }

  // For compound names, take up to first 2-3 words that make sense
  // But stop at common suffixes or form words
  const stopWords = new Set([
    'POR', 'OLDATOS', 'INJEKCIÓ', 'TABLETTA', 'KAPSZULA',
    'KRÉM', 'GÉL', 'SPRAY', 'INFÚZIÓ', 'KONCENTRÁTUM',
    'DISZPERZIÓS', 'KEMÉNY', 'FILMTABLETTA', 'BEVONT'
  ]);

  const result = [];
  for (const word of words) {
    if (stopWords.has(word) || HUNGARIAN_FORM_SUFFIXES.includes(word)) {
      break;
    }
    result.push(word);
    // Typically drug names are 1-3 words max
    if (result.length >= 3) break;
  }

  return result.join(' ') || words[0];
}

/**
 * Validate baseName doesn't contain form words
 */
function isValidBaseName(baseName) {
  const invalid = [
    'OLDATOS', 'INJEKCIÓ', 'INFÚZIÓ', 'TABLETTA', 'KAPSZULA',
    'KONCENTRÁTUMOS', 'KONCENTRÁTUM', 'DISZPERZIÓS', 'OLDÓSZEROS',
    'INFÚZIÓHOZ', 'INJEKCIÓHOZ', 'SZEMCSEPP', 'POR'
  ];

  for (const word of invalid) {
    if (baseName.includes(word)) {
      return false;
    }
  }

  return true;
}

/**
 * Process and fix drug database
 */
function fixDrugDatabase(inputPath, outputPath) {
  console.log(`Reading ${inputPath}...`);
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  let fixCount = 0;
  let totalDrugs = data.drugs?.length || 0;

  const fixedNames = [];

  if (data.drugs) {
    for (const drug of data.drugs) {
      const originalBaseName = drug.baseName;
      const newBaseName = extractBaseName(drug.name, drug.brandName);

      // Check if fix is needed
      if (!isValidBaseName(originalBaseName) || originalBaseName !== newBaseName) {
        // Only log if it's actually a fix (not just a normalization)
        if (originalBaseName !== newBaseName &&
            (originalBaseName.includes('OS') ||
             originalBaseName.includes('INFÚZIÓ') ||
             originalBaseName.includes('KONCENTRÁTUM') ||
             originalBaseName.includes('OLDATO'))) {
          fixedNames.push({
            name: drug.name,
            oldBaseName: originalBaseName,
            newBaseName: newBaseName
          });
        }
        drug.baseName = newBaseName;
        fixCount++;
      }
    }
  }

  console.log(`\nFixed ${fixCount} of ${totalDrugs} entries.`);

  if (fixedNames.length > 0) {
    console.log('\nSample of fixed entries:');
    fixedNames.slice(0, 20).forEach(f => {
      console.log(`  "${f.name}"`);
      console.log(`    OLD: "${f.oldBaseName}"`);
      console.log(`    NEW: "${f.newBaseName}"`);
    });
  }

  // Write fixed data
  console.log(`\nWriting fixed database to ${outputPath}...`);
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log('Done!');

  return { fixCount, totalDrugs, fixedNames };
}

// Main execution
const cleanDbPath = path.join(__dirname, '../static/data/drugs/drug-database-clean.json');

// Check if file exists
if (!fs.existsSync(cleanDbPath)) {
  console.error(`Database not found at ${cleanDbPath}`);
  process.exit(1);
}

// Create backup
const backupPath = cleanDbPath.replace('.json', '-backup.json');
console.log(`Creating backup at ${backupPath}...`);
fs.copyFileSync(cleanDbPath, backupPath);

// Fix the database
const result = fixDrugDatabase(cleanDbPath, cleanDbPath);

console.log('\n=== Summary ===');
console.log(`Total drugs processed: ${result.totalDrugs}`);
console.log(`Entries fixed: ${result.fixCount}`);
console.log(`Notable fixes: ${result.fixedNames.length}`);
