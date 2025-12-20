/**
 * Drug Clinical Service
 *
 * Unified service to aggregate clinical data from multiple sources:
 * - NEAK indication/EU points data (local)
 * - OpenFDA drug labels (API)
 *
 * Provides contraindications, drug interactions, warnings, BNO indications,
 * special reimbursement info (egyedi méltányosság), and prescriber eligibility.
 */

import { indicationService, type DrugIndicationEntry, type DrugBnoLink, type DrugEligibility } from './indication-service';
import { openFdaService, type OpenFdaDrugLabel } from './openfda-service';

// ============================================================================
// Types
// ============================================================================

export interface EuPointInfo {
	id: string;
	type: string; // "Normatív", "EÜ emelt", "EÜ kiemelt"
	prescription: string; // Prescriber specialty requirements
	notes: string; // Special conditions
	isEgyediMeltanyossag: boolean;
	indications: { index: number; description: string }[];
}

export interface ClinicalWarning {
	id: string;
	severity: 'critical' | 'high' | 'moderate' | 'info';
	type: 'contraindication' | 'interaction' | 'warning' | 'boxed' | 'reimbursement' | 'eligibility';
	title: string;
	summary: string;
	fullText?: string;
	source: 'neak' | 'fda';
}

export interface DrugClinicalData {
	// Basic identification
	drugId: string;
	drugName: string;
	genericName?: string;

	// From indication-service (NEAK)
	bnoIndications: DrugBnoLink[];
	euPointInfo: EuPointInfo[];
	eligibility: DrugEligibility[];
	hasNeakData: boolean;

	// From openfda-service
	fdaLabel: OpenFdaDrugLabel | null;
	hasFdaData: boolean;

	// Computed warnings (sorted by severity)
	clinicalWarnings: ClinicalWarning[];

	// Quick access flags
	hasContraindications: boolean;
	hasInteractions: boolean;
	hasBoxedWarning: boolean;
	hasEgyediMeltanyossag: boolean;
	hasPrescriberRestrictions: boolean;

	// Loading state
	isLoading: boolean;
	error: string | null;
}

// ============================================================================
// EU Points Database
// ============================================================================

interface EuPointsDatabase {
	meta: {
		totalPoints: number;
	};
	euPoints: {
		id: string;
		type: string;
		codeNumber: string;
		indicationType: string;
		prescription: string;
		notes: string;
		bnoCodes: { id: string; code: string; description: string }[];
		indications: { index: number; description: string }[];
		eligibility: { category: string; eligible: string; timeLimit: number | null; specialtyId: number | null }[];
	}[];
}

// ============================================================================
// Cache
// ============================================================================

