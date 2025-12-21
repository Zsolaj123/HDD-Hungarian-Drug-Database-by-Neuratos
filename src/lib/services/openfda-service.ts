/**
 * OpenFDA Drug Label API Service
 *
 * Fetches clinical drug information from the FDA drug label database:
 * - Contraindications
 * - Drug interactions
 * - Warnings and precautions
 * - Adverse reactions
 *
 * Free API, no key required. Rate limit: 240 requests/minute.
 * Data is US-focused but clinically applicable internationally.
 *
 * Enhanced with Hungarian ingredient translation support.
 */

import { ingredientTranslationService } from './ingredient-translation-service';
import { ingredientParserService, type ParsedIngredients } from './ingredient-parser-service';

const OPENFDA_BASE_URL = 'https://api.fda.gov/drug/label.json';

export interface OpenFdaDrugLabel {
	brandName: string;
	genericName: string;
	manufacturer: string;
	contraindications: string | null;
	drugInteractions: string | null;
	warningsAndCautions: string | null;
	boxedWarning: string | null;
	adverseReactions: string | null;
	indicationsAndUsage: string | null;
	dosageAndAdministration: string | null;
	pregnancy: string | null;
	pediatricUse: string | null;
	geriatricUse: string | null;
	mechanismOfAction: string | null;
	// Metadata
	setId: string;
	effectiveTime: string;
}

export interface OpenFdaSearchResult {
	found: boolean;
	label: OpenFdaDrugLabel | null;
	error: string | null;
	searchedBy: 'brand_name' | 'generic_name' | 'active_ingredient';
}

/**
 * Result for multi-ingredient drug lookups
 * Contains per-ingredient results for tabbed display
 */
export interface OpenFdaMultiIngredientResult {
	matchedByAny: boolean;
	combinationMatch?: OpenFdaSearchResult; // Direct combination found via brand name
	perIngredient: {
		ingredient: string;        // Original Hungarian ingredient
		englishName: string;       // Translated English name
		result?: OpenFdaSearchResult;
	}[];
	searchMethod: 'combination' | 'per-ingredient' | 'atc-fallback';
	isMultiIngredient: boolean;
	parsedIngredients: ParsedIngredients;
}

