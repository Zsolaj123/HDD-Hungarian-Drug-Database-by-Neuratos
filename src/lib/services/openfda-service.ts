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

// Cache for API responses (5 minute TTL)
const cache = new Map<string, { data: OpenFdaSearchResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clean and normalize text from FDA labels
 */
function cleanLabelText(text: string | string[] | undefined): string | null {
	if (!text) return null;
	const content = Array.isArray(text) ? text.join('\n\n') : text;
	// Remove section numbers like "4 CONTRAINDICATIONS" at the start
	return content.replace(/^\d+(\.\d+)?\s+[A-Z\s]+\n?/g, '').trim() || null;
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

	return {
		brandName: openfda.brand_name?.[0] || '',
		genericName: openfda.generic_name?.[0] || '',
		manufacturer: openfda.manufacturer_name?.[0] || '',
		contraindications: cleanLabelText(result.contraindications as string[]),
		drugInteractions: cleanLabelText(result.drug_interactions as string[]),
		warningsAndCautions: cleanLabelText(result.warnings_and_cautions as string[]),
		boxedWarning: cleanLabelText(result.boxed_warning as string[]),
		adverseReactions: cleanLabelText(result.adverse_reactions as string[]),
		indicationsAndUsage: cleanLabelText(result.indications_and_usage as string[]),
		dosageAndAdministration: cleanLabelText(result.dosage_and_administration as string[]),
		pregnancy: cleanLabelText(result.pregnancy as string[]),
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
	 * Tries brand name first, then translates Hungarian ingredient to English
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

		// Try brand name first
		let result = await searchByBrandName(brandName);

		// If not found by brand, try translated ingredient names
		if (!result.found && hungarianIngredient) {
			// Get English translations (may return multiple variants)
			const englishVariants = await ingredientTranslationService.toEnglish(hungarianIngredient);

			for (const englishName of englishVariants) {
				result = await searchByGenericName(englishName);
				if (result.found) {
					console.log(
						`[OpenFDA] Found via translation: "${hungarianIngredient}" → "${englishName}"`
					);
					break;
				}
			}
		}

		// If still not found, try ATC code translation
		if (!result.found && atcCode) {
			const atcEnglish = await ingredientTranslationService.getEnglishFromAtc(atcCode);
			if (atcEnglish) {
				result = await searchByGenericName(atcEnglish);
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
	 * Clear the cache
	 */
	clearCache(): void {
		cache.clear();
	}
}

// Export singleton instance
export const openFdaService = new OpenFdaService();
