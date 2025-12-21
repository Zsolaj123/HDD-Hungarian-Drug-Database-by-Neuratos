/**
 * Ingredient Translation Service
 *
 * Translates Hungarian active ingredient names to English for FDA API lookup.
 * Provides fallback using ATC codes for comprehensive coverage.
 */

interface TranslationData {
	meta: {
		description: string;
		version: string;
		lastUpdated: string;
		totalMappings: number;
	};
	translations: Record<string, string[]>;
	atcToEnglish: Record<string, string>;
}

class IngredientTranslationService {
	private translations: Map<string, string[]> = new Map();
	private reverseTranslations: Map<string, string> = new Map();
	private atcToEnglish: Map<string, string> = new Map();
	private isLoaded = false;
	private loadPromise: Promise<void> | null = null;

	/**
	 * Load translation data from JSON file
	 */
	private async loadData(): Promise<void> {
		if (this.isLoaded) return;
		if (this.loadPromise) return this.loadPromise;

		this.loadPromise = (async () => {
			try {
				const response = await fetch('/data/drugs/ingredient-translations.json');
				if (!response.ok) {
					console.warn('Failed to load ingredient translations:', response.status);
					return;
				}

				const data: TranslationData = await response.json();

				// Build forward translation map (Hungarian → English[])
				for (const [hungarian, english] of Object.entries(data.translations)) {
					const normalizedKey = this.normalize(hungarian);
					this.translations.set(normalizedKey, english);

					// Build reverse map (English → Hungarian)
					for (const eng of english) {
						const normalizedEng = this.normalize(eng);
						if (!this.reverseTranslations.has(normalizedEng)) {
							this.reverseTranslations.set(normalizedEng, hungarian);
						}
					}
				}

				// Build ATC → English map
				for (const [atc, english] of Object.entries(data.atcToEnglish)) {
					this.atcToEnglish.set(atc.toUpperCase(), english);
				}

				this.isLoaded = true;
				console.log(
					`Loaded ${this.translations.size} ingredient translations, ${this.atcToEnglish.size} ATC mappings`
				);
			} catch (error) {
				console.error('Error loading ingredient translations:', error);
			}
		})();

		return this.loadPromise;
	}

	/**
	 * Normalize ingredient name for lookup
	 * Removes accents, converts to lowercase, trims whitespace
	 */
	normalize(ingredient: string): string {
		return ingredient
			.toLowerCase()
			.trim()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '') // Remove diacritics
			.replace(/ő/g, 'o')
			.replace(/ű/g, 'u')
			.replace(/\s+/g, ' ');
	}

	/**
	 * Translate Hungarian ingredient to English variants for FDA search
	 * Returns array of possible English names (try each until FDA finds a match)
	 */
	async toEnglish(hungarianIngredient: string): Promise<string[]> {
		await this.loadData();

		const normalized = this.normalize(hungarianIngredient);

		// Check direct translation
		if (this.translations.has(normalized)) {
			return this.translations.get(normalized)!;
		}

		// Try partial matches - prefer shorter keys (individual ingredients over combinations)
		// When looking up "roszuvasztatin", prefer "rosuvastatin" over "ezetimibe and rosuvastatin"
		const partialMatches: { key: string; values: string[] }[] = [];
		for (const [key, values] of this.translations) {
			// Only match if key contains the normalized input (the input is part of a larger combo)
			// OR if the input contains the key AND the key is reasonably similar length
			if (key.includes(normalized)) {
				// The input is part of a larger combo - return the combo translation
				partialMatches.push({ key, values });
			} else if (normalized.includes(key)) {
				// The key is part of the input - only include if key is similar length
				// This prevents "rosuvastatin" matching "roszuvasztatin" when key is just "sz"
				const lengthRatio = key.length / normalized.length;
				if (lengthRatio > 0.7) {
					partialMatches.push({ key, values });
				}
			}
		}

		if (partialMatches.length > 0) {
			// Sort by key length - prefer shorter matches (individual ingredients)
			// For "roszuvasztatin", prefer "rosuvastatin" over "ezetimibe and rosuvastatin"
			partialMatches.sort((a, b) => a.key.length - b.key.length);

			// Only return single-ingredient translations if available
			const singleIngredients = partialMatches.filter(m =>
				!m.values.some(v => v.includes(' and ') || v.includes(' és '))
			);

			if (singleIngredients.length > 0) {
				return [...new Set(singleIngredients.flatMap(m => m.values))];
			}

			return [...new Set(partialMatches.flatMap(m => m.values))];
		}

		// If ingredient looks already English (no Hungarian chars), return as-is
		if (!/[áéíóöőúüű]/i.test(hungarianIngredient)) {
			return [hungarianIngredient];
		}

		// No translation found - return normalized version as fallback
		return [normalized];
	}

	/**
	 * Get English name from ATC code
	 * Useful as fallback when ingredient name doesn't translate
	 */
	async getEnglishFromAtc(atcCode: string): Promise<string | null> {
		await this.loadData();

		const normalized = atcCode.toUpperCase().trim();

		// Try exact match first
		if (this.atcToEnglish.has(normalized)) {
			return this.atcToEnglish.get(normalized)!;
		}

		// Try prefix matches (first 5 chars)
		const prefix = normalized.substring(0, 5);
		for (const [atc, english] of this.atcToEnglish) {
			if (atc.startsWith(prefix)) {
				return english;
			}
		}

		return null;
	}

	/**
	 * Translate English ingredient to Hungarian for display
	 */
	async toHungarian(englishIngredient: string): Promise<string | null> {
		await this.loadData();

		const normalized = this.normalize(englishIngredient);
		return this.reverseTranslations.get(normalized) || null;
	}

	/**
	 * Check if an ingredient has a known translation
	 */
	async hasTranslation(ingredient: string): Promise<boolean> {
		await this.loadData();
		const normalized = this.normalize(ingredient);
		return this.translations.has(normalized);
	}

	/**
	 * Get all available translations (for debugging/admin)
	 */
	async getAllTranslations(): Promise<Map<string, string[]>> {
		await this.loadData();
		return new Map(this.translations);
	}

	/**
	 * Get translation stats
	 */
	async getStats(): Promise<{
		totalTranslations: number;
		totalAtcMappings: number;
		isLoaded: boolean;
	}> {
		await this.loadData();
		return {
			totalTranslations: this.translations.size,
			totalAtcMappings: this.atcToEnglish.size,
			isLoaded: this.isLoaded
		};
	}

	/**
	 * Smart lookup: Try ingredient first, then ATC fallback
	 * Returns best English name for FDA search
	 */
	async smartLookup(
		ingredient: string | null | undefined,
		atcCode: string | null | undefined
	): Promise<string[]> {
		const results: string[] = [];

		// Try ingredient translation first
		if (ingredient) {
			const englishVariants = await this.toEnglish(ingredient);
			results.push(...englishVariants);
		}

		// Add ATC fallback
		if (atcCode) {
			const atcEnglish = await this.getEnglishFromAtc(atcCode);
			if (atcEnglish && !results.includes(atcEnglish)) {
				results.push(atcEnglish);
			}
		}

		return results;
	}
}

// Export singleton instance
export const ingredientTranslationService = new IngredientTranslationService();
