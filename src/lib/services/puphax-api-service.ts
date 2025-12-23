/**
 * PUPHAX API Client Service
 *
 * TypeScript client for the PUPHAX REST API microservice.
 * Provides access to 43,930+ drugs from the Hungarian NEAK pharmaceutical database.
 *
 * Features:
 * - Health check on startup
 * - Hybrid search (local + PUPHAX)
 * - Lazy loading (light results → full details)
 * - Local caching (7-day TTL)
 * - Graceful fallback to local JSON when offline
 */

import { db } from '$lib/db';

// ============================================================================
// Configuration
// ============================================================================

// PUPHAX is a local microservice for NEAK data - only enable if configured
const PUPHAX_BASE_URL = import.meta.env.PUBLIC_PUPHAX_URL || '';
const PUPHAX_ENABLED = !!PUPHAX_BASE_URL;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SEARCH_DEBOUNCE_MS = 150;
const REQUEST_TIMEOUT_MS = 10000;

// ============================================================================
// Type Definitions (matching PUPHAX-service DTOs)
// ============================================================================

/**
 * Light drug summary for search results (10 fields)
 * Used for fast autocomplete without loading full details
 */
export interface DrugSummaryLight {
	id: string;
	name: string;
	manufacturer: string;
	atcCode: string;
	activeIngredient: string;
	prescriptionRequired: boolean;
	reimbursable: boolean;
	productForm: string;
	strength: string;
	packSize: string;
}

/**
 * Extended drug information (55 fields)
 * Loaded on-demand when user expands drug details
 */
export interface ExtendedDrug extends DrugSummaryLight {
	// Additional identification
	parentId?: string;
	shortName?: string;
	brandId?: string;
	termekKod?: string;
	kozHid?: string;
	tttCode?: string;
	tk?: string;
	tkTorles?: string;
	tkTorlesDate?: string;
	eanKod?: string;

	// Classification
	iso?: string;
	activeIngredients?: string[];

	// Pharmaceutical form details
	adagMod?: string; // Administration method
	gyForma?: string; // Form
	rendelhet?: string; // Prescribability
	helyettesith?: string; // Substitutability

	// Strength & Dosage
	potencia?: string;
	oHatoMenny?: string;
	hatoMenny?: string;
	hatoEgys?: string;
	kiszMenny?: string;
	kiszEgys?: string;
	dddMenny?: string; // Defined Daily Dose amount
	dddEgys?: string; // DDD unit
	dddFaktor?: string;
	dot?: string;
	adagMenny?: string;
	adagEgys?: string;

	// Special attributes
	egyedi?: string;
	oldalIsag?: string;
	tobblGar?: string;
	patika?: string;
	dobAzon?: string;
	keresztJelzes?: string;

	// Distribution
	forgEngtId?: string;
	forgazId?: string;
	inStock?: boolean;

	// Reimbursement
	supportPercent?: number;
	price?: number;

	// Validity & Status
	validFrom?: string;
	validTo?: string;
	status?: string;
	source?: 'csv' | 'soap';
	prescriptionStatus?: string;
	registrationNumber?: string;
}

/**
 * Search filter for advanced queries
 */
export interface DrugSearchFilter {
	searchTerm?: string;
	atcCodes?: string[];
	manufacturers?: string[];
	productForms?: string[];
	prescriptionRequired?: boolean;
	reimbursable?: boolean;
	inStock?: boolean;
	registrationNumber?: string;
	dataSource?: 'csv' | 'soap';
	page?: number;
	size?: number;
	sortBy?: 'name' | 'manufacturer' | 'atcCode';
	sortDirection?: 'ASC' | 'DESC';
}

/**
 * Pagination info from API responses
 */
export interface PaginationInfo {
	page: number;
	size: number;
	totalElements: number;
	totalPages: number;
	hasNext: boolean;
	hasPrevious: boolean;
}

/**
 * Search response from PUPHAX API
 */
export interface DrugSearchResponse {
	drugs: DrugSummaryLight[];
	pagination: PaginationInfo;
	searchInfo?: {
		term: string;
		filters: string[];
		executionTimeMs: number;
	};
}

/**
 * Health status from PUPHAX service
 */
