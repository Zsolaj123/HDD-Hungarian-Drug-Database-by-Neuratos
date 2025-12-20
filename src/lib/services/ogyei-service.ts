/**
 * OGYÉI (Országos Gyógyszerészeti és Élelmezés-egészségügyi Intézet) Service
 *
 * Provides access to official Hungarian drug authorization data from OGYÉI.
 * Data source: https://ogyei.gov.hu/generalt_listak/tk_lista.csv
 *
 * Features:
 * - Drug lookup by name
 * - Prescription status information
 * - Product shortage tracking
 * - Safety element information
 * - Marketing authorization holder data
 */

// Types for OGYÉI drug data
export interface OgyeiPrescriptionInfo {
	code: string;
	label: string;
	labelEn: string;
	isPrescriptionRequired: boolean;
}

export interface OgyeiDrugEntry {
	id: string; // TK-szám (registration number)
	name: string;
	packSize: string;
	activeIngredient: string;
	atcCode: string | null;
	prescription: string; // Prescription status code
	marketingHolder: string;
	registrationDate: string | null;
	hasShortage: boolean;
}

export interface OgyeiDrugLookup {
	[baseName: string]: OgyeiDrugEntry[];
}

export interface OgyeiSearchResult {
	found: boolean;
	entries: OgyeiDrugEntry[];
	prescriptionInfo: OgyeiPrescriptionInfo | null;
	hasAnyShortage: boolean;
	uniquePackSizes: string[];
	uniqueMarketingHolders: string[];
}

// Prescription status definitions
const PRESCRIPTION_CODES: Record<string, OgyeiPrescriptionInfo> = {
	V: {
		code: 'V',
		label: 'Vényköteles',
		labelEn: 'Prescription only',
		isPrescriptionRequired: true
	},
	Sz: {
		code: 'Sz',
		label: 'Szabadon kapható',
		labelEn: 'OTC (Over-the-counter)',
		isPrescriptionRequired: false
	},
	I: {
		code: 'I',
		label: 'Intézeti',
		labelEn: 'Institutional only',
		isPrescriptionRequired: true
	},
	VN: {
		code: 'VN',
		label: 'Vényre nem adható',
		labelEn: 'Special (not general prescription)',
		isPrescriptionRequired: true
	},
	J: {
		code: 'J',
		label: 'Jelentésköteles',
		labelEn: 'Reportable',
		isPrescriptionRequired: true
	}
};

class OgyeiService {
	private lookupData: OgyeiDrugLookup | null = null;
	private loadPromise: Promise<void> | null = null;
	private lookupIndex: Map<string, string[]> = new Map(); // Normalized prefix -> base names

	/**
	 * Load the OGYÉI drug lookup data
	 */
	async load(): Promise<void> {
		if (this.lookupData) return;
		if (this.loadPromise) return this.loadPromise;

		this.loadPromise = this.doLoad();
		return this.loadPromise;
	}

	private async doLoad(): Promise<void> {
		try {
			console.log('[OgyeiService] Loading drug lookup data...');

			const response = await fetch('/data/ogyei/drug-lookup.json');
			if (!response.ok) {
				throw new Error(`Failed to load OGYÉI data: ${response.status}`);
			}

			this.lookupData = await response.json();

			// Build prefix index for fast searching
			this.buildPrefixIndex();

			console.log(
				`[OgyeiService] Loaded ${Object.keys(this.lookupData!).length} unique drug base names`
			);
		} catch (error) {
			console.error('[OgyeiService] Failed to load:', error);
			this.lookupData = {};
		}
	}

	/**
	 * Build a prefix index for fast name searching
	 */
	private buildPrefixIndex(): void {
		if (!this.lookupData) return;

		const baseNames = Object.keys(this.lookupData);
		for (const baseName of baseNames) {
			// Index by first 3 characters (normalized)
			const prefix = baseName.slice(0, 3).toLowerCase();
			if (!this.lookupIndex.has(prefix)) {
				this.lookupIndex.set(prefix, []);
			}
			this.lookupIndex.get(prefix)!.push(baseName);
		}
	}

