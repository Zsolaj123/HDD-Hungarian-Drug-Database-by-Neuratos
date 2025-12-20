/**
 * Local Drug Expansion Service
 *
 * Persists PUPHAX drugs to localStorage when selected by the user.
 * This allows previously-selected online drugs to appear in local search results.
 *
 * Features:
 * - Automatic LRU eviction (max 1000 drugs)
 * - Usage tracking (addedAt, lastUsedAt, usageCount)
 * - Converts ExtendedDrug/DrugSummaryLight to SimplifiedDrug format
 * - Integrates with drug-database-service for hybrid search
 */

import type { SimplifiedDrug, DrugRoute } from './drug-database-service';
import type { ExtendedDrug, DrugSummaryLight } from './puphax-api-service';
import { smartDrugPresetService } from './smart-drug-preset-service';

// ============================================================================
// Configuration
// ============================================================================

const STORAGE_KEY = 'doctor-app-drug-expansion-cache';
const MAX_CACHE_SIZE = 1000;

// ============================================================================
// Type Definitions
// ============================================================================

export interface CachedDrug extends SimplifiedDrug {
	addedAt: number;        // Unix timestamp when first added
	lastUsedAt: number;     // Unix timestamp when last selected
	usageCount: number;     // Number of times selected
	sourceType: 'puphax';   // Origin marker
	originalId: string;     // Original PUPHAX ID
}

interface ExpansionCache {
	version: number;
	updatedAt: number;
	drugs: CachedDrug[];
}

// ============================================================================
// LocalDrugExpansionService Class
// ============================================================================

class LocalDrugExpansionService {
	private cache: ExpansionCache | null = null;
	private initialized = false;