export interface HealthStatus {
	status: 'UP' | 'DOWN' | 'DEGRADED';
	components?: {
		soap?: { status: string };
		csv?: { status: string };
		cache?: { status: string };
	};
	timestamp: string;
}

/**
 * Available filter options from API
 */
export interface FilterOptions {
	manufacturers: string[];
	productForms: string[];
	atcPrefixes: string[];
}

// ============================================================================
// Cache Storage (IndexedDB via Dexie)
// ============================================================================

interface CachedDrugDetails {
	id: string;
	drug: ExtendedDrug;
	cachedAt: Date;
	expiresAt: Date;
}

interface CachedSearchResult {
	key: string;
	results: DrugSummaryLight[];
	cachedAt: Date;
	expiresAt: Date;
}

// ============================================================================
// PUPHAX API Client Class
// ============================================================================

class PuphaxApiService {
	private isOnline: boolean = false;
	private lastHealthCheck: number = 0;
	private healthCheckIntervalMs: number = 60000; // 1 minute
	private detailsCache: Map<string, { drug: ExtendedDrug; expiresAt: number }> = new Map();
	private searchCache: Map<string, { results: DrugSummaryLight[]; expiresAt: number }> = new Map();

	// Rate limiting state
	private rateLimitState = {
		minuteCount: 0,
		minuteResetAt: Date.now() + 60000,
		hourCount: 0,
		hourResetAt: Date.now() + 3600000
	};

	// Rate limits (based on PUPHAX-service recommendations)
	private readonly RATE_LIMIT_PER_MINUTE = 60;
	private readonly RATE_LIMIT_PER_HOUR = 1000;

	// ========================================================================
	// Health Check
	// ========================================================================

	/**
	 * Check if PUPHAX service is available
	 * Caches result for 1 minute to avoid excessive checks
	 */
	async checkHealth(): Promise<boolean> {
		// Skip if PUPHAX is not configured
		if (!PUPHAX_ENABLED) {
			this.isOnline = false;
			return false;
		}

		const now = Date.now();

		// Use cached result if recent
		if (now - this.lastHealthCheck < this.healthCheckIntervalMs) {
			return this.isOnline;
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000);

			const response = await fetch(`${PUPHAX_BASE_URL}/api/v1/drugs/health`, {
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (response.ok) {
				const health: HealthStatus = await response.json();
				this.isOnline = health.status === 'UP' || health.status === 'DEGRADED';
			} else {
				this.isOnline = false;
			}
		} catch (error) {
			console.log('[PUPHAX] Service not available, using offline mode');
			this.isOnline = false;
		}

		this.lastHealthCheck = now;
		return this.isOnline;
	}

	/**
	 * Get current online status
	 */
	get online(): boolean {
		return this.isOnline;
	}

	// ========================================================================
	// Rate Limiting
	// ========================================================================

	/**
	 * Check if a request can be made within rate limits
	 */
	canMakeRequest(): boolean {
		this.updateRateLimitWindows();
		return (
			this.rateLimitState.minuteCount < this.RATE_LIMIT_PER_MINUTE &&
			this.rateLimitState.hourCount < this.RATE_LIMIT_PER_HOUR
		);
	}

	/**
	 * Record a request for rate limiting
	 */
	private recordRequest(): void {
		this.updateRateLimitWindows();
		this.rateLimitState.minuteCount++;
		this.rateLimitState.hourCount++;
	}

	/**
	 * Update rate limit windows if they've expired
	 */
	private updateRateLimitWindows(): void {
		const now = Date.now();

		// Reset minute counter if window expired
		if (now >= this.rateLimitState.minuteResetAt) {
			this.rateLimitState.minuteCount = 0;
			this.rateLimitState.minuteResetAt = now + 60000;
		}

		// Reset hour counter if window expired
		if (now >= this.rateLimitState.hourResetAt) {
			this.rateLimitState.hourCount = 0;
			this.rateLimitState.hourResetAt = now + 3600000;
		}
	}

	/**
	 * Get current rate limit status
	 */
	getRateLimitStatus(): {
		canMakeRequest: boolean;
		minuteRemaining: number;
		hourRemaining: number;
		minuteResetInMs: number;
		hourResetInMs: number;
	} {
		this.updateRateLimitWindows();
		const now = Date.now();

		return {
			canMakeRequest: this.canMakeRequest(),
			minuteRemaining: Math.max(0, this.RATE_LIMIT_PER_MINUTE - this.rateLimitState.minuteCount),
			hourRemaining: Math.max(0, this.RATE_LIMIT_PER_HOUR - this.rateLimitState.hourCount),
			minuteResetInMs: Math.max(0, this.rateLimitState.minuteResetAt - now),
			hourResetInMs: Math.max(0, this.rateLimitState.hourResetAt - now)
		};
	}

	// ========================================================================
	// Search Operations
	// ========================================================================

	/**
	 * Search drugs via PUPHAX API
	 * Returns light drug summaries for fast autocomplete
	 */
	async searchDrugs(
		term: string,
		options: {
			limit?: number;
			manufacturer?: string;
			atcCode?: string;
		} = {}
	): Promise<DrugSearchResponse | null> {
		if (!term || term.length < 2) {
			return null;
		}

		// Check cache first
		const cacheKey = `search:${term}:${JSON.stringify(options)}`;
		const cached = this.searchCache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) {
			return {
				drugs: cached.results,
				pagination: {
					page: 0,
					size: cached.results.length,
					totalElements: cached.results.length,
					totalPages: 1,
					hasNext: false,
					hasPrevious: false
				}
			};
		}

		// Check if online
		const isAvailable = await this.checkHealth();
		if (!isAvailable) {
			return null;
		}

		// Check rate limits
		if (!this.canMakeRequest()) {
			console.warn('[PUPHAX] Rate limit reached, skipping request');
			return null;
		}

		try {
			const params = new URLSearchParams({
				term,
				size: String(options.limit || 20)
			});

			if (options.manufacturer) {
				params.append('manufacturer', options.manufacturer);
			}
			if (options.atcCode) {
				params.append('atcCode', options.atcCode);
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

			const response = await fetch(
				`${PUPHAX_BASE_URL}/api/v1/drugs/search?${params.toString()}`,
				{ signal: controller.signal }
			);

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(`Search failed: ${response.status}`);
			}

			const data: DrugSearchResponse = await response.json();

			// Record successful request for rate limiting
			this.recordRequest();

			// Cache results for 1 hour
			this.searchCache.set(cacheKey, {
				results: data.drugs,
				expiresAt: Date.now() + 60 * 60 * 1000
			});

			return data;
		} catch (error) {
			console.error('[PUPHAX] Search failed:', error);
			return null;
		}
	}

