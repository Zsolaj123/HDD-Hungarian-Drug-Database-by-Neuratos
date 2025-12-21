/**
 * Drug Database Service
 *
 * Provides drug search, autocomplete, and management functionality for Doctor-app.
 * Local-first architecture with cleaned NEAK drug database (deduplicated, optimized).
 *
 * Features:
 * - LOCAL-FIRST: Cleaned drug database loaded locally for instant search
 * - SOAP FALLBACK: PUPHAX online service only used when no local results
 * - Optimized search with prefix indexing and O(1) ID lookups
 * - Priority scoring: in-market drugs ranked higher
 * - Supabase integration for cloud storage and AI updates
 * - n8n webhook integration for AI-powered drug database enhancement
 * - Drug interaction checking
 * - Dosage suggestions
 * - Generic alternatives lookup
 * - Common dosages extraction
 */

import {
	puphaxService,
	type DrugSummaryLight,
	type ExtendedDrug
} from './puphax-api-service';
import { localDrugExpansionService } from './local-drug-expansion-service';

// ============================================================================
// Type Definitions
// ============================================================================

export interface Drug {
	id: string;
	name: string;
	shortName?: string;
	activeIngredient: string;
	atcCode: string;
	atcDescription?: string;
	dosage: string;
	form: string;
	route: DrugRoute;
	routeOriginal?: string;
	prescriptionRequired: boolean;
	prescriptionCode?: string;
	prescriptionLabel?: string;
	brandName?: string;
	manufacturer?: string;
	packageSize?: string;
	packageUnit?: string;
	eanCode?: string;
	productCode?: string;
	validFrom?: string;
	validUntil?: string;
	inStock?: boolean;
	// MDB-specific fields
	packSize?: string;      // Package size from MDB (OEP_KSZ)
	tttCode?: string;       // Insurance code from MDB (OEP_TTT)
	inMarket?: boolean;     // Whether drug is currently in market (FORGALOMBAN)
	ddd?: {
		amount: string | null;
		unit: string | null;
		factor: string | null;
	};
	// Cleaned database fields
	packSizes?: string[];     // Aggregated pack sizes from deduplication
	tttCodes?: string[];      // Aggregated insurance codes
	searchName?: string;      // Pre-normalized name for search
	searchIngredient?: string; // Pre-normalized ingredient for search
	baseName?: string;        // Base drug name without dosage/form
	priority?: number;        // 1 = in market, 2 = discontinued
}

export interface SimplifiedDrug {
	id: string;
	name: string;
	activeIngredient: string;
	dosage: string;
	form: string;
	route: DrugRoute;
	prescriptionRequired: boolean;
	atcCode: string;
	// Optional search optimization fields (from cleaned database)
	searchName?: string;
	searchIngredient?: string;
	inMarket?: boolean;
	priority?: number;
}

export type DrugRoute =
	| 'oral'
	| 'iv'
	| 'im'
	| 'sc'
	| 'topical'
	| 'inhaled'
	| 'rectal'
	| 'ophthalmic'
	| 'otic'
	| 'nasal'
	| 'vaginal'
	| 'intrathecal'
	| 'epidural'
	| 'transdermal'
	| 'sublingual'
	| 'buccal';

export interface DrugSearchOptions {
	limit?: number;
	route?: DrugRoute;
	prescriptionOnly?: boolean;
	atcPrefix?: string;
	includeInactive?: boolean; // Include discontinued drugs (default: true)
}

export interface DrugInteraction {
	id?: string;
	drug1Id: string;
	drug1Name: string;
	drug2Id: string;
	drug2Name: string;
	severity: 'critical' | 'major' | 'moderate' | 'minor' | 'info';
	description: string;
	recommendation?: string;
	source?: string;
	verified?: boolean;
}

export interface DosageSuggestion {
	drugId: string;
	indication?: string;
	population: 'adult' | 'pediatric' | 'geriatric' | 'renal_impairment';
	suggestedDose: string;
	frequency?: string;
	maxDailyDose?: string;
	notes?: string;
	confidence?: number;
}

export interface DrugDatabaseMeta {
	source: string;
	sourceUrl?: string;
	extractedAt?: string;
	cleanedAt?: string;
	totalDrugs?: number;
	originalCount?: number;
	cleanedCount?: number;
	duplicatesRemoved?: number;
	dosageExtracted?: number;
	version: string;
}

export interface DrugDatabase {
	meta: DrugDatabaseMeta;
	drugs: Drug[] | SimplifiedDrug[];
}

// ============================================================================
// Configuration
// ============================================================================

interface DrugServiceConfig {
	supabaseUrl?: string;
	supabaseAnonKey?: string;
	n8nWebhookUrl?: string;
	useLocalFirst: boolean;
	cacheTimeMs: number;
}

// Default Supabase configuration for Neuratos Workstation
const SUPABASE_URL = 'https://meyvbkhdlhclgprncobt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXZia2hkbGhjbGdwcm5jb2J0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1OTQwNzAsImV4cCI6MjA4MDE3MDA3MH0.3uqsdoTpYnA-LumTy5b569-sUSGYtN9hT-KiNsTRVjs';

const DEFAULT_CONFIG: DrugServiceConfig = {
	supabaseUrl: SUPABASE_URL,
	supabaseAnonKey: SUPABASE_ANON_KEY,
	useLocalFirst: true,
	cacheTimeMs: 30 * 60 * 1000 // 30 minutes
};

// ============================================================================
// Drug Database Service Class
// ============================================================================

class DrugDatabaseService {
	private config: DrugServiceConfig = DEFAULT_CONFIG;
	private localDatabase: DrugDatabase | null = null;
	private searchIndex: Map<string, string[]> = new Map(); // term -> drug IDs
	private drugById: Map<string, Drug> = new Map(); // O(1) ID lookup
	private prefixIndex: Map<string, Set<string>> = new Map(); // 3-char prefix -> drug IDs
	private suffixIndex: Map<string, Set<string>> = new Map(); // drug class suffix -> drug IDs (statin, pril, etc.)
	private loadPromise: Promise<void> | null = null;
	private lastLoadTime: number = 0;

	/**
	 * Initialize the service with optional configuration
	 */
	async initialize(config?: Partial<DrugServiceConfig>): Promise<void> {
		this.config = { ...DEFAULT_CONFIG, ...config };

		if (this.config.useLocalFirst) {
			await this.loadLocalDatabase();
		}
	}

