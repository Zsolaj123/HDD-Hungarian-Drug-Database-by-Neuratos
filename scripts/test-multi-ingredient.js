/**
 * Quick test script for multi-ingredient parsing
 */

const testCases = [
  { input: 'lamivudine and abacavir', expectedCount: 2 },
  { input: 'ezetimib és roszuvasztatin', expectedCount: 2 },
  { input: 'emtricitabine, tenofovir alafenamide and bictegravir', expectedCount: 3 },
  { input: 'perindopril, amlodipine and indapamide', expectedCount: 3 },
  { input: 'irbesartan and diuretics', expectedCount: 2, isPlaceholder: true },
  { input: 'valsartan, amlodipin és hydrochlorothiazid', expectedCount: 3 },
  { input: 'metformin', expectedCount: 1 },
  { input: '', expectedCount: 0 }
];

const GENERIC_PLACEHOLDERS = ['diuretics', 'diuretikumok', 'combinations', 'kombinációk'];

function parseIngredients(ingredientString) {
  if (!ingredientString || ingredientString.trim() === '') {
    return { ingredients: [], isMultiIngredient: false, isGenericPlaceholder: false };
  }

  const trimmed = ingredientString.trim();
  const isGenericPlaceholder = GENERIC_PLACEHOLDERS.some(p => trimmed.toLowerCase().includes(p));

  // Pattern 1: comma + and/és (3+ ingredients)
  const commaAndPattern = /^(.+),\s*(.+?)\s+(?:and|és)\s+(.+)$/i;
  let match = trimmed.match(commaAndPattern);
  if (match) {
    const firstParts = match[1].split(/,\s*/).map(s => s.trim()).filter(s => s);
    return {
      ingredients: [...firstParts, match[2].trim(), match[3].trim()],
      isMultiIngredient: true,
      isGenericPlaceholder
    };
  }

  // Pattern 2: simple and/és (2 ingredients)
  const andPattern = /^(.+?)\s+(?:and|és)\s+(.+)$/i;
  match = trimmed.match(andPattern);
  if (match) {
    return {
      ingredients: [match[1].trim(), match[2].trim()],
      isMultiIngredient: true,
      isGenericPlaceholder
    };
  }

  return {
    ingredients: [trimmed],
    isMultiIngredient: false,
    isGenericPlaceholder
  };
}

console.log('Testing multi-ingredient parser...\n');
let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = parseIngredients(tc.input);
  const countMatch = result.ingredients.length === tc.expectedCount;
  const placeholderMatch = tc.isPlaceholder ? result.isGenericPlaceholder : true;

  if (countMatch && placeholderMatch) {
    console.log(`✅ PASS: "${tc.input}" → ${result.ingredients.length} ingredients`);
    if (result.isMultiIngredient) {
      console.log(`   Parsed: [${result.ingredients.join(', ')}]`);
    }
    passed++;
  } else {
    console.log(`❌ FAIL: "${tc.input}"`);
    console.log(`   Expected: ${tc.expectedCount}, Got: ${result.ingredients.length}`);
    console.log(`   Ingredients: [${result.ingredients.join(', ')}]`);
    failed++;
  }
}

console.log(`\n${passed}/${testCases.length} tests passed`);