// Cache for API responses (5 minute TTL)
const cache = new Map<string, { data: OpenFdaSearchResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clean and normalize text from FDA labels
 */
function cleanLabelText(text: string | string[] | undefined): string | null {
	if (!text) return null;
	const content = Array.isArray(text) ? text.join('\n\n') : text;
	// Remove section numbers like "4 CONTRAINDICATIONS" or "7 DRUG INTERACTIONS" at the start
	// Match: digit(s) + optional decimal + space + consecutive ALL-CAPS words (not mixed case)
	// This preserves content that starts with uppercase like "Severe renal impairment"
	return content.replace(/^\d+(\.\d+)?\s+([A-Z]+\s+)+/g, '').trim() || null;
}

/**
 * Extract first meaningful paragraph (for summaries)
 */
function extractSummary(text: string | null, maxLength = 300): string | null {
	if (!text) return null;
	// Get first sentence or paragraph
	const firstPara = text.split(/\n\n/)[0];
	if (firstPara.length <= maxLength) return firstPara;
	return firstPara.substring(0, maxLength).trim() + '...';
}

/**
 * Parse OpenFDA API response into our format
 */
function parseLabel(result: Record<string, unknown>): OpenFdaDrugLabel {
	const openfda = (result.openfda as Record<string, string[]>) || {};

	// Handle both Rx (prescription) and OTC (over-the-counter) label formats
	// OTC labels use different field names: warnings, do_not_use, ask_doctor, etc.

	// Contraindications: Rx uses contraindications, OTC uses do_not_use
	const contraindications = cleanLabelText(result.contraindications as string[]) ||
		cleanLabelText(result.do_not_use as string[]);

	// Drug interactions: Rx uses drug_interactions, OTC uses ask_doctor/ask_doctor_or_pharmacist
	let drugInteractions = cleanLabelText(result.drug_interactions as string[]);
	if (!drugInteractions) {
		const askDoctor = cleanLabelText(result.ask_doctor as string[]);
		const askPharmacist = cleanLabelText(result.ask_doctor_or_pharmacist as string[]);
		if (askDoctor || askPharmacist) {
			drugInteractions = [askDoctor, askPharmacist].filter(Boolean).join('\n\n');
		}
	}

	// Warnings: Rx uses warnings_and_cautions, OTC uses warnings (+ stop_use)
	let warningsAndCautions = cleanLabelText(result.warnings_and_cautions as string[]);
	if (!warningsAndCautions) {
		const warnings = cleanLabelText(result.warnings as string[]);
		const stopUse = cleanLabelText(result.stop_use as string[]);
		if (warnings || stopUse) {
			warningsAndCautions = [warnings, stopUse ? `Stop use: ${stopUse}` : null].filter(Boolean).join('\n\n');
		}
	}

	// Pregnancy: Rx uses pregnancy, OTC uses pregnancy_or_breast_feeding
	const pregnancy = cleanLabelText(result.pregnancy as string[]) ||
		cleanLabelText(result.pregnancy_or_breast_feeding as string[]);

	return {
		brandName: openfda.brand_name?.[0] || '',
		genericName: openfda.generic_name?.[0] || '',
		manufacturer: openfda.manufacturer_name?.[0] || '',
		contraindications,
		drugInteractions,
		warningsAndCautions,
		boxedWarning: cleanLabelText(result.boxed_warning as string[]),
		adverseReactions: cleanLabelText(result.adverse_reactions as string[]),
		indicationsAndUsage: cleanLabelText(result.indications_and_usage as string[]),
		dosageAndAdministration: cleanLabelText(result.dosage_and_administration as string[]),
		pregnancy,
		pediatricUse: cleanLabelText(result.pediatric_use as string[]),
		geriatricUse: cleanLabelText(result.geriatric_use as string[]),
		mechanismOfAction: cleanLabelText(result.mechanism_of_action as string[]),
		setId: (result.set_id as string) || '',
		effectiveTime: (result.effective_time as string) || ''
	};
}

/**
 * Search OpenFDA by brand name
 */
async function searchByBrandName(brandName: string): Promise<OpenFdaSearchResult> {
	const query = encodeURIComponent(brandName.replace(/[^\w\s]/g, ''));
	const url = `${OPENFDA_BASE_URL}?search=openfda.brand_name:"${query}"&limit=1`;

	try {
		const response = await fetch(url);
		if (!response.ok) {
			if (response.status === 404) {
				return { found: false, label: null, error: null, searchedBy: 'brand_name' };
			}
			throw new Error(`API error: ${response.status}`);
		}

		const data = await response.json();
		if (!data.results || data.results.length === 0) {
			return { found: false, label: null, error: null, searchedBy: 'brand_name' };
		}

		return {
			found: true,
			label: parseLabel(data.results[0]),
			error: null,
			searchedBy: 'brand_name'
		};
	} catch (error) {
		console.error('[OpenFDA] Search error:', error);
		return {
			found: false,
			label: null,
			error: error instanceof Error ? error.message : 'Unknown error',
			searchedBy: 'brand_name'
		};
	}
}

/**
 * Search OpenFDA by generic/active ingredient name
 */
async function searchByGenericName(genericName: string): Promise<OpenFdaSearchResult> {
	const query = encodeURIComponent(genericName.replace(/[^\w\s-]/g, ''));
	const url = `${OPENFDA_BASE_URL}?search=openfda.generic_name:"${query}"&limit=1`;

	try {
		const response = await fetch(url);
		if (!response.ok) {
			if (response.status === 404) {
				return { found: false, label: null, error: null, searchedBy: 'generic_name' };
			}
			throw new Error(`API error: ${response.status}`);
		}

		const data = await response.json();
		if (!data.results || data.results.length === 0) {
			return { found: false, label: null, error: null, searchedBy: 'generic_name' };
		}

		return {
			found: true,
			label: parseLabel(data.results[0]),
			error: null,
			searchedBy: 'generic_name'
		};
	} catch (error) {
		console.error('[OpenFDA] Search error:', error);
		return {
			found: false,
			label: null,
			error: error instanceof Error ? error.message : 'Unknown error',
			searchedBy: 'generic_name'
		};
	}
}

/**
 * Search OpenFDA by active ingredient (substance_name field - more reliable)
 */
async function searchByActiveIngredient(ingredient: string): Promise<OpenFdaSearchResult> {
	const query = encodeURIComponent(ingredient.replace(/[^\w\s-]/g, '').toLowerCase());
	// Use active_ingredient field which is more reliable
	const url = `${OPENFDA_BASE_URL}?search=active_ingredient:"${query}"&limit=1`;

	try {
		const response = await fetch(url);
		if (!response.ok) {
			if (response.status === 404) {
				return { found: false, label: null, error: null, searchedBy: 'active_ingredient' };
			}
			throw new Error(`API error: ${response.status}`);
		}

		const data = await response.json();
		if (!data.results || data.results.length === 0) {
			return { found: false, label: null, error: null, searchedBy: 'active_ingredient' };
		}

		return {
			found: true,
			label: parseLabel(data.results[0]),
			error: null,
			searchedBy: 'active_ingredient'
		};
	} catch (error) {
		console.error('[OpenFDA] Active ingredient search error:', error);
		return {
			found: false,
			label: null,
			error: error instanceof Error ? error.message : 'Unknown error',
			searchedBy: 'active_ingredient'
		};
	}
}

class OpenFdaService {
	/**
	 * Get FDA drug label information
	 * Tries brand name first, then generic name
	 */
	async getDrugLabel(
		brandName: string,
		genericName?: string
	): Promise<OpenFdaSearchResult> {
		// Check cache first
		const cacheKey = `${brandName}|${genericName || ''}`.toLowerCase();
		const cached = cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
			return cached.data;
		}

		// Try brand name first
		let result = await searchByBrandName(brandName);

		// If not found by brand, try generic name
		if (!result.found && genericName) {
			result = await searchByGenericName(genericName);
		}

		// Cache the result
		cache.set(cacheKey, { data: result, timestamp: Date.now() });

		return result;
	}

	/**
	 * Get contraindications for a drug
	 */
	async getContraindications(
		brandName: string,
		genericName?: string
	): Promise<{ text: string | null; summary: string | null; found: boolean }> {
		const result = await this.getDrugLabel(brandName, genericName);
		if (!result.found || !result.label) {
			return { text: null, summary: null, found: false };
		}

		return {
			text: result.label.contraindications,
			summary: extractSummary(result.label.contraindications),
			found: true
		};
	}

	/**
	 * Get drug interactions
	 */
	async getDrugInteractions(
		brandName: string,
		genericName?: string
	): Promise<{ text: string | null; summary: string | null; found: boolean }> {
		const result = await this.getDrugLabel(brandName, genericName);
		if (!result.found || !result.label) {
			return { text: null, summary: null, found: false };
		}

		return {
			text: result.label.drugInteractions,
			summary: extractSummary(result.label.drugInteractions),
			found: true
		};
	}

	/**
	 * Get warnings and boxed warnings
	 */
	async getWarnings(
		brandName: string,
		genericName?: string
	): Promise<{
		warnings: string | null;
		boxedWarning: string | null;
		found: boolean;
	}> {
		const result = await this.getDrugLabel(brandName, genericName);
		if (!result.found || !result.label) {
			return { warnings: null, boxedWarning: null, found: false };
		}

		return {
			warnings: result.label.warningsAndCautions,
			boxedWarning: result.label.boxedWarning,
			found: true
		};
	}

	/**
	 * Get adverse reactions
	 */
	async getAdverseReactions(
		brandName: string,
		genericName?: string
	): Promise<{ text: string | null; summary: string | null; found: boolean }> {
		const result = await this.getDrugLabel(brandName, genericName);
		if (!result.found || !result.label) {
			return { text: null, summary: null, found: false };
		}

		return {
			text: result.label.adverseReactions,
			summary: extractSummary(result.label.adverseReactions, 500),
			found: true
		};
	}

	/**
	 * Get clinical summary (contraindications, interactions, warnings)
	 */
	async getClinicalSummary(
		brandName: string,
		genericName?: string
	): Promise<{
		found: boolean;
		brandName: string;
		genericName: string;
		contraindications: string | null;
		drugInteractions: string | null;
		warnings: string | null;
		boxedWarning: string | null;
		adverseReactions: string | null;
	}> {
		const result = await this.getDrugLabel(brandName, genericName);
		if (!result.found || !result.label) {
			return {
				found: false,
				brandName: '',
				genericName: '',
				contraindications: null,
				drugInteractions: null,
				warnings: null,
				boxedWarning: null,
				adverseReactions: null
			};
		}

		const label = result.label;
		return {
			found: true,
			brandName: label.brandName,
			genericName: label.genericName,
			contraindications: extractSummary(label.contraindications, 500),
			drugInteractions: extractSummary(label.drugInteractions, 500),
			warnings: extractSummary(label.warningsAndCautions, 500),
			boxedWarning: label.boxedWarning,
			adverseReactions: extractSummary(label.adverseReactions, 500)
		};
	}

	/**
	 * Get FDA drug label with Hungarian ingredient translation support
	 * IMPROVED: Tries ingredient (English) FIRST, then brand name, then ATC
	 */
	async getDrugLabelWithTranslation(
		brandName: string,
		hungarianIngredient?: string,
		atcCode?: string
	): Promise<OpenFdaSearchResult> {
		// Check cache first
		const cacheKey = `trans|${brandName}|${hungarianIngredient || ''}|${atcCode || ''}`.toLowerCase();
		const cached = cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
			return cached.data;
		}

		let result: OpenFdaSearchResult = { found: false, label: null, error: null, searchedBy: 'brand_name' };

		// 1. TRY INGREDIENT FIRST (most reliable for Hungarian drugs)
		if (hungarianIngredient) {
			// Get English translations (may return multiple variants)
			const englishVariants = await ingredientTranslationService.toEnglish(hungarianIngredient);

			for (const englishName of englishVariants) {
				// Try active_ingredient field first (more reliable)
				result = await searchByActiveIngredient(englishName);
				if (result.found) {
					console.log(
						`[OpenFDA] Found via active_ingredient: "${hungarianIngredient}" → "${englishName}"`
					);
					break;
				}

				// Fallback to generic_name field
				result = await searchByGenericName(englishName);
				if (result.found) {
					console.log(
						`[OpenFDA] Found via generic_name: "${hungarianIngredient}" → "${englishName}"`
					);
					break;
				}
			}
		}

		// 2. If not found by ingredient, try brand name
		if (!result.found) {
			result = await searchByBrandName(brandName);
			if (result.found) {
				console.log(`[OpenFDA] Found via brand_name: "${brandName}"`);
			}
		}

		// 3. If still not found, try ATC code translation
		if (!result.found && atcCode) {
			const atcEnglish = await ingredientTranslationService.getEnglishFromAtc(atcCode);
			if (atcEnglish) {
				result = await searchByActiveIngredient(atcEnglish);
				if (!result.found) {
					result = await searchByGenericName(atcEnglish);
				}
				if (result.found) {
					console.log(`[OpenFDA] Found via ATC: ${atcCode} → "${atcEnglish}"`);
				}
			}
		}

		// Cache the result
		cache.set(cacheKey, { data: result, timestamp: Date.now() });

		return result;
	}

	/**
	 * Get clinical summary with translation support
	 * Enhanced version that handles Hungarian ingredient names
	 */
	async getClinicalSummaryWithTranslation(
		brandName: string,
		hungarianIngredient?: string,
		atcCode?: string
	): Promise<{
		found: boolean;
		brandName: string;
		genericName: string;
		contraindications: string | null;
		drugInteractions: string | null;
		warnings: string | null;
		boxedWarning: string | null;
		adverseReactions: string | null;
		translatedFrom?: string;
	}> {
		const result = await this.getDrugLabelWithTranslation(
			brandName,
			hungarianIngredient,
			atcCode
		);

		if (!result.found || !result.label) {
			return {
				found: false,
				brandName: '',
				genericName: '',
				contraindications: null,
				drugInteractions: null,
				warnings: null,
				boxedWarning: null,
				adverseReactions: null
			};
		}

		const label = result.label;
		return {
			found: true,
			brandName: label.brandName,
			genericName: label.genericName,
			contraindications: extractSummary(label.contraindications, 500),
			drugInteractions: extractSummary(label.drugInteractions, 500),
			warnings: extractSummary(label.warningsAndCautions, 500),
			boxedWarning: label.boxedWarning,
			adverseReactions: extractSummary(label.adverseReactions, 500),
			translatedFrom: hungarianIngredient !== label.genericName ? hungarianIngredient : undefined
		};
	}

	/**
	 * Get FDA drug labels for multi-ingredient drugs
	 * Parses the ingredient string and searches for each ingredient separately
	 * Returns per-ingredient results for tabbed display
	 */
	async getMultiIngredientLabels(
		brandName: string,
		hungarianIngredient?: string,
		atcCode?: string
	): Promise<OpenFdaMultiIngredientResult> {
		// Parse ingredients
		const parsed = ingredientParserService.parse(hungarianIngredient);

		const result: OpenFdaMultiIngredientResult = {
			matchedByAny: false,
			perIngredient: [],
			searchMethod: 'per-ingredient',
			isMultiIngredient: parsed.isMultiIngredient,
			parsedIngredients: parsed
		};

		// 1. Try direct brand name search first (may get combination product)
		// Strip dosage from brand name (e.g., "CO-XETER 10 MG/10 MG" → "CO-XETER")
		const cleanBrandName = brandName.split(/\s+\d/)[0].trim();
		const brandResult = await searchByBrandName(cleanBrandName);
		if (brandResult.found) {
			result.combinationMatch = brandResult;
			result.matchedByAny = true;
			result.searchMethod = 'combination';
			console.log(`[OpenFDA Multi] Found combination via brand: "${cleanBrandName}"`);
		}

		// 2. If multi-ingredient, parse and search each ingredient separately
		if (parsed.isMultiIngredient && parsed.ingredients.length > 0) {
			for (const ingredient of parsed.ingredients) {
				// Get English translations
				const englishVariants = await ingredientTranslationService.toEnglish(ingredient);
				const englishName = englishVariants[0] || ingredient;

				let ingredientResult: OpenFdaSearchResult | undefined;

				// Try each English variant
				for (const variant of englishVariants) {
					// Try active_ingredient field first
					let searchResult = await searchByActiveIngredient(variant);
					if (!searchResult.found) {
						searchResult = await searchByGenericName(variant);
					}

					if (searchResult.found) {
						ingredientResult = searchResult;
						console.log(`[OpenFDA Multi] Found ingredient: "${ingredient}" → "${variant}"`);
						break;
					}
				}

				// Add to per-ingredient results
				result.perIngredient.push({
					ingredient,
					englishName,
					result: ingredientResult
				});

				if (ingredientResult?.found) {
					result.matchedByAny = true;
				}
			}
		}

		// 3. ATC fallback for generic placeholders (e.g., "irbesartan and diuretics")
		if (!result.matchedByAny && parsed.isGenericPlaceholder && atcCode) {
			const atcEnglish = await ingredientTranslationService.getEnglishFromAtc(atcCode);
			if (atcEnglish) {
				result.searchMethod = 'atc-fallback';
				console.log(`[OpenFDA Multi] ATC fallback: ${atcCode} → "${atcEnglish}"`);

				// Parse the ATC-derived name and search each component
				const atcParsed = ingredientParserService.parse(atcEnglish);
				for (const ing of atcParsed.ingredients) {
					let fallbackResult = await searchByActiveIngredient(ing);
					if (!fallbackResult.found) {
						fallbackResult = await searchByGenericName(ing);
					}

					if (fallbackResult.found) {
						result.perIngredient.push({
							ingredient: ing,
							englishName: ing,
							result: fallbackResult
						});
						result.matchedByAny = true;
						console.log(`[OpenFDA Multi] Found via ATC fallback: "${ing}"`);
					}
				}
			}
		}

		// 4. If single ingredient and no match yet, use existing method
		if (!parsed.isMultiIngredient && !result.matchedByAny) {
			const singleResult = await this.getDrugLabelWithTranslation(
				brandName,
				hungarianIngredient,
				atcCode
			);
			if (singleResult.found) {
				const englishVariants = await ingredientTranslationService.toEnglish(hungarianIngredient || '');
				result.perIngredient.push({
					ingredient: hungarianIngredient || brandName,
					englishName: englishVariants[0] || hungarianIngredient || brandName,
					result: singleResult
				});
				result.matchedByAny = true;
			}
		}

		return result;
	}

	/**
	 * Clear the cache
	 */
	clearCache(): void {
		cache.clear();
	}
}

// Export singleton instance
export const openFdaService = new OpenFdaService();