	/**
	 * Load the local JSON drug database (cleaned, deduplicated NEAK database)
	 */
	private async loadLocalDatabase(): Promise<void> {
		// Prevent multiple simultaneous loads
		if (this.loadPromise) {
			return this.loadPromise;
		}

		// Check cache validity
		if (this.localDatabase && Date.now() - this.lastLoadTime < this.config.cacheTimeMs) {
			return;
		}

		this.loadPromise = (async () => {
			try {
				// Load cleaned, deduplicated drug database
				const response = await fetch('/data/drugs/drug-database-clean.json');
				if (!response.ok) {
					// Fallback to original MDB database if clean not available
					console.warn('[DrugService] Clean database not found, trying MDB version...');
					const fallbackResponse = await fetch('/data/drugs/drug-database-mdb.json');
					if (!fallbackResponse.ok) {
						throw new Error(`Failed to load drug database: ${response.status}`);
					}
					this.localDatabase = await fallbackResponse.json();
				} else {
					this.localDatabase = await response.json();
				}

				this.buildSearchIndex();
				this.lastLoadTime = Date.now();

				const drugCount = this.localDatabase?.meta?.cleanedCount || this.localDatabase?.meta?.totalDrugs || this.localDatabase?.drugs?.length;
				console.log(
					`[DrugService] Loaded ${drugCount} drugs from local database (${this.localDatabase?.meta.source})`
				);
			} catch (error) {
				console.error('[DrugService] Failed to load local database:', error);
				throw error;
			} finally {
				this.loadPromise = null;
			}
		})();

		return this.loadPromise;
	}

	/**
	 * Build search index for fast lookups
	 * Uses pre-computed searchName/searchIngredient from cleaned database when available
	 */
	// Common drug class suffixes for substring matching
	private static readonly DRUG_CLASS_SUFFIXES = [
		'statin', 'pril', 'sartan', 'olol', 'azole', 'mycin', 'cillin', 'cycline',
		'prazole', 'tidine', 'dipine', 'floxacin', 'setron', 'triptan', 'gliptin',
		'glutide', 'tinib', 'mab', 'umab', 'zumab', 'ximab', 'mumab'
	];

	private buildSearchIndex(): void {
		if (!this.localDatabase?.drugs) return;

		this.searchIndex.clear();
		this.drugById.clear();
		this.prefixIndex.clear();
		this.suffixIndex.clear();

		for (const drug of this.localDatabase.drugs) {
			// Store in O(1) lookup map
			this.drugById.set(drug.id, drug as Drug);

			// Use pre-computed search fields if available, otherwise tokenize
			const searchName = drug.searchName || drug.name.toLowerCase();
			const searchIngredient = drug.searchIngredient || (drug.activeIngredient?.toLowerCase() || '');

			// Index by name tokens
			const nameTokens = this.tokenize(searchName);
			for (const token of nameTokens) {
				if (!this.searchIndex.has(token)) {
					this.searchIndex.set(token, []);
				}
				this.searchIndex.get(token)!.push(drug.id);

				// Build prefix index (first 3 chars) for faster prefix matching
				if (token.length >= 3) {
					const prefix = token.substring(0, 3);
					if (!this.prefixIndex.has(prefix)) {
						this.prefixIndex.set(prefix, new Set());
					}
					this.prefixIndex.get(prefix)!.add(drug.id);
				}
			}

			// Index by active ingredient tokens
			if (searchIngredient) {
				const ingredientTokens = this.tokenize(searchIngredient);
				for (const token of ingredientTokens) {
					if (!this.searchIndex.has(token)) {
						this.searchIndex.set(token, []);
					}
					if (!this.searchIndex.get(token)!.includes(drug.id)) {
						this.searchIndex.get(token)!.push(drug.id);
					}

					// Build prefix index for ingredients too
					if (token.length >= 3) {
						const prefix = token.substring(0, 3);
						if (!this.prefixIndex.has(prefix)) {
							this.prefixIndex.set(prefix, new Set());
						}
						this.prefixIndex.get(prefix)!.add(drug.id);
					}

					// Build suffix index for drug class searches (statin, pril, sartan, etc.)
					for (const suffix of DrugDatabaseService.DRUG_CLASS_SUFFIXES) {
						if (token.endsWith(suffix) && token.length > suffix.length) {
							if (!this.suffixIndex.has(suffix)) {
								this.suffixIndex.set(suffix, new Set());
							}
							this.suffixIndex.get(suffix)!.add(drug.id);
						}
					}
				}
			}

			// Index by ATC code prefix
			if (drug.atcCode) {
				const atcPrefixes = [
					drug.atcCode.substring(0, 1).toLowerCase(),
					drug.atcCode.substring(0, 3).toLowerCase(),
					drug.atcCode.substring(0, 5).toLowerCase(),
					drug.atcCode.toLowerCase()
				];
				for (const prefix of atcPrefixes) {
					if (!this.searchIndex.has(prefix)) {
						this.searchIndex.set(prefix, []);
					}
					if (!this.searchIndex.get(prefix)!.includes(drug.id)) {
						this.searchIndex.get(prefix)!.push(drug.id);
					}
				}
			}
		}
	}

