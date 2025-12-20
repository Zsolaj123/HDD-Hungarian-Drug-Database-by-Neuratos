/**
 * Szervrendszer (Organ System) Service
 *
 * Provides organ system-based grouping for BNO codes.
 * Maps ICD-10 chapters to Hungarian organ systems with subgroups.
 */

import { bnoService, type BnoCode } from './bno-database-service';
import { indicationService } from './indication-service';

export interface OrganSubgroup {
	id: string;
	name: string;
	codes: string[];
	priority: number;
}

export interface OrganSystem {
	id: string;
	name: string;
	nameEn: string;
	icon: string;
	color: string;
	chapters: string[];
	codeRanges: string[];
	description: string;
	subgroups: OrganSubgroup[];
}

export interface OrganSystemStats {
	codeCount: number;
	drugCount: number;
	subgroupStats: Map<string, { codeCount: number; drugCount: number }>;
}

interface SzervrendszerDatabase {
	meta: {
		source: string;
		createdAt: string;
		description: string;
	};
	organSystems: OrganSystem[];
}

class SzervrendszerService {
	private organSystems: OrganSystem[] = [];
	private systemById: Map<string, OrganSystem> = new Map();
	private systemByChapter: Map<string, OrganSystem> = new Map();
	private statsCache: Map<string, OrganSystemStats> = new Map();
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	/**
	 * Initialize the service by loading organ system data
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = this.load();
		await this.initPromise;
		this.initialized = true;
	}

	private async load(): Promise<void> {
		try {
			const response = await fetch('/data/bno/szervrendszer-groups.json');
			if (!response.ok) {
				throw new Error(`Failed to load szervrendszer groups: ${response.status}`);
			}

			const data: SzervrendszerDatabase = await response.json();
			this.organSystems = data.organSystems;

			// Build indices
			for (const system of this.organSystems) {
				this.systemById.set(system.id, system);
				for (const chapter of system.chapters) {
					this.systemByChapter.set(chapter, system);
				}
			}

			console.log(`[SzervrendszerService] Loaded ${this.organSystems.length} organ systems`);
		} catch (error) {
			console.error('[SzervrendszerService] Failed to load organ systems:', error);
		}
	}

	/**
	 * Get all organ systems
	 */
	getAllOrganSystems(): OrganSystem[] {
		return this.organSystems;
	}

	/**
	 * Get organ system by ID
	 */
	getOrganSystem(systemId: string): OrganSystem | null {
		return this.systemById.get(systemId) || null;
	}

	/**
	 * Get organ system for a BNO code
	 */
	getOrganSystemForCode(bnoCode: string): OrganSystem | null {
		if (!bnoCode || bnoCode.length < 1) return null;

		const chapter = bnoCode.charAt(0).toUpperCase();
		return this.systemByChapter.get(chapter) || null;
	}

	/**
	 * Get subgroup for a BNO code
	 */
	getSubgroupForCode(bnoCode: string): { system: OrganSystem; subgroup: OrganSubgroup } | null {
		const system = this.getOrganSystemForCode(bnoCode);
		if (!system) return null;

		const codePrefix = bnoCode.substring(0, 3).toUpperCase();

		for (const subgroup of system.subgroups) {
			for (const code of subgroup.codes) {
				if (codePrefix === code || codePrefix.startsWith(code)) {
					return { system, subgroup };
				}
			}
		}

		return null;
	}

	/**
	 * Expand code patterns to actual BNO codes
	 */
	async expandCodePattern(pattern: string): Promise<string[]> {
		await bnoService.initialize();

		// Handle range patterns like "G20-G26"
		if (pattern.includes('-')) {
			const [start, end] = pattern.split('-');
			return bnoService.searchByRange(start.trim(), end.trim()).map((c: BnoCode) => c.code);
		}

		// Handle prefix patterns like "G35"
		return bnoService.searchByPrefix(pattern).map((c: BnoCode) => c.code);
	}

	/**
	 * Get all BNO codes for an organ system
	 */
	async getCodesForOrganSystem(systemId: string): Promise<BnoCode[]> {
		const system = this.getOrganSystem(systemId);
		if (!system) return [];

		await bnoService.initialize();

		const codes: BnoCode[] = [];
		const seenCodes = new Set<string>();

		for (const chapter of system.chapters) {
			const chapterCodes = await bnoService.getByChapter(chapter);
			for (const code of chapterCodes) {
				if (!seenCodes.has(code.code)) {
					codes.push(code);
					seenCodes.add(code.code);
				}
			}
		}

		return codes;
	}