	/**
	 * Advanced search with multiple filters
	 */
	async advancedSearch(filter: DrugSearchFilter): Promise<DrugSearchResponse | null> {
		const isAvailable = await this.checkHealth();
		if (!isAvailable) {
			return null;
		}

		// Check rate limits
		if (!this.canMakeRequest()) {
			console.warn('[PUPHAX] Rate limit reached, skipping advanced search');
			return null;
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

			const response = await fetch(`${PUPHAX_BASE_URL}/api/v1/drugs/search/advanced`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(filter),
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(`Advanced search failed: ${response.status}`);
			}

			// Record successful request for rate limiting
			this.recordRequest();

			return await response.json();
		} catch (error) {
			console.error('[PUPHAX] Advanced search failed:', error);
			return null;
		}
	}

	// ========================================================================
	// Drug Details (Lazy Loading)
	// ========================================================================

	/**
	 * Get full drug details (55 fields) from PUPHAX
	 * Uses lazy loading - only fetches when user requests details
	 */
	async getDrugDetails(drugId: string): Promise<ExtendedDrug | null> {
		if (!drugId) return null;

		// Check memory cache first
		const cached = this.detailsCache.get(drugId);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.drug;
		}

		// Check if online
		const isAvailable = await this.checkHealth();
		if (!isAvailable) {
			return null;
		}

		// Check rate limits
		if (!this.canMakeRequest()) {
			console.warn('[PUPHAX] Rate limit reached, skipping details request');
			return null;
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

			const response = await fetch(`${PUPHAX_BASE_URL}/api/v1/drugs/${drugId}/details`, {
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				if (response.status === 404) {
					return null;
				}
				throw new Error(`Get details failed: ${response.status}`);
			}

			const drug: ExtendedDrug = await response.json();

			// Record successful request for rate limiting
			this.recordRequest();

			// Cache for 7 days (stable data)
			this.detailsCache.set(drugId, {
				drug,
				expiresAt: Date.now() + CACHE_TTL_MS
			});

			return drug;
		} catch (error) {
			console.error('[PUPHAX] Get details failed:', error);
			return null;
		}
	}

