/**
 * Drug Indication Service
 *
 * Provides drug-indication-BNO mapping functionality:
 * - Get indications for a drug
 * - Find drugs for a BNO diagnosis code
 * - Search indications by text
 */

export interface DrugBnoLink {
	code: string;
	description: string;
	offLabel: boolean;
}

export interface DrugIndication {
	description: string;
	euPointType: string;
	offLabel: boolean;
}

export interface DrugEligibility {
	category: string;
	eligible: string;
	timeLimit: number | null;
	specialtyId: number | null;
}

export interface DrugIndicationEntry {
	drugId: string;
	drugName: string;
	tttCode: string;
	atcCode: string;
	activeIngredient: string;
	inMarket: boolean;
	bnoCodes: DrugBnoLink[];
	indications: DrugIndication[];
	eligibility: DrugEligibility[];
	euPointCount: number;
}

export interface BnoToDrug {
	drugId: string;
	drugName: string;
	tttCode: string;
	offLabel: boolean;
}

export interface BnoDrugEntry {
	code: string;
	description: string;
	drugs: BnoToDrug[];
}

interface DrugIndicationsDatabase {
	meta: {
		totalDrugsWithIndications: number;
		drugsWithBnoCodes: number;
		totalDrugBnoLinks: number;
	};
	drugIndications: DrugIndicationEntry[];
}

interface BnoToDrugsDatabase {
	meta: {
		totalBnoCodes: number;
	};
	bnoToDrugs: BnoDrugEntry[];
}

class IndicationService {
	private drugIndications: DrugIndicationsDatabase | null = null;
	private bnoToDrugs: BnoToDrugsDatabase | null = null;
	private isLoading = false;
	private loadPromise: Promise<void> | null = null;

	// Lookup indices
	private indicationsByDrugId: Map<string, DrugIndicationEntry> = new Map();
	private indicationsByTttCode: Map<string, DrugIndicationEntry> = new Map();
	private drugsByBnoCode: Map<string, BnoDrugEntry> = new Map();

	/**
	 * Initialize the service by loading the databases
	 */
	async initialize(): Promise<void> {
		if (this.drugIndications && this.bnoToDrugs) return;

		if (this.loadPromise) {
			await this.loadPromise;
			return;
		}

		this.loadPromise = this.loadDatabases();
		await this.loadPromise;
	}

	private async loadDatabases(): Promise<void> {
		if (this.isLoading) return;
		this.isLoading = true;

		try {
			const [indicationsRes, bnoRes] = await Promise.all([
				fetch('/data/indications/drug-indications.json'),
				fetch('/data/indications/bno-to-drugs.json')
			]);

			if (!indicationsRes.ok || !bnoRes.ok) {
				throw new Error('Failed to load indication databases');
			}

			this.drugIndications = await indicationsRes.json();
			this.bnoToDrugs = await bnoRes.json();

			this.buildIndices();

			console.log(
				`[IndicationService] Loaded ${this.drugIndications?.meta.totalDrugsWithIndications} drug indications, ${this.bnoToDrugs?.meta.totalBnoCodes} BNO codes`
			);
		} catch (error) {
			console.error('[IndicationService] Failed to load databases:', error);
			throw error;
		} finally {
			this.isLoading = false;
		}
	}

	private buildIndices(): void {
		// Index drug indications
		if (this.drugIndications?.drugIndications) {
			for (const di of this.drugIndications.drugIndications) {
				this.indicationsByDrugId.set(di.drugId, di);
				if (di.tttCode) {
					this.indicationsByTttCode.set(di.tttCode, di);
				}
			}
		}

		// Index BNO to drugs
		if (this.bnoToDrugs?.bnoToDrugs) {
			for (const entry of this.bnoToDrugs.bnoToDrugs) {
				this.drugsByBnoCode.set(entry.code.toUpperCase(), entry);
			}
		}
	}

	/**
	 * Get indications for a drug by ID
	 */
	async getIndicationsForDrug(drugId: string): Promise<DrugIndicationEntry | null> {
		await this.initialize();
		return this.indicationsByDrugId.get(drugId) || null;
	}

	/**
	 * Get indications for a drug by TTT code
	 */
	async getIndicationsByTttCode(tttCode: string): Promise<DrugIndicationEntry | null> {
		await this.initialize();
		return this.indicationsByTttCode.get(tttCode) || null;
	}

	/**
	 * Get drugs for a BNO diagnosis code
	 */
	async getDrugsForBno(bnoCode: string): Promise<BnoDrugEntry | null> {
		await this.initialize();
		return this.drugsByBnoCode.get(bnoCode.toUpperCase()) || null;
	}