	/**
	 * Get BNO codes for a specific subgroup
	 */
	async getCodesForSubgroup(systemId: string, subgroupId: string): Promise<BnoCode[]> {
		const system = this.getOrganSystem(systemId);
		if (!system) return [];

		const subgroup = system.subgroups.find((s) => s.id === subgroupId);
		if (!subgroup) return [];

		await bnoService.initialize();

		const codes: BnoCode[] = [];
		const seenCodes = new Set<string>();

		for (const pattern of subgroup.codes) {
			const expanded = await this.expandCodePattern(pattern);
			for (const codeStr of expanded) {
				if (!seenCodes.has(codeStr)) {
					const bnoCode = await bnoService.getByCode(codeStr);
					if (bnoCode) {
						codes.push(bnoCode);
						seenCodes.add(codeStr);
					}
				}
			}
		}

		return codes;
	}

	/**
	 * Get drugs for an organ system
	 */
	async getDrugsForOrganSystem(systemId: string, limit = 100): Promise<{ drugId: string; drugName: string; bnoCode: string }[]> {
		const codes = await this.getCodesForOrganSystem(systemId);
		if (codes.length === 0) return [];

		await indicationService.initialize();

		const drugs: { drugId: string; drugName: string; bnoCode: string }[] = [];
		const seenDrugs = new Set<string>();

		// Sample first N codes for performance
		const sampleCodes = codes.slice(0, Math.min(codes.length, 50));

		for (const code of sampleCodes) {
			const bnoEntry = await indicationService.getDrugsForBno(code.code);
			if (bnoEntry) {
				for (const drug of bnoEntry.drugs) {
					if (!seenDrugs.has(drug.drugId) && drugs.length < limit) {
						drugs.push({
							drugId: drug.drugId,
							drugName: drug.drugName,
							bnoCode: code.code
						});
						seenDrugs.add(drug.drugId);
					}
				}
			}
		}

		return drugs;
	}

	/**
	 * Search within an organ system
	 */
	async searchWithinSystem(systemId: string, query: string, limit = 30): Promise<BnoCode[]> {
		const system = this.getOrganSystem(systemId);
		if (!system) return [];

		await bnoService.initialize();

		// Get all codes for this system's chapters
		const systemCodes: BnoCode[] = [];
		for (const chapter of system.chapters) {
			const chapterCodes = await bnoService.getByChapter(chapter);
			systemCodes.push(...chapterCodes);
		}

		// Filter by query
		const normalizedQuery = this.normalizeQuery(query);
		const results = systemCodes
			.filter((code) => {
				return (
					code.searchCode.includes(normalizedQuery) ||
					code.searchDesc.includes(normalizedQuery)
				);
			})
			.slice(0, limit);

		return results;
	}

	private normalizeQuery(query: string): string {
		return query
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');
	}

	/**
	 * Get statistics for all organ systems (cached)
	 */
	async getSystemStats(): Promise<Map<string, OrganSystemStats>> {
		if (this.statsCache.size > 0) {
			return this.statsCache;
		}

		await bnoService.initialize();
		await indicationService.initialize();

		for (const system of this.organSystems) {
			let totalCodeCount = 0;
			const drugIds = new Set<string>();
			const subgroupStats = new Map<string, { codeCount: number; drugCount: number }>();

			// Count codes per chapter
			for (const chapter of system.chapters) {
				const chapterCodes = await bnoService.getByChapter(chapter);
				totalCodeCount += chapterCodes.length;

				// Sample some codes for drug count (performance)
				const sampleCodes = chapterCodes.slice(0, 20);
				for (const code of sampleCodes) {
					const bnoEntry = await indicationService.getDrugsForBno(code.code);
					if (bnoEntry) {
						for (const drug of bnoEntry.drugs) {
							drugIds.add(drug.drugId);
						}
					}
				}
			}

			// Calculate subgroup stats (sample for performance)
			for (const subgroup of system.subgroups) {
				const subgroupDrugIds = new Set<string>();
				let subgroupCodeCount = 0;

				for (const pattern of subgroup.codes.slice(0, 3)) {
					const codes = bnoService.searchByPrefix(pattern);
					subgroupCodeCount += codes.length;

					const sampleCodes = codes.slice(0, 10);
					for (const code of sampleCodes) {
						const bnoEntry = await indicationService.getDrugsForBno(code.code);
						if (bnoEntry) {
							for (const drug of bnoEntry.drugs) {
								subgroupDrugIds.add(drug.drugId);
							}
						}
					}
				}

				subgroupStats.set(subgroup.id, {
					codeCount: subgroupCodeCount,
					drugCount: subgroupDrugIds.size
				});
			}

			this.statsCache.set(system.id, {
				codeCount: totalCodeCount,
				drugCount: drugIds.size,
				subgroupStats
			});
		}

		return this.statsCache;
	}

	/**
	 * Clear stats cache (call when data changes)
	 */
	clearStatsCache(): void {
		this.statsCache.clear();
	}

	/**
	 * Check if service is initialized
	 */
	isInitialized(): boolean {
		return this.initialized;
	}
}

// Export singleton instance
export const szervrendszerService = new SzervrendszerService();