	// ========================================================================
	// Utility Methods
	// ========================================================================

	/**
	 * Get available filter options (manufacturers, forms, etc.)
	 */
	async getFilterOptions(): Promise<FilterOptions | null> {
		const isAvailable = await this.checkHealth();
		if (!isAvailable) {
			return null;
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

			const response = await fetch(`${PUPHAX_BASE_URL}/api/v1/drugs/filters`, {
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(`Get filters failed: ${response.status}`);
			}

			return await response.json();
		} catch (error) {
			console.error('[PUPHAX] Get filters failed:', error);
			return null;
		}
	}

	/**
	 * Get drugs with the same active ingredient (generic alternatives)
	 */
	async getAlternatives(activeIngredient: string, limit: number = 20): Promise<DrugSummaryLight[]> {
		if (!activeIngredient) return [];

		const response = await this.advancedSearch({
			searchTerm: activeIngredient,
			size: limit
		});

		return response?.drugs || [];
	}

	/**
	 * Get common dosages for drugs with same active ingredient
	 */
	async getCommonDosages(activeIngredient: string): Promise<string[]> {
		const alternatives = await this.getAlternatives(activeIngredient, 50);

		// Extract unique strengths/dosages
		const dosages = new Set<string>();
		for (const drug of alternatives) {
			if (drug.strength) {
				dosages.add(drug.strength);
			}
		}

		return Array.from(dosages).sort();
	}

	/**
	 * Get detailed health information
	 */
	async getHealthDetails(): Promise<HealthStatus | null> {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000);

			const response = await fetch(`${PUPHAX_BASE_URL}/api/v1/drugs/health`, {
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				return null;
			}

			return await response.json();
		} catch (error) {
			return null;
		}
	}

	// ========================================================================
	// Cache Management
	// ========================================================================

	/**
	 * Clear all caches
	 */
	clearCache(): void {
		this.detailsCache.clear();
		this.searchCache.clear();
		console.log('[PUPHAX] Cache cleared');
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): { detailsCached: number; searchesCached: number } {
		return {
			detailsCached: this.detailsCache.size,
			searchesCached: this.searchCache.size
		};
	}

	/**
	 * Force refresh online status
	 */
	async refreshStatus(): Promise<boolean> {
		this.lastHealthCheck = 0;
		return this.checkHealth();
	}
}

// ============================================================================
// Singleton Export
// ============================================================================

export const puphaxService = new PuphaxApiService();

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format drug name with strength for display
 */
export function formatDrugWithStrength(drug: DrugSummaryLight | ExtendedDrug): string {
	if (drug.strength) {
		return `${drug.name} ${drug.strength}`;
	}
	return drug.name;
}

/**
 * Get prescription status display text (Hungarian)
 */
export function getPrescriptionLabel(drug: DrugSummaryLight | ExtendedDrug): string {
	return drug.prescriptionRequired ? 'Vényköteles' : 'Recept nélküli';
}

/**
 * Get prescription badge color
 */
export function getPrescriptionBadgeClass(prescriptionRequired: boolean): string {
	return prescriptionRequired
		? 'bg-red-500/20 text-red-400 border-red-500/40'
		: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
}

/**
 * Get reimbursement display text (Hungarian)
 */
export function getReimbursementLabel(drug: DrugSummaryLight | ExtendedDrug): string {
	return drug.reimbursable ? 'Támogatott' : 'Nem támogatott';
}

/**
 * Format DDD (Defined Daily Dose) for display
 */
export function formatDDD(drug: ExtendedDrug): string | null {
	if (!drug.dddMenny || !drug.dddEgys) return null;
	return `${drug.dddMenny} ${drug.dddEgys}`;
}

/**
 * Format price with currency
 */
export function formatPrice(price: number | undefined): string {
	if (price === undefined || price === null) return 'N/A';
	return `${price.toLocaleString('hu-HU')} Ft`;
}

/**
 * Get support percentage display
 */
export function formatSupportPercent(percent: number | undefined): string {
	if (percent === undefined || percent === null) return 'N/A';
	return `${percent}%`;
}