	/**
	 * Initialize the service and load cache from localStorage
	 */
	initialize(): void {
		if (this.initialized) return;

		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				this.cache = JSON.parse(stored);
				// Migrate if needed
				if (!this.cache?.version) {
					this.cache = this.migrateCache(this.cache);
				}
			} else {
				this.cache = this.createEmptyCache();
			}
		} catch (error) {
			console.warn('[LocalDrugExpansion] Failed to load cache, creating new:', error);
			this.cache = this.createEmptyCache();
		}

		this.initialized = true;
	}

	/**
	 * Add a PUPHAX drug to the local expansion cache
	 */
	async addPuphaxDrug(drug: DrugSummaryLight | ExtendedDrug): Promise<void> {
		this.ensureInitialized();

		if (!drug || !drug.id) {
			console.warn('[LocalDrugExpansion] Invalid drug, skipping add');
			return;
		}

		// Check if already exists
		const existingIndex = this.cache!.drugs.findIndex(d => d.originalId === drug.id);
		const now = Date.now();

		if (existingIndex !== -1) {
			// Update usage stats
			this.cache!.drugs[existingIndex].lastUsedAt = now;
			this.cache!.drugs[existingIndex].usageCount++;
			// Move to end (most recently used)
			const [existing] = this.cache!.drugs.splice(existingIndex, 1);
			this.cache!.drugs.push(existing);
		} else {
			// Convert to SimplifiedDrug format
			const simplified = this.convertToSimplified(drug);
			const cached: CachedDrug = {
				...simplified,
				addedAt: now,
				lastUsedAt: now,
				usageCount: 1,
				sourceType: 'puphax',
				originalId: drug.id,
			};

			// Add to cache
			this.cache!.drugs.push(cached);

			// Evict if over limit (LRU - remove oldest unused)
			if (this.cache!.drugs.length > MAX_CACHE_SIZE) {
				this.evictLRU();
			}
		}

		this.cache!.updatedAt = now;
		this.saveCache();
	}

	/**
	 * Check if a drug is already in the expansion cache
	 */
	isInExpansionCache(drugId: string): boolean {
		this.ensureInitialized();
		return this.cache!.drugs.some(d => d.originalId === drugId || d.id === drugId);
	}

	/**
	 * Get all expanded drugs for search integration
	 */
	getExpandedDrugs(): SimplifiedDrug[] {
		this.ensureInitialized();
		return this.cache!.drugs.map(d => ({
			id: d.id,
			name: d.name,
			activeIngredient: d.activeIngredient,
			dosage: d.dosage,
			form: d.form,
			route: d.route,
			prescriptionRequired: d.prescriptionRequired,
			atcCode: d.atcCode,
		}));
	}

	/**
	 * Get cached drugs with full metadata
	 */
	getCachedDrugs(): CachedDrug[] {
		this.ensureInitialized();
		return [...this.cache!.drugs];
	}

	/**
	 * Get cache statistics
	 */
	getStats(): { count: number; oldestDate: Date | null; newestDate: Date | null } {
		this.ensureInitialized();
		const drugs = this.cache!.drugs;

		if (drugs.length === 0) {
			return { count: 0, oldestDate: null, newestDate: null };
		}

		const sorted = [...drugs].sort((a, b) => a.addedAt - b.addedAt);
		return {
			count: drugs.length,
			oldestDate: new Date(sorted[0].addedAt),
			newestDate: new Date(sorted[sorted.length - 1].addedAt),
		};
	}

	/**
	 * Clear the expansion cache
	 */
	clearCache(): void {
		this.cache = this.createEmptyCache();
		this.saveCache();
	}

	/**
	 * Remove a specific drug from cache
	 */
	removeDrug(drugId: string): boolean {
		this.ensureInitialized();
		const index = this.cache!.drugs.findIndex(d => d.originalId === drugId || d.id === drugId);
		if (index !== -1) {
			this.cache!.drugs.splice(index, 1);
			this.cache!.updatedAt = Date.now();
			this.saveCache();
			return true;
		}
		return false;
	}

	/**
	 * Prune old/unused entries to free space
	 * Removes drugs not used in the last 30 days if cache is > 75% full
	 */
	pruneCache(): number {
		this.ensureInitialized();

		if (this.cache!.drugs.length < MAX_CACHE_SIZE * 0.75) {
			return 0; // Don't prune if under 75% capacity
		}

		const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
		const originalCount = this.cache!.drugs.length;

		this.cache!.drugs = this.cache!.drugs.filter(d =>
			d.lastUsedAt > thirtyDaysAgo || d.usageCount > 3
		);

		const removed = originalCount - this.cache!.drugs.length;
		if (removed > 0) {
			this.cache!.updatedAt = Date.now();
			this.saveCache();
		}

		return removed;
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private ensureInitialized(): void {
		if (!this.initialized) {
			this.initialize();
		}
	}

	private createEmptyCache(): ExpansionCache {
		return {
			version: 1,
			updatedAt: Date.now(),
			drugs: [],
		};
	}

	private migrateCache(oldCache: unknown): ExpansionCache {
		// Handle old format or corrupted data
		const cache = this.createEmptyCache();

		if (oldCache && Array.isArray((oldCache as ExpansionCache).drugs)) {
			cache.drugs = (oldCache as ExpansionCache).drugs.map(d => ({
				...d,
				addedAt: d.addedAt || Date.now(),
				lastUsedAt: d.lastUsedAt || Date.now(),
				usageCount: d.usageCount || 1,
				sourceType: 'puphax' as const,
				originalId: d.originalId || d.id,
			}));
		}

		return cache;
	}

	private saveCache(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
		} catch (error) {
			console.error('[LocalDrugExpansion] Failed to save cache:', error);
			// If localStorage is full, try aggressive eviction
			if (error instanceof DOMException && error.name === 'QuotaExceededError') {
				this.evictLRU(100); // Remove 100 oldest entries
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
				} catch {
					console.error('[LocalDrugExpansion] Still failed after eviction');
				}
			}
		}
	}

	/**
	 * Evict least recently used entries
	 */
	private evictLRU(count: number = 1): void {
		// Sort by lastUsedAt (oldest first), then by usageCount (lowest first)
		this.cache!.drugs.sort((a, b) => {
			const timeDiff = a.lastUsedAt - b.lastUsedAt;
			if (timeDiff !== 0) return timeDiff;
			return a.usageCount - b.usageCount;
		});

		// Remove oldest entries
		this.cache!.drugs.splice(0, count);

		// Re-sort by addedAt to maintain insertion order
		this.cache!.drugs.sort((a, b) => a.addedAt - b.addedAt);
	}

	/**
	 * Convert PUPHAX drug to SimplifiedDrug format
	 */
	private convertToSimplified(drug: DrugSummaryLight | ExtendedDrug): SimplifiedDrug {
		// Try to infer route using the preset service
		let route: DrugRoute = 'oral'; // Default fallback

		const extendedDrug = drug as ExtendedDrug;
		if (extendedDrug.adagMod || extendedDrug.gyForma) {
			const inferred = smartDrugPresetService.inferRouteFromForm(
				extendedDrug.adagMod || extendedDrug.gyForma || ''
			);
			if (inferred) route = inferred;
		} else if (drug.productForm) {
			const inferred = smartDrugPresetService.inferRouteFromForm(drug.productForm);
			if (inferred) route = inferred;
		} else if (drug.name) {
			const inferred = smartDrugPresetService.inferRouteFromForm(drug.name);
			if (inferred) route = inferred;
		}

		// Build dosage string
		let dosage = drug.strength || '';
		if (extendedDrug.hatoMenny && extendedDrug.hatoEgys) {
			dosage = `${extendedDrug.hatoMenny} ${extendedDrug.hatoEgys}`;
		}

		// Build form string
		let form = drug.productForm || '';
		if (extendedDrug.gyForma) {
			form = extendedDrug.gyForma;
		}

		return {
			id: `puphax_${drug.id}`, // Prefix to distinguish from local drugs
			name: drug.name,
			activeIngredient: drug.activeIngredient || '',
			dosage,
			form,
			route,
			prescriptionRequired: drug.prescriptionRequired ?? true,
			atcCode: drug.atcCode || '',
		};
	}
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const localDrugExpansionService = new LocalDrugExpansionService();
export default localDrugExpansionService;