	/**
	 * Search for a drug by name
	 * Returns all matching entries across different pack sizes
	 */
	async searchByName(drugName: string): Promise<OgyeiSearchResult> {
		await this.load();

		if (!this.lookupData || !drugName) {
			return {
				found: false,
				entries: [],
				prescriptionInfo: null,
				hasAnyShortage: false,
				uniquePackSizes: [],
				uniqueMarketingHolders: []
			};
		}

		// Normalize search term
		const normalizedSearch = drugName.toLowerCase().replace(/\s+/g, ' ').trim();

		// Get base name (before dosage numbers)
		const baseSearchKey = normalizedSearch.split(/\s+\d/)[0].trim();

		// Try exact match first
		let entries = this.lookupData[baseSearchKey] || [];

		// If no exact match, search through index
		if (entries.length === 0) {
			const prefix = normalizedSearch.slice(0, 3);
			const candidates = this.lookupIndex.get(prefix) || [];

			for (const candidate of candidates) {
				if (candidate.includes(normalizedSearch) || normalizedSearch.includes(candidate)) {
					entries = this.lookupData[candidate] || [];
					if (entries.length > 0) break;
				}
			}
		}

		// If still no match, try fuzzy search through all keys
		if (entries.length === 0) {
			const allKeys = Object.keys(this.lookupData);
			for (const key of allKeys) {
				// Check if key starts with our search or vice versa
				if (key.startsWith(normalizedSearch.slice(0, 5))) {
					entries = this.lookupData[key] || [];
					if (entries.length > 0) break;
				}
			}
		}

		if (entries.length === 0) {
			return {
				found: false,
				entries: [],
				prescriptionInfo: null,
				hasAnyShortage: false,
				uniquePackSizes: [],
				uniqueMarketingHolders: []
			};
		}

		// Get prescription info from first entry
		const prescriptionCode = entries[0]?.prescription;
		const prescriptionInfo = PRESCRIPTION_CODES[prescriptionCode] || null;

		// Check for any shortages
		const hasAnyShortage = entries.some((e) => e.hasShortage);

		// Get unique pack sizes
		const uniquePackSizes = [...new Set(entries.map((e) => e.packSize))];

		// Get unique marketing holders
		const uniqueMarketingHolders = [...new Set(entries.map((e) => e.marketingHolder))];

		return {
			found: true,
			entries,
			prescriptionInfo,
			hasAnyShortage,
			uniquePackSizes,
			uniqueMarketingHolders
		};
	}

	/**
	 * Get prescription status for a drug
	 */
	async getPrescriptionStatus(drugName: string): Promise<OgyeiPrescriptionInfo | null> {
		const result = await this.searchByName(drugName);
		return result.prescriptionInfo;
	}

	/**
	 * Check if a drug has any reported shortage
	 */
	async hasProductShortage(drugName: string): Promise<boolean> {
		const result = await this.searchByName(drugName);
		return result.hasAnyShortage;
	}

	/**
	 * Get all prescription code definitions
	 */
	getPrescriptionCodes(): Record<string, OgyeiPrescriptionInfo> {
		return { ...PRESCRIPTION_CODES };
	}

	/**
	 * Get prescription info by code
	 */
	getPrescriptionInfoByCode(code: string): OgyeiPrescriptionInfo | null {
		return PRESCRIPTION_CODES[code] || null;
	}

	/**
	 * Check if the service is loaded
	 */
	isLoaded(): boolean {
		return this.lookupData !== null;
	}

	/**
	 * Get the total number of unique drug names loaded
	 */
	getLoadedCount(): number {
		return this.lookupData ? Object.keys(this.lookupData).length : 0;
	}
}

// Export singleton instance
export const ogyeiService = new OgyeiService();