const cache = new Map<string, { data: DrugClinicalData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Service Class
// ============================================================================

class DrugClinicalService {
	private euPointsDb: EuPointsDatabase | null = null;
	private euPointsById: Map<string, EuPointsDatabase['euPoints'][0]> = new Map();
	private isLoading = false;
	private loadPromise: Promise<void> | null = null;

	/**
	 * Initialize by loading EU points database
	 */
	async initialize(): Promise<void> {
		if (this.euPointsDb) return;

		if (this.loadPromise) {
			await this.loadPromise;
			return;
		}

		this.loadPromise = this.loadEuPoints();
		await this.loadPromise;
	}

	private async loadEuPoints(): Promise<void> {
		if (this.isLoading) return;
		this.isLoading = true;

		try {
			const response = await fetch('/data/indications/eu-points.json');
			if (!response.ok) {
				throw new Error('Failed to load EU points database');
			}

			this.euPointsDb = await response.json();
			this.buildEuPointsIndex();

			console.log(`[DrugClinicalService] Loaded ${this.euPointsDb?.meta.totalPoints} EU points`);
		} catch (error) {
			console.error('[DrugClinicalService] Failed to load EU points:', error);
		} finally {
			this.isLoading = false;
		}
	}

	private buildEuPointsIndex(): void {
		if (!this.euPointsDb?.euPoints) return;

		for (const ep of this.euPointsDb.euPoints) {
			this.euPointsById.set(ep.id, ep);
		}
	}

	/**
	 * Get comprehensive clinical data for a drug
	 */
	async getClinicalData(
		drugId: string,
		drugName: string,
		genericName?: string
	): Promise<DrugClinicalData> {
		// Check cache
		const cacheKey = `${drugId}|${drugName}`;
		const cached = cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
			return cached.data;
		}

		// Initialize EU points if needed
		await this.initialize();

		// Create base result
		const result: DrugClinicalData = {
			drugId,
			drugName,
			genericName,
			bnoIndications: [],
			euPointInfo: [],
			eligibility: [],
			hasNeakData: false,
			fdaLabel: null,
			hasFdaData: false,
			clinicalWarnings: [],
			hasContraindications: false,
			hasInteractions: false,
			hasBoxedWarning: false,
			hasEgyediMeltanyossag: false,
			hasPrescriberRestrictions: false,
			isLoading: true,
			error: null
		};

		try {
			// Parallel fetch from both sources
			const [neakData, fdaResult] = await Promise.all([
				this.fetchNeakData(drugId),
				this.fetchFdaData(drugName, genericName)
			]);

			// Process NEAK data
			if (neakData) {
				result.bnoIndications = neakData.bnoCodes || [];
				result.eligibility = neakData.eligibility || [];
				result.euPointInfo = this.extractEuPointInfo(neakData);
				result.hasNeakData = true;
				result.hasEgyediMeltanyossag = result.euPointInfo.some(ep => ep.isEgyediMeltanyossag);
				result.hasPrescriberRestrictions = result.euPointInfo.some(ep => ep.prescription && ep.prescription.length > 10);
			}

			// Process FDA data
			if (fdaResult?.found && fdaResult.label) {
				result.fdaLabel = fdaResult.label;
				result.hasFdaData = true;
				result.hasContraindications = !!fdaResult.label.contraindications;
				result.hasInteractions = !!fdaResult.label.drugInteractions;
				result.hasBoxedWarning = !!fdaResult.label.boxedWarning;
			}

			// Generate clinical warnings
			result.clinicalWarnings = this.generateWarnings(result);

		} catch (error) {
			console.error('[DrugClinicalService] Error fetching clinical data:', error);
			result.error = error instanceof Error ? error.message : 'Unknown error';
		}

		result.isLoading = false;

		// Cache result
		cache.set(cacheKey, { data: result, timestamp: Date.now() });

		return result;
	}

	/**
	 * Fetch NEAK indication data
	 */
	private async fetchNeakData(drugId: string): Promise<DrugIndicationEntry | null> {
		try {
			return await indicationService.getIndicationsForDrug(drugId);
		} catch (error) {
			console.error('[DrugClinicalService] NEAK fetch error:', error);
			return null;
		}
	}

	/**
	 * Fetch FDA label data
	 */
	private async fetchFdaData(brandName: string, genericName?: string) {
		try {
			// Clean brand name (remove dosage info)
			const cleanBrand = brandName.split(/\s+\d/)[0].trim();
			return await openFdaService.getDrugLabel(cleanBrand, genericName);
		} catch (error) {
			console.error('[DrugClinicalService] FDA fetch error:', error);
			return null;
		}
	}

	/**
	 * Extract EU point information from drug indication data
	 * Links through the indication descriptions to find EU point details
	 */
	private extractEuPointInfo(neakData: DrugIndicationEntry): EuPointInfo[] {
		const euPointInfos: EuPointInfo[] = [];
		const seenTypes = new Set<string>();

		// For each indication, try to find matching EU point
		for (const indication of neakData.indications) {
			if (!indication.euPointType || seenTypes.has(indication.euPointType)) continue;
			seenTypes.add(indication.euPointType);

			// Determine if this is egyedi méltányosság
			const isEgyedi = indication.euPointType === 'EÜ emelt' || indication.euPointType === 'EÜ kiemelt';

			// Search for matching EU point by type
			let prescription = '';
			let notes = '';
			let euPointId = '';

			if (this.euPointsDb?.euPoints) {
				// Find an EU point that matches the type
				for (const ep of this.euPointsDb.euPoints) {
					if (ep.type === indication.euPointType) {
						// Check if any indication description matches
						const hasMatchingIndication = ep.indications.some(ind =>
							ind.description && indication.description &&
							ind.description.toLowerCase().includes(indication.description.toLowerCase().slice(0, 50))
						);

						if (hasMatchingIndication || (!prescription && ep.prescription)) {
							prescription = ep.prescription || '';
							notes = ep.notes || '';
							euPointId = ep.id;
							if (hasMatchingIndication) break;
						}
					}
				}
			}

			euPointInfos.push({
				id: euPointId,
				type: indication.euPointType,
				prescription,
				notes,
				isEgyediMeltanyossag: isEgyedi,
				indications: [{ index: 0, description: indication.description }]
			});
		}

		return euPointInfos;
	}

	/**
	 * Generate clinical warnings sorted by severity
	 */
	private generateWarnings(data: DrugClinicalData): ClinicalWarning[] {
		const warnings: ClinicalWarning[] = [];
		let warningId = 0;

		// FDA Boxed Warning (Critical)
		if (data.fdaLabel?.boxedWarning) {
			warnings.push({
				id: `warning-${warningId++}`,
				severity: 'critical',
				type: 'boxed',
				title: 'Fekete dobozos figyelmeztetés',
				summary: this.truncate(data.fdaLabel.boxedWarning, 150),
				fullText: data.fdaLabel.boxedWarning,
				source: 'fda'
			});
		}

		// FDA Contraindications (Critical)
		if (data.fdaLabel?.contraindications) {
			warnings.push({
				id: `warning-${warningId++}`,
				severity: 'critical',
				type: 'contraindication',
				title: 'Ellenjavallatok',
				summary: this.truncate(data.fdaLabel.contraindications, 150),
				fullText: data.fdaLabel.contraindications,
				source: 'fda'
			});
		}

		// FDA Drug Interactions (High)
		if (data.fdaLabel?.drugInteractions) {
			warnings.push({
				id: `warning-${warningId++}`,
				severity: 'high',
				type: 'interaction',
				title: 'Gyógyszer-interakciók',
				summary: this.truncate(data.fdaLabel.drugInteractions, 150),
				fullText: data.fdaLabel.drugInteractions,
				source: 'fda'
			});
		}

		// FDA Warnings (Moderate)
		if (data.fdaLabel?.warningsAndCautions) {
			warnings.push({
				id: `warning-${warningId++}`,
				severity: 'moderate',
				type: 'warning',
				title: 'Figyelmeztetések',
				summary: this.truncate(data.fdaLabel.warningsAndCautions, 150),
				fullText: data.fdaLabel.warningsAndCautions,
				source: 'fda'
			});
		}

		// Egyedi Méltányosság (Info - but highlighted)
		for (const euPoint of data.euPointInfo) {
			if (euPoint.isEgyediMeltanyossag) {
				warnings.push({
					id: `warning-${warningId++}`,
					severity: 'info',
					type: 'reimbursement',
					title: `Egyedi méltányosság (${euPoint.type})`,
					summary: euPoint.notes ? this.truncate(euPoint.notes, 150) : 'Speciális támogatási kategória',
					fullText: euPoint.notes || undefined,
					source: 'neak'
				});
			}
		}

		// Prescriber Restrictions (Info)
		for (const euPoint of data.euPointInfo) {
			if (euPoint.prescription && euPoint.prescription.length > 10) {
				warnings.push({
					id: `warning-${warningId++}`,
					severity: 'info',
					type: 'eligibility',
					title: 'Felírási jogosultság',
					summary: this.truncate(euPoint.prescription, 150),
					fullText: euPoint.prescription,
					source: 'neak'
				});
				break; // Only show one prescription warning
			}
		}

		// Sort by severity
		const severityOrder = { critical: 0, high: 1, moderate: 2, info: 3 };
		warnings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

		return warnings;
	}

	/**
	 * Truncate text with ellipsis
	 */
	private truncate(text: string, maxLength: number): string {
		if (!text) return '';
		const clean = text.replace(/\s+/g, ' ').trim();
		if (clean.length <= maxLength) return clean;
		return clean.slice(0, maxLength).trim() + '...';
	}

	/**
	 * Get quick summary for tooltips
	 */
	async getQuickSummary(
		drugId: string,
		drugName: string,
		genericName?: string
	): Promise<{
		warningCount: number;
		criticalCount: number;
		hasEgyediMeltanyossag: boolean;
		topWarning: ClinicalWarning | null;
	}> {
		const data = await this.getClinicalData(drugId, drugName, genericName);

		return {
			warningCount: data.clinicalWarnings.length,
			criticalCount: data.clinicalWarnings.filter(w => w.severity === 'critical').length,
			hasEgyediMeltanyossag: data.hasEgyediMeltanyossag,
			topWarning: data.clinicalWarnings[0] || null
		};
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		cache.clear();
	}
}

// Export singleton instance
export const drugClinicalService = new DrugClinicalService();