	/**
	 * Search BNO codes that have drug mappings
	 */
	async searchBnoWithDrugs(
		query: string,
		options: { limit?: number; inMarketOnly?: boolean } = {}
	): Promise<BnoDrugEntry[]> {
		await this.initialize();

		if (!this.bnoToDrugs?.bnoToDrugs || !query || query.length < 2) {
			return [];
		}

		const { limit = 20, inMarketOnly = false } = options;
		const normalizedQuery = query
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');

		const results: Array<{ entry: BnoDrugEntry; score: number }> = [];

		for (const entry of this.bnoToDrugs.bnoToDrugs) {
			const codeNorm = entry.code.toLowerCase();
			const descNorm = entry.description
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '');

			let score = 0;

			// Code exact match
			if (codeNorm === normalizedQuery) {
				score = 100;
			}
			// Code starts with
			else if (codeNorm.startsWith(normalizedQuery)) {
				score = 80;
			}
			// Description contains
			else if (descNorm.includes(normalizedQuery)) {
				score = 50;
			}

			if (score > 0) {
				let filteredEntry = entry;

				// Filter to in-market drugs if requested
				if (inMarketOnly) {
					// Note: We don't have inMarket in BnoToDrug, would need to cross-reference
					// For now, just return all
				}

				results.push({ entry: filteredEntry, score });
			}
		}

		results.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.entry.code.localeCompare(b.entry.code);
		});

		return results.slice(0, limit).map((r) => r.entry);
	}

	/**
	 * Search drugs that have indications
	 */
	async searchDrugsWithIndications(
		query: string,
		options: { limit?: number; inMarketOnly?: boolean; hasBnoCodes?: boolean } = {}
	): Promise<DrugIndicationEntry[]> {
		await this.initialize();

		if (!this.drugIndications?.drugIndications || !query || query.length < 2) {
			return [];
		}

		const { limit = 20, inMarketOnly = false, hasBnoCodes = false } = options;
		const normalizedQuery = query
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');

		const results: Array<{ entry: DrugIndicationEntry; score: number }> = [];

		for (const entry of this.drugIndications.drugIndications) {
			// Filter by market status
			if (inMarketOnly && !entry.inMarket) continue;

			// Filter by BNO codes presence
			if (hasBnoCodes && entry.bnoCodes.length === 0) continue;

			const nameNorm = entry.drugName
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '');
			const ingredientNorm = entry.activeIngredient
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '');

			let score = 0;

			// Name starts with
			if (nameNorm.startsWith(normalizedQuery)) {
				score = 80;
			}
			// Name contains
			else if (nameNorm.includes(normalizedQuery)) {
				score = 60;
			}
			// Active ingredient match
			else if (ingredientNorm.includes(normalizedQuery)) {
				score = 50;
			}
			// ATC code match
			else if (entry.atcCode.toLowerCase().includes(normalizedQuery)) {
				score = 40;
			}

			if (score > 0) {
				// Boost in-market drugs
				if (entry.inMarket) score += 10;
				// Boost drugs with BNO codes
				if (entry.bnoCodes.length > 0) score += 5;

				results.push({ entry, score });
			}
		}

		results.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.entry.drugName.localeCompare(b.entry.drugName);
		});

		return results.slice(0, limit).map((r) => r.entry);
	}

	/**
	 * Get all BNO codes for a given ATC code (all drugs with that ATC)
	 */
	async getBnoCodesForAtc(atcCode: string): Promise<DrugBnoLink[]> {
		await this.initialize();

		if (!this.drugIndications?.drugIndications) return [];

		const bnoMap = new Map<string, DrugBnoLink>();

		for (const entry of this.drugIndications.drugIndications) {
			if (entry.atcCode.toUpperCase().startsWith(atcCode.toUpperCase())) {
				for (const bno of entry.bnoCodes) {
					if (!bnoMap.has(bno.code)) {
						bnoMap.set(bno.code, bno);
					}
				}
			}
		}

		return Array.from(bnoMap.values()).sort((a, b) => a.code.localeCompare(b.code));
	}

	/**
	 * Get statistics
	 */
	async getStatistics(): Promise<{
		totalDrugsWithIndications: number;
		drugsWithBnoCodes: number;
		totalDrugBnoLinks: number;
		totalBnoCodesWithDrugs: number;
	}> {
		await this.initialize();

		return {
			totalDrugsWithIndications: this.drugIndications?.meta.totalDrugsWithIndications || 0,
			drugsWithBnoCodes: this.drugIndications?.meta.drugsWithBnoCodes || 0,
			totalDrugBnoLinks: this.drugIndications?.meta.totalDrugBnoLinks || 0,
			totalBnoCodesWithDrugs: this.bnoToDrugs?.meta.totalBnoCodes || 0
		};
	}

	/**
	 * Check if a drug has indications
	 */
	async hasIndications(drugId: string): Promise<boolean> {
		await this.initialize();
		return this.indicationsByDrugId.has(drugId);
	}

	/**
	 * Get all drugs for MS (G35*) - convenience method
	 */
	async getMsDrugs(): Promise<BnoDrugEntry[]> {
		await this.initialize();

		const msCodes = ['G35', 'G35H0', 'G35H1', 'G35H2', 'G35H3'];
		const results: BnoDrugEntry[] = [];

		for (const code of msCodes) {
			const entry = this.drugsByBnoCode.get(code);
			if (entry) {
				results.push(entry);
			}
		}

		return results;
	}
}

// Export singleton instance
export const indicationService = new IndicationService();