	/**
	 * Tokenize a string for indexing
	 */
	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, ' ')
			.split(/\s+/)
			.filter((token) => token.length >= 2);
	}

	/**
	 * Search drugs by name, active ingredient, or ATC code
	 * Also searches the expansion cache for previously-selected PUPHAX drugs
	 * Optimized with prefix indexing and priority scoring for in-market drugs
	 */
	async searchDrugs(query: string, options: DrugSearchOptions = {}): Promise<Drug[]> {
		await this.loadLocalDatabase();

		if (!this.localDatabase?.drugs || !query || query.length < 2) {
			return [];
		}

		const { limit = 50, route, prescriptionOnly, atcPrefix, includeInactive = true } = options;

		// Tokenize query
		const queryTokens = this.tokenize(query);
		if (queryTokens.length === 0) return [];

		// Find matching drug IDs from local index
		const matchingIds = new Map<string, number>(); // id -> match score

		for (const token of queryTokens) {
			// Exact match (highest score)
			const exactMatches = this.searchIndex.get(token) || [];
			for (const id of exactMatches) {
				matchingIds.set(id, (matchingIds.get(id) || 0) + 10);
			}

			// Optimized prefix match using prefix index
			if (token.length >= 3) {
				const prefix = token.substring(0, 3);
				const prefixMatches = this.prefixIndex.get(prefix);
				if (prefixMatches) {
					for (const id of prefixMatches) {
						// Check if it's a true prefix match (not exact)
						const drug = this.drugById.get(id);
						if (drug) {
							const searchText = (drug.searchName || drug.name.toLowerCase()) + ' ' +
								(drug.searchIngredient || drug.activeIngredient?.toLowerCase() || '');
							if (searchText.includes(token) && !exactMatches.includes(id)) {
								matchingIds.set(id, (matchingIds.get(id) || 0) + 5);
							}
						}
					}
				}
			} else {
				// For short tokens, use original prefix matching (limited iterations)
				let prefixCount = 0;
				for (const [indexToken, ids] of this.searchIndex) {
					if (indexToken.startsWith(token) && indexToken !== token) {
						for (const id of ids) {
							matchingIds.set(id, (matchingIds.get(id) || 0) + 5);
						}
						prefixCount++;
						if (prefixCount > 100) break; // Limit iterations for short tokens
					}
				}
			}

			// Drug class suffix matching (e.g., "statin" finds "rosuvastatin", "atorvastatin")
			if (DrugDatabaseService.DRUG_CLASS_SUFFIXES.includes(token)) {
				const suffixMatches = this.suffixIndex.get(token);
				if (suffixMatches) {
					for (const id of suffixMatches) {
						if (!exactMatches.includes(id)) {
							matchingIds.set(id, (matchingIds.get(id) || 0) + 8); // High score for drug class match
						}
					}
				}
			}
		}

		// Get drug details using O(1) lookup and apply filters
		let results: Array<{ drug: Drug; score: number }> = [];

		for (const [id, score] of matchingIds) {
			const drug = this.drugById.get(id);
			if (!drug) continue;

			// Apply filters
			if (route && drug.route !== route) continue;
			if (prescriptionOnly && !drug.prescriptionRequired) continue;
			if (atcPrefix && !drug.atcCode.startsWith(atcPrefix)) continue;
			if (!includeInactive && !drug.inMarket) continue;

			// Filter out GYSE items (medical devices with no active ingredient)
			// These belong in the dedicated GYSE tab, not drug search
			if (!drug.activeIngredient || drug.activeIngredient.trim() === '') continue;

			// Scoring bonuses
			const priorityBonus = drug.inMarket ? 20 : 0; // In-market drugs get priority
			const ingredientBonus = drug.activeIngredient?.trim().length > 0 ? 15 : 0; // Real drugs with ingredients
			results.push({ drug, score: score + priorityBonus + ingredientBonus });
		}

		// Also search expansion cache (previously-selected PUPHAX drugs)
		try {
			const expansionDrugs = localDrugExpansionService.getExpandedDrugs();
			const lowerQuery = query.toLowerCase();

			for (const expandedDrug of expansionDrugs) {
				// Skip if already in main database or already in results
				if (this.drugById.has(expandedDrug.id)) continue;

				// Simple text matching for expansion cache drugs
				const nameMatch = expandedDrug.name.toLowerCase().includes(lowerQuery);
				const ingredientMatch = expandedDrug.activeIngredient?.toLowerCase().includes(lowerQuery);
				const atcMatch = expandedDrug.atcCode?.toLowerCase().startsWith(lowerQuery);

				if (nameMatch || ingredientMatch || atcMatch) {
					// Apply filters
					if (route && expandedDrug.route !== route) continue;
					if (prescriptionOnly && !expandedDrug.prescriptionRequired) continue;
					if (atcPrefix && !expandedDrug.atcCode?.startsWith(atcPrefix)) continue;

					// Score based on match type
					let score = 0;
					if (nameMatch) score += 8;
					if (ingredientMatch) score += 6;
					if (atcMatch) score += 4;

					results.push({ drug: expandedDrug as Drug, score });
				}
			}
		} catch (error) {
			// Expansion cache error shouldn't break search
			console.warn('[DrugService] Expansion cache search failed:', error);
		}

		// Sort by score and name
		results.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.drug.name.localeCompare(b.drug.name, 'hu');
		});

		return results.slice(0, limit).map((r) => r.drug);
	}

	/**
	 * Get autocomplete suggestions for drug names
	 */
	async getAutocompleteSuggestions(
		query: string,
		limit: number = 10
	): Promise<Array<{ name: string; dosage: string; id: string }>> {
		const drugs = await this.searchDrugs(query, { limit });
		return drugs.map((d) => ({
			name: d.name,
			dosage: d.dosage,
			id: d.id
		}));
	}

	/**
	 * Get drug by ID using O(1) lookup
	 */
	async getDrugById(id: string): Promise<Drug | null> {
		await this.loadLocalDatabase();

		// Use O(1) lookup map instead of array search
		return this.drugById.get(id) || null;
	}

	/**
	 * Get full drug details for info modal display
	 * Returns all available fields including packSizes, DDD, etc.
	 */
	async getFullDrugDetails(id: string): Promise<Drug | null> {
		await this.loadLocalDatabase();

		const drug = this.drugById.get(id);
		if (!drug) return null;

		// Return drug with all fields for detailed display
		return drug;
	}

	/**
	 * Get drugs by ATC code prefix
	 */
	async getDrugsByAtcCode(atcPrefix: string, limit: number = 100): Promise<Drug[]> {
		await this.loadLocalDatabase();

		if (!this.localDatabase?.drugs) return [];

		return this.localDatabase.drugs
			.filter((d) => d.atcCode.startsWith(atcPrefix))
			.slice(0, limit) as Drug[];
	}

	/**
	 * Get drugs by active ingredient
	 */
	async getDrugsByActiveIngredient(ingredient: string, limit: number = 50): Promise<Drug[]> {
		await this.loadLocalDatabase();

		if (!this.localDatabase?.drugs) return [];

		const lowerIngredient = ingredient.toLowerCase();
		return this.localDatabase.drugs
			.filter((d) => d.activeIngredient.toLowerCase().includes(lowerIngredient))
			.slice(0, limit) as Drug[];
	}

	// ============================================================================
	// PUPHAX Integration Methods
	// ============================================================================

	/**
	 * Hybrid search: Local first (instant), PUPHAX SOAP only when no local results
	 *
	 * Strategy:
	 * 1. Search local 46,485 drug database first (instant)
	 * 2. If local results found → return them (no PUPHAX call)
	 * 3. If NO local results AND PUPHAX requested → try PUPHAX SOAP service
	 *
	 * This minimizes SOAP service usage while ensuring comprehensive coverage.
	 */
	async hybridSearch(
		query: string,
		options: DrugSearchOptions & { includePuphax?: boolean; forcePuphax?: boolean } = {}
	): Promise<{
		localResults: Drug[];
		puphaxResults: DrugSummaryLight[];
		isOnline: boolean;
		usedPuphax: boolean;
	}> {
		const { limit = 20, includePuphax = true, forcePuphax = false } = options;

		// Always get local results first (instant, 46K drugs from MDB)
		const localResults = await this.searchDrugs(query, { ...options, limit });

		// Check if PUPHAX is available
		let puphaxResults: DrugSummaryLight[] = [];
		let isOnline = false;
		let usedPuphax = false;

		// Only use PUPHAX SOAP if:
		// 1. includePuphax is true (not disabled)
		// 2. AND (forcePuphax is true OR no local results found)
		const shouldUsePuphax = includePuphax && (forcePuphax || localResults.length === 0);

		if (shouldUsePuphax) {
			isOnline = await puphaxService.checkHealth();

			if (isOnline) {
				try {
					console.log(`[DrugService] No local results for "${query}", trying PUPHAX SOAP...`);
					const response = await puphaxService.searchDrugs(query, { limit });
					if (response) {
						puphaxResults = response.drugs;
						usedPuphax = true;
					}
				} catch (error) {
					console.warn('[DrugService] PUPHAX search failed:', error);
				}
			}
		} else if (includePuphax) {
			// Just check online status for UI indicator, but don't search
			isOnline = await puphaxService.checkHealth();
		}

		return { localResults, puphaxResults, isOnline, usedPuphax };
	}

	/**
	 * Get common dosages for drugs with the same active ingredient
	 * Aggregates all unique dosage strengths from the database
	 */
	async getCommonDosages(activeIngredient: string): Promise<string[]> {
		await this.loadLocalDatabase();

		if (!this.localDatabase?.drugs || !activeIngredient) return [];

		const lowerIngredient = activeIngredient.toLowerCase();
		const dosages = new Set<string>();

		// Get dosages from local database
		for (const drug of this.localDatabase.drugs) {
			if (drug.activeIngredient.toLowerCase().includes(lowerIngredient)) {
				if (drug.dosage) {
					dosages.add(drug.dosage);
				}
			}
		}

		// Try to get additional dosages from PUPHAX if online
		const isOnline = await puphaxService.checkHealth();
		if (isOnline) {
			try {
				const puphaxDosages = await puphaxService.getCommonDosages(activeIngredient);
				for (const dosage of puphaxDosages) {
					dosages.add(dosage);
				}
			} catch (error) {
				console.warn('[DrugService] PUPHAX dosages fetch failed:', error);
			}
		}

		// Sort dosages by numeric value if possible
		return Array.from(dosages).sort((a, b) => {
			const numA = parseFloat(a.replace(/[^\d.]/g, '')) || 0;
			const numB = parseFloat(b.replace(/[^\d.]/g, '')) || 0;
			return numA - numB;
		});
	}

	/**
	 * Get generic alternatives for a drug (same active ingredient, different brands)
	 */
	async getGenericAlternatives(
		drugId: string,
		limit: number = 20
	): Promise<{
		localAlternatives: Drug[];
		puphaxAlternatives: DrugSummaryLight[];
	}> {
		// First get the drug to find its active ingredient
		const drug = await this.getDrugById(drugId);
		if (!drug || !drug.activeIngredient) {
			return { localAlternatives: [], puphaxAlternatives: [] };
		}

		// Get local alternatives
		const localAlternatives = (await this.getDrugsByActiveIngredient(drug.activeIngredient, limit))
			.filter((d) => d.id !== drugId);

		// Get PUPHAX alternatives if online
		let puphaxAlternatives: DrugSummaryLight[] = [];
		const isOnline = await puphaxService.checkHealth();

		if (isOnline) {
			try {
				const alts = await puphaxService.getAlternatives(drug.activeIngredient, limit);
				// Filter out the original drug and any that match local IDs
				const localIds = new Set(localAlternatives.map((d) => d.id));
				puphaxAlternatives = alts.filter((a) => a.id !== drugId && !localIds.has(a.id));
			} catch (error) {
				console.warn('[DrugService] PUPHAX alternatives fetch failed:', error);
			}
		}

		return { localAlternatives, puphaxAlternatives };
	}

	/**
	 * Get full drug details from PUPHAX (55 fields)
	 * Falls back to local data if PUPHAX is unavailable
	 */
	async getExtendedDrugDetails(drugId: string): Promise<ExtendedDrug | Drug | null> {
		// Try PUPHAX first for extended data
		const isOnline = await puphaxService.checkHealth();

		if (isOnline) {
			try {
				const extendedDrug = await puphaxService.getDrugDetails(drugId);
				if (extendedDrug) {
					return extendedDrug;
				}
			} catch (error) {
				console.warn('[DrugService] PUPHAX details fetch failed:', error);
			}
		}

		// Fallback to local data
		return this.getDrugById(drugId);
	}

	/**
	 * Check if PUPHAX service is online
	 */
	async isPuphaxOnline(): Promise<boolean> {
		return puphaxService.checkHealth();
	}

	/**
	 * Convert PUPHAX DrugSummaryLight to local Drug type
	 */
	convertPuphaxToLocalDrug(puphaxDrug: DrugSummaryLight): Drug {
		return {
			id: puphaxDrug.id,
			name: puphaxDrug.name,
			activeIngredient: puphaxDrug.activeIngredient,
			atcCode: puphaxDrug.atcCode,
			dosage: puphaxDrug.strength || '',
			form: puphaxDrug.productForm,
			route: this.inferRouteFromForm(puphaxDrug.productForm),
			prescriptionRequired: puphaxDrug.prescriptionRequired,
			manufacturer: puphaxDrug.manufacturer,
			packageSize: puphaxDrug.packSize
		};
	}

	/**
	 * Infer drug route from product form
	 */
	private inferRouteFromForm(form: string): DrugRoute {
		const lowerForm = form.toLowerCase();

		if (lowerForm.includes('tabletta') || lowerForm.includes('kapszula') || lowerForm.includes('drazsé')) {
			return 'oral';
		}
		if (lowerForm.includes('injekció') || lowerForm.includes('infúzió')) {
			return 'iv';
		}
		if (lowerForm.includes('kenőcs') || lowerForm.includes('krém') || lowerForm.includes('gél')) {
			return 'topical';
		}
		if (lowerForm.includes('inhaláció') || lowerForm.includes('aeroszol')) {
			return 'inhaled';
		}
		if (lowerForm.includes('szemcsepp') || lowerForm.includes('szemkenőcs')) {
			return 'ophthalmic';
		}
		if (lowerForm.includes('fülcsepp')) {
			return 'otic';
		}
		if (lowerForm.includes('orrcsepp') || lowerForm.includes('orrspray')) {
			return 'nasal';
		}
		if (lowerForm.includes('kúp')) {
			return 'rectal';
		}
		if (lowerForm.includes('hüvely')) {
			return 'vaginal';
		}
		if (lowerForm.includes('tapasz')) {
			return 'transdermal';
		}
		if (lowerForm.includes('nyelv alá') || lowerForm.includes('sublingual')) {
			return 'sublingual';
		}

		return 'oral'; // Default
	}

	/**
	 * Check for drug interactions (local fallback + Supabase)
	 */
	async checkInteractions(drugIds: string[]): Promise<DrugInteraction[]> {
		if (drugIds.length < 2) return [];

		const interactions: DrugInteraction[] = [];

		// Try Supabase first if configured
		if (this.config.supabaseUrl && this.config.supabaseAnonKey) {
			try {
				const response = await fetch(
					`${this.config.supabaseUrl}/rest/v1/drug_interactions?or=(and(drug1_id.in.(${drugIds.join(',')}),drug2_id.in.(${drugIds.join(',')})),and(drug1_id.in.(${drugIds.join(',')}),drug2_id.in.(${drugIds.join(',')})))`,
					{
						headers: {
							apikey: this.config.supabaseAnonKey,
							Authorization: `Bearer ${this.config.supabaseAnonKey}`
						}
					}
				);

				if (response.ok) {
					const data = await response.json();
					return data.map(
						(row: {
							id: string;
							drug1_id: string;
							drug1_name: string;
							drug2_id: string;
							drug2_name: string;
							severity: DrugInteraction['severity'];
							description: string;
							recommendation: string;
							source: string;
							verified: boolean;
						}) => ({
							id: row.id,
							drug1Id: row.drug1_id,
							drug1Name: row.drug1_name,
							drug2Id: row.drug2_id,
							drug2Name: row.drug2_name,
							severity: row.severity,
							description: row.description,
							recommendation: row.recommendation,
							source: row.source,
							verified: row.verified
						})
					);
				}
			} catch (error) {
				console.warn('[DrugService] Supabase interaction check failed:', error);
			}
		}

		// Fallback: request via n8n webhook for AI-based interaction check
		if (this.config.n8nWebhookUrl && drugIds.length >= 2) {
			try {
				const drugs = await Promise.all(drugIds.map((id) => this.getDrugById(id)));
				const validDrugs = drugs.filter(Boolean);

				if (validDrugs.length >= 2) {
					const response = await fetch(this.config.n8nWebhookUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							action: 'check_interactions',
							drugs: validDrugs.map((d) => ({
								id: d!.id,
								name: d!.name,
								activeIngredient: d!.activeIngredient,
								atcCode: d!.atcCode
							}))
						})
					});

					if (response.ok) {
						const data = await response.json();
						if (data.interactions) {
							return data.interactions;
						}
					}
				}
			} catch (error) {
				console.warn('[DrugService] n8n interaction check failed:', error);
			}
		}

		return interactions;
	}

	/**
	 * Get dosage suggestions for a drug
	 */
	async getDosageSuggestions(drugId: string, population?: string): Promise<DosageSuggestion[]> {
		// Try Supabase first
		if (this.config.supabaseUrl && this.config.supabaseAnonKey) {
			try {
				let url = `${this.config.supabaseUrl}/rest/v1/dosage_suggestions?drug_id=eq.${drugId}`;
				if (population) {
					url += `&population=eq.${population}`;
				}

				const response = await fetch(url, {
					headers: {
						apikey: this.config.supabaseAnonKey,
						Authorization: `Bearer ${this.config.supabaseAnonKey}`
					}
				});

				if (response.ok) {
					const data = await response.json();
					return data.map(
						(row: {
							drug_id: string;
							indication: string;
							population: DosageSuggestion['population'];
							suggested_dose: string;
							frequency: string;
							max_daily_dose: string;
							notes: string;
							confidence: number;
						}) => ({
							drugId: row.drug_id,
							indication: row.indication,
							population: row.population,
							suggestedDose: row.suggested_dose,
							frequency: row.frequency,
							maxDailyDose: row.max_daily_dose,
							notes: row.notes,
							confidence: row.confidence
						})
					);
				}
			} catch (error) {
				console.warn('[DrugService] Supabase dosage suggestions failed:', error);
			}
		}

		return [];
	}

	/**
	 * Get database statistics
	 */
	async getStatistics(): Promise<{
		totalDrugs: number;
		lastUpdated: string;
		version: string;
		source: string;
	}> {
		await this.loadLocalDatabase();

		return {
			totalDrugs: this.localDatabase?.meta.cleanedCount || this.localDatabase?.meta.totalDrugs || this.localDatabase?.drugs?.length || 0,
			lastUpdated: this.localDatabase?.meta.cleanedAt || this.localDatabase?.meta.extractedAt || 'Unknown',
			version: this.localDatabase?.meta.version || 'Unknown',
			source: this.localDatabase?.meta.source || 'Unknown'
		};
	}

	/**
	 * Configure Supabase connection
	 */
	setSupabaseConfig(url: string, anonKey: string): void {
		this.config.supabaseUrl = url;
		this.config.supabaseAnonKey = anonKey;
	}

	/**
	 * Configure n8n webhook
	 */
	setN8nWebhookUrl(url: string): void {
		this.config.n8nWebhookUrl = url;
	}

	/**
	 * Clear local cache and reload
	 */
	async refreshDatabase(): Promise<void> {
		this.localDatabase = null;
		this.searchIndex.clear();
		this.lastLoadTime = 0;
		await this.loadLocalDatabase();
	}

	/**
	 * Search drugs via Supabase (cloud database)
	 * Uses the search_drugs SQL function for fuzzy matching
	 */
	async searchDrugsSupabase(query: string, limit: number = 50): Promise<Drug[]> {
		if (!this.config.supabaseUrl || !this.config.supabaseAnonKey) {
			console.warn('[DrugService] Supabase not configured, falling back to local');
			return this.searchDrugs(query, { limit });
		}

		try {
			const response = await fetch(
				`${this.config.supabaseUrl}/rest/v1/rpc/search_drugs`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						apikey: this.config.supabaseAnonKey,
						Authorization: `Bearer ${this.config.supabaseAnonKey}`
					},
					body: JSON.stringify({
						search_term: query,
						limit_count: Math.min(limit, 100)
					})
				}
			);

			if (!response.ok) {
				throw new Error(`Supabase search failed: ${response.status}`);
			}

			const data = await response.json();
			return data.map((row: {
				id: string;
				name: string;
				active_ingredient: string;
				dosage: string;
				form: string;
				route: string;
				atc_code: string;
				prescription_required: boolean;
				similarity: number;
			}) => ({
				id: row.id,
				name: row.name,
				activeIngredient: row.active_ingredient,
				dosage: row.dosage,
				form: row.form,
				route: row.route as DrugRoute,
				atcCode: row.atc_code,
				prescriptionRequired: row.prescription_required
			}));
		} catch (error) {
			console.warn('[DrugService] Supabase search failed, falling back to local:', error);
			return this.searchDrugs(query, { limit });
		}
	}

	/**
	 * Add a drug interaction to Supabase
	 */
	async addInteraction(interaction: Omit<DrugInteraction, 'id'>): Promise<boolean> {
		if (!this.config.supabaseUrl || !this.config.supabaseAnonKey) {
			console.warn('[DrugService] Supabase not configured');
			return false;
		}

		try {
			const response = await fetch(
				`${this.config.supabaseUrl}/rest/v1/drug_interactions`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						apikey: this.config.supabaseAnonKey,
						Authorization: `Bearer ${this.config.supabaseAnonKey}`,
						Prefer: 'return=minimal'
					},
					body: JSON.stringify({
						drug1_id: interaction.drug1Id,
						drug1_name: interaction.drug1Name,
						drug2_id: interaction.drug2Id,
						drug2_name: interaction.drug2Name,
						severity: interaction.severity,
						description: interaction.description,
						recommendation: interaction.recommendation,
						source: interaction.source || 'manual'
					})
				}
			);

			return response.ok;
		} catch (error) {
			console.error('[DrugService] Failed to add interaction:', error);
			return false;
		}
	}

	// ============================================================================
	// Smart Drug Features
	// ============================================================================

	/**
	 * Extract base drug name without dosage, form, or pack size
	 * E.g., "ASPIRIN PROTECT 100 MG GYOMORNEDV-ELLENÁLLÓ BEVONT TABLETTA" → "ASPIRIN PROTECT"
	 */
	extractBaseDrugName(name: string): string {
		if (!name) return '';

		// Remove common dosage patterns
		let baseName = name
			.replace(/\d+[.,]?\d*\s*(mg|g|ml|mcg|µg|mikrogramm|iu|ne|%|mmol|meq)/gi, '')
			.replace(/\d+\s*\/\s*\d+\s*(mg|g|ml)/gi, '') // Combined dosages like "500/125 MG"
			.replace(/\d+\s*x\s*\d+/gi, '') // Pack counts like "30 x 1"
			.replace(/\d+\s*db/gi, '') // Piece counts
			.trim();

		// Remove common form suffixes (must be preceded by space to avoid partial matches)
		// Long suffixes first to avoid partial matches
		const formSuffixes = [
			'gyomornedv-ellenálló bevont tabletta',
			'gyomornedv-ellenálló bevont',
			'gyomornedv-ellenálló kemény kapszula',
			'gyomornedv-ellenálló',
			'módosított hatóanyagleadású',
			'nyújtott hatású',
			'bélben oldódó',
			'kemény kapszula',
			'lágy kapszula',
			'filmtabletta',
			'tabletta',
			'kapszula',
			'drazsé',
			'drazse',
			'injekció',
			'infúzió',
			'oldat',
			'por',
			'granulátum',
			'kenőcs',
			'krém',
			'gél',
			'spray',
			'aeroszol',
			'inhaláció',
			'cseppek',
			'szemcsepp',
			'fülcsepp',
			'orrcsepp',
			'kúp',
			'tapasz',
			'szirup'
		];

		// Match suffixes only at word boundaries (preceded by space)
		let lowerBase = baseName.toLowerCase();
		for (const suffix of formSuffixes) {
			// Find suffix preceded by space or at start
			const pattern = new RegExp(`\\s+${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'i');
			baseName = baseName.replace(pattern, '').trim();
			lowerBase = baseName.toLowerCase();
		}

		// Handle short release modifiers only at end and preceded by space
		// e.g., "ASPIRIN XL" but not "TECFIDERA" (don't match "er" in middle)
		const releaseModifiers = ['retard', 'depot', 'xl', 'sr', 'cr', 'er', 'mr', 'pr'];
		for (const mod of releaseModifiers) {
			// Only match if preceded by space and at end of string
			const pattern = new RegExp(`\\s+${mod}\\s*$`, 'i');
			baseName = baseName.replace(pattern, '').trim();
		}

		return baseName.replace(/\s+/g, ' ').trim();
	}

	/**
	 * Get all dosage variants for a drug by its base name
	 * Returns drugs grouped by their base name with all available dosages
	 */
	async getDosageVariants(drugNameOrId: string): Promise<{
		baseName: string;
		activeIngredient: string;
		variants: Array<{
			drug: Drug;
			dosage: string;
			form: string;
			route: DrugRoute;
			isExactMatch: boolean;
		}>;
	} | null> {
		await this.loadLocalDatabase();
		if (!this.localDatabase?.drugs) return null;

		// First, try to find the drug
		let targetDrug: Drug | null = null;
		let baseName = '';

		// Try by ID first
		targetDrug = await this.getDrugById(drugNameOrId);

		if (!targetDrug) {
			// Try by exact name match
			targetDrug = this.localDatabase.drugs.find(
				(d) => d.name.toLowerCase() === drugNameOrId.toLowerCase()
			) as Drug | null;
		}

		if (!targetDrug) {
			// Try by partial name match
			const searchResults = await this.searchDrugs(drugNameOrId, { limit: 1 });
			if (searchResults.length > 0) {
				targetDrug = searchResults[0];
			}
		}

		if (!targetDrug) return null;

		baseName = this.extractBaseDrugName(targetDrug.name);
		const activeIngredient = targetDrug.activeIngredient;

		// Find all variants with the same base name
		const variants: Array<{
			drug: Drug;
			dosage: string;
			form: string;
			route: DrugRoute;
			isExactMatch: boolean;
		}> = [];

		for (const drug of this.localDatabase.drugs) {
			const drugBaseName = this.extractBaseDrugName(drug.name);
			if (drugBaseName.toLowerCase() === baseName.toLowerCase()) {
				variants.push({
					drug: drug as Drug,
					dosage: drug.dosage || '',
					form: drug.form || '',
					route: drug.route,
					isExactMatch: drug.id === targetDrug.id
				});
			}
		}

		// Sort by dosage numerically
		variants.sort((a, b) => {
			const numA = parseFloat(a.dosage.replace(/[^\d.]/g, '')) || 0;
			const numB = parseFloat(b.dosage.replace(/[^\d.]/g, '')) || 0;
			return numA - numB;
		});

		return { baseName, activeIngredient, variants };
	}

	/**
	 * Match a pasted drug string from kórlap (clinical record) to database drugs
	 * Handles various formats like:
	 * - "Metformin 500mg 2x1"
	 * - "ASPIRIN PROTECT 100 MG"
	 * - "metoprolol 50"
	 */
	async matchPastedDrug(pastedText: string): Promise<{
		matches: Array<{
			drug: Drug;
			confidence: 'high' | 'medium' | 'low';
			matchType: 'exact' | 'name' | 'ingredient' | 'fuzzy';
			extractedDosage?: string;
			extractedFrequency?: string;
		}>;
		extractedInfo: {
			drugName: string;
			dosage?: string;
			frequency?: string;
			route?: DrugRoute;
		};
	}> {
		await this.loadLocalDatabase();

		const result: {
			matches: Array<{
				drug: Drug;
				confidence: 'high' | 'medium' | 'low';
				matchType: 'exact' | 'name' | 'ingredient' | 'fuzzy';
				extractedDosage?: string;
				extractedFrequency?: string;
			}>;
			extractedInfo: {
				drugName: string;
				dosage?: string;
				frequency?: string;
				route?: DrugRoute;
			};
		} = {
			matches: [],
			extractedInfo: { drugName: '' }
		};

		if (!pastedText || !this.localDatabase?.drugs) return result;

		// Parse the pasted text
		const parsed = this.parsePastedDrugText(pastedText);
		result.extractedInfo = parsed;

		// Search strategies in order of preference
		const strategies: Array<{
			type: 'exact' | 'name' | 'ingredient' | 'fuzzy';
			confidence: 'high' | 'medium' | 'low';
			search: () => Promise<Drug[]>;
		}> = [
			// 1. Exact name match
			{
				type: 'exact',
				confidence: 'high',
				search: async () => {
					const matches = this.localDatabase!.drugs.filter(
						(d) => d.name.toLowerCase() === pastedText.toLowerCase().trim()
					);
					return matches as Drug[];
				}
			},
			// 2. Name contains search term
			{
				type: 'name',
				confidence: 'high',
				search: async () => {
					if (!parsed.drugName || parsed.drugName.length < 3) return [];
					return this.searchDrugs(parsed.drugName, { limit: 10 });
				}
			},
			// 3. Active ingredient match
			{
				type: 'ingredient',
				confidence: 'medium',
				search: async () => {
					if (!parsed.drugName || parsed.drugName.length < 3) return [];
					return this.getDrugsByActiveIngredient(parsed.drugName, 10);
				}
			},
			// 4. Fuzzy search with extracted name
			{
				type: 'fuzzy',
				confidence: 'low',
				search: async () => {
					// Try first word only for fuzzy
					const firstWord = parsed.drugName.split(/\s+/)[0];
					if (!firstWord || firstWord.length < 3) return [];
					return this.searchDrugs(firstWord, { limit: 15 });
				}
			}
		];

		for (const strategy of strategies) {
			const drugs = await strategy.search();

			for (const drug of drugs) {
				// Check if already in results
				if (result.matches.some((m) => m.drug.id === drug.id)) continue;

				// Adjust confidence based on dosage match
				let confidence = strategy.confidence;
				if (parsed.dosage && drug.dosage) {
					const parsedDosageNum = parseFloat(parsed.dosage.replace(/[^\d.]/g, ''));
					const drugDosageNum = parseFloat(drug.dosage.replace(/[^\d.]/g, ''));
					if (parsedDosageNum === drugDosageNum) {
						confidence = 'high';
					}
				}

				result.matches.push({
					drug,
					confidence,
					matchType: strategy.type,
					extractedDosage: parsed.dosage,
					extractedFrequency: parsed.frequency
				});
			}

			// Stop if we have high confidence matches
			if (result.matches.filter((m) => m.confidence === 'high').length >= 3) {
				break;
			}
		}

		// Sort by confidence and then by name match quality
		result.matches.sort((a, b) => {
			const confOrder = { high: 0, medium: 1, low: 2 };
			if (confOrder[a.confidence] !== confOrder[b.confidence]) {
				return confOrder[a.confidence] - confOrder[b.confidence];
			}
			// Prefer shorter names (more specific matches)
			return a.drug.name.length - b.drug.name.length;
		});

		return result;
	}

	/**
	 * Parse pasted drug text to extract components
	 */
	private parsePastedDrugText(text: string): {
		drugName: string;
		dosage?: string;
		frequency?: string;
		route?: DrugRoute;
	} {
		const result: {
			drugName: string;
			dosage?: string;
			frequency?: string;
			route?: DrugRoute;
		} = { drugName: '' };

		let cleaned = text.trim();

		// Extract frequency patterns like "2x1", "1x naponta", "3x2"
		const freqMatch = cleaned.match(/(\d+\s*x\s*\d+|\d+x\s*naponta|\d+x\d+)/i);
		if (freqMatch) {
			result.frequency = freqMatch[1];
			cleaned = cleaned.replace(freqMatch[0], '').trim();
		}

		// Extract dosage patterns
		const dosageMatch = cleaned.match(
			/(\d+[.,]?\d*)\s*(mg|g|ml|mcg|µg|mikrogramm|iu|ne|%)/i
		);
		if (dosageMatch) {
			result.dosage = dosageMatch[0].trim();
			// Don't remove dosage from name yet - it helps matching
		}

		// Extract route hints
		const routeKeywords: Record<string, DrugRoute> = {
			'i.v.': 'iv', 'iv': 'iv', 'intravénás': 'iv',
			'i.m.': 'im', 'im': 'im', 'intramuscularis': 'im',
			's.c.': 'sc', 'sc': 'sc', 'subcutan': 'sc',
			'p.o.': 'oral', 'per os': 'oral',
			'inhalációs': 'inhaled', 'spray': 'inhaled'
		};
		for (const [keyword, route] of Object.entries(routeKeywords)) {
			if (cleaned.toLowerCase().includes(keyword)) {
				result.route = route;
				cleaned = cleaned.replace(new RegExp(keyword, 'gi'), '').trim();
				break;
			}
		}

		// Clean up and extract drug name
		result.drugName = cleaned
			.replace(/(\d+[.,]?\d*)\s*(mg|g|ml|mcg|µg|mikrogramm|iu|ne|%)/gi, '')
			.replace(/\s+/g, ' ')
			.trim();

		// If drugName is empty but we have dosage, use original text without dosage
		if (!result.drugName && result.dosage) {
			result.drugName = text
				.replace(result.dosage, '')
				.replace(result.frequency || '', '')
				.replace(/\s+/g, ' ')
				.trim();
		}

		return result;
	}

	/**
	 * Get enhanced drug info with all relevant data for display
	 */
	async getEnhancedDrugInfo(drugId: string): Promise<{
		drug: Drug;
		dosageVariants: string[];
		routeDisplay: string;
		prescriptionLabel: string;
		formDisplay: string;
		atcDescription?: string;
		suggestedDosages: string[];
		suggestedFrequencies: string[];
	} | null> {
		const drug = await this.getDrugById(drugId);
		if (!drug) return null;

		// Get dosage variants
		const variants = await this.getDosageVariants(drugId);
		const dosageVariants = variants
			? [...new Set(variants.variants.map((v) => v.dosage).filter(Boolean))]
			: [];

		// Get route display name
		const routeDisplay = getRouteDisplayName(drug.route);

		// Get prescription label
		const prescriptionLabel = drug.prescriptionRequired
			? 'Vényköteles (Rx)'
			: 'Vény nélkül kapható (OTC)';

		// Format form display
		const formDisplay = drug.form
			? drug.form.charAt(0).toUpperCase() + drug.form.slice(1)
			: 'Ismeretlen';

		// Get ATC description if available
		const atcDescription = drug.atcDescription;

		// Suggest common dosages based on the drug's dosage unit
		const suggestedDosages = this.getSuggestedDosages(drug.dosage);

		// Suggest common frequencies
		const suggestedFrequencies = [
			'1x1 naponta',
			'2x1 naponta',
			'3x1 naponta',
			'1x2 naponta',
			'2x2 naponta',
			'Szükség szerint',
			'Hetente egyszer',
			'Kéthetente',
			'Havonta'
		];

		return {
			drug,
			dosageVariants,
			routeDisplay,
			prescriptionLabel,
			formDisplay,
			atcDescription,
			suggestedDosages,
			suggestedFrequencies
		};
	}

	/**
	 * Get suggested dosages based on a dosage string
	 */
	private getSuggestedDosages(dosage: string): string[] {
		if (!dosage) return [];

		// Extract unit from dosage
		const unitMatch = dosage.match(/(mg|g|ml|mcg|µg|iu|ne|%)/i);
		if (!unitMatch) return [];

		const unit = unitMatch[1].toLowerCase();
		const commonDosages: Record<string, string[]> = {
			mg: ['5 mg', '10 mg', '20 mg', '25 mg', '50 mg', '100 mg', '200 mg', '250 mg', '500 mg', '1000 mg'],
			g: ['0.5 g', '1 g', '2 g', '5 g', '10 g'],
			ml: ['1 ml', '2 ml', '5 ml', '10 ml', '20 ml', '50 ml', '100 ml'],
			mcg: ['25 mcg', '50 mcg', '100 mcg', '200 mcg', '400 mcg', '500 mcg'],
			'µg': ['25 µg', '50 µg', '100 µg', '200 µg', '400 µg', '500 µg'],
			iu: ['100 IU', '500 IU', '1000 IU', '5000 IU', '10000 IU'],
			ne: ['100 NE', '500 NE', '1000 NE', '5000 NE', '10000 NE'],
			'%': ['0.5%', '1%', '2%', '5%', '10%']
		};

		return commonDosages[unit] || [];
	}

	/**
	 * Smart search with ranking and grouping
	 * Returns results grouped by active ingredient with dosage variants
	 */
	async smartSearch(
		query: string,
		options: DrugSearchOptions & { groupByIngredient?: boolean } = {}
	): Promise<{
		results: Drug[];
		grouped: Map<string, Drug[]>;
		totalMatches: number;
		searchTimeMs: number;
	}> {
		const startTime = performance.now();
		const { groupByIngredient = true, limit = 50 } = options;

		const results = await this.searchDrugs(query, { ...options, limit: limit * 2 });

		// Group by active ingredient if requested
		const grouped = new Map<string, Drug[]>();
		if (groupByIngredient) {
			for (const drug of results) {
				const ingredient = drug.activeIngredient.toLowerCase() || 'unknown';
				if (!grouped.has(ingredient)) {
					grouped.set(ingredient, []);
				}
				grouped.get(ingredient)!.push(drug);
			}

			// Sort each group by dosage
			for (const drugs of grouped.values()) {
				drugs.sort((a, b) => {
					const numA = parseFloat((a.dosage || '0').replace(/[^\d.]/g, '')) || 0;
					const numB = parseFloat((b.dosage || '0').replace(/[^\d.]/g, '')) || 0;
					return numA - numB;
				});
			}
		}

		const searchTimeMs = Math.round(performance.now() - startTime);

		return {
			results: results.slice(0, limit),
			grouped,
			totalMatches: results.length,
			searchTimeMs
		};
	}

	/**
	 * Search drugs grouped by base name for two-step selection UX
	 * Returns unique base names with their dosage variants inline
	 */
	async searchDrugsGrouped(
		query: string,
		options: DrugSearchOptions = {}
	): Promise<GroupedDrugResult[]> {
		const startTime = performance.now();
		const { limit = 20 } = options;

		// Search more results than needed to ensure good grouping
		const results = await this.searchDrugs(query, { ...options, limit: limit * 5 });

		// Group by base name + active ingredient
		const groups = new Map<string, GroupedDrugResult>();

		for (const drug of results) {
			// Prefer stored baseName, then extract, then full name
			const baseName = drug.baseName || this.extractBaseDrugName(drug.name) || drug.name;
			const ingredient = drug.activeIngredient?.toLowerCase() || '';
			const groupKey = `${baseName.toLowerCase()}|${ingredient}`;

			if (!groups.has(groupKey)) {
				groups.set(groupKey, {
					baseName,
					displayName: baseName,
					activeIngredient: drug.activeIngredient || '',
					variants: [],
					defaultVariant: drug,
					variantCount: 0,
					atcCode: drug.atcCode || ''
				});
			}

			const group = groups.get(groupKey)!;
			group.variants.push({
				drug,
				dosage: drug.dosage || '',
				form: drug.form || '',
				isInMarket: drug.inMarket !== false
			});

			// Update default variant to prefer in-market drugs
			if (drug.inMarket && !group.defaultVariant.inMarket) {
				group.defaultVariant = drug;
			}
		}

		// Finalize groups
		const groupedResults: GroupedDrugResult[] = [];
		for (const group of groups.values()) {
			// Sort variants: in-market first, then by dosage numerically
			group.variants.sort((a, b) => {
				// In-market first
				if (a.isInMarket && !b.isInMarket) return -1;
				if (!a.isInMarket && b.isInMarket) return 1;

				// Then by dosage numerically
				const numA = parseFloat(a.dosage.replace(/[^\d.]/g, '')) || 0;
				const numB = parseFloat(b.dosage.replace(/[^\d.]/g, '')) || 0;
				return numA - numB;
			});

			// Deduplicate variants by dosage+form
			const seenVariants = new Set<string>();
			group.variants = group.variants.filter((v) => {
				const key = `${v.dosage}|${v.form}`;
				if (seenVariants.has(key)) return false;
				seenVariants.add(key);
				return true;
			});

			group.variantCount = group.variants.length;
			groupedResults.push(group);
		}

		// Sort groups by best match score (based on default variant priority)
		groupedResults.sort((a, b) => {
			const priorityA = a.defaultVariant.priority || 2;
			const priorityB = b.defaultVariant.priority || 2;
			if (priorityA !== priorityB) return priorityA - priorityB;

			// Then alphabetically
			return a.displayName.localeCompare(b.displayName);
		});

		const searchTimeMs = Math.round(performance.now() - startTime);
		console.log(
			`[DrugService] Grouped search "${query}": ${groupedResults.length} groups, ${searchTimeMs}ms`
		);

		return groupedResults.slice(0, limit);
	}

	/**
	 * Detect quality of active ingredient data
	 * Helps determine if we should use ATC fallback for FDA lookup
	 */
	detectIngredientQuality(drug: Drug): 'good' | 'name-in-ingredient' | 'empty' | 'generic' {
		if (!drug.activeIngredient || drug.activeIngredient.trim() === '') {
			return 'empty';
		}

		const normName = drug.name.toLowerCase().trim();
		const normIng = drug.activeIngredient.toLowerCase().trim();

		// Check if ingredient is just the drug name (bad data)
		if (normName.includes(normIng) || normIng.includes(normName.split(' ')[0])) {
			return 'name-in-ingredient';
		}

		// Check for generic placeholders
		const genericTerms = ['ismeretlen', 'vakcinák', 'egyéb', 'kombinációk', 'kombinációi'];
		for (const term of genericTerms) {
			if (normIng.includes(term)) {
				return 'generic';
			}
		}

		return 'good';
	}
}

// ============================================================================
// Grouped Search Result Types
// ============================================================================

export interface GroupedDrugResult {
	baseName: string;
	displayName: string;
	activeIngredient: string;
	variants: DrugVariant[];
	defaultVariant: Drug;
	variantCount: number;
	atcCode: string;
}

export interface DrugVariant {
	drug: Drug;
	dosage: string;
	form: string;
	isInMarket: boolean;
}

// ============================================================================
// Singleton Export
// ============================================================================

export const drugService = new DrugDatabaseService();

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format drug name with dosage for display
 */
export function formatDrugDisplay(drug: Drug | SimplifiedDrug): string {
	if (drug.dosage) {
		return `${drug.name} (${drug.dosage})`;
	}
	return drug.name;
}

/**
 * Get route display name in Hungarian
 */
export function getRouteDisplayName(route: DrugRoute): string {
	const routeNames: Record<DrugRoute, string> = {
		oral: 'Szájon át',
		iv: 'Intravénás',
		im: 'Intramuscularis',
		sc: 'Subcutan',
		topical: 'Külső',
		inhaled: 'Belégzéses',
		rectal: 'Végbélbe',
		ophthalmic: 'Szemészeti',
		otic: 'Fülbe',
		nasal: 'Orrba',
		vaginal: 'Hüvelyi',
		intrathecal: 'Intrathecalis',
		epidural: 'Epiduralis',
		transdermal: 'Transzdermális',
		sublingual: 'Nyelv alá',
		buccal: 'Bukkális'
	};
	return routeNames[route] || route;
}

/**
 * Get severity color class for drug interactions
 */
export function getInteractionSeverityColor(severity: DrugInteraction['severity']): string {
	const colors: Record<DrugInteraction['severity'], string> = {
		critical: 'text-red-500 bg-red-500/10 border-red-500',
		major: 'text-orange-500 bg-orange-500/10 border-orange-500',
		moderate: 'text-yellow-500 bg-yellow-500/10 border-yellow-500',
		minor: 'text-blue-500 bg-blue-500/10 border-blue-500',
		info: 'text-gray-500 bg-gray-500/10 border-gray-500'
	};
	return colors[severity] || colors.info;
}

/**
 * Get severity label in Hungarian
 */
export function getInteractionSeverityLabel(severity: DrugInteraction['severity']): string {
	const labels: Record<DrugInteraction['severity'], string> = {
		critical: 'Kritikus',
		major: 'Súlyos',
		moderate: 'Közepes',
		minor: 'Enyhe',
		info: 'Tájékoztató'
	};
	return labels[severity] || severity;
}
