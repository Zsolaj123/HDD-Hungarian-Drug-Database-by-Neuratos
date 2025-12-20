/**
 * Smart Drug Preset Service
 *
 * Extracts dosage, route, and frequency presets from drug data
 * to provide smart defaults when users select a drug.
 *
 * Supports both:
 * - ExtendedDrug (55 fields from PUPHAX API)
 * - SimplifiedDrug (8 fields from local database)
 */

import type { DrugRoute, SimplifiedDrug } from './drug-database-service';
import type { ExtendedDrug, DrugSummaryLight } from './puphax-api-service';

// ============================================================================
// Type Definitions
// ============================================================================

export interface DrugPreset {
	dosage: string | null;              // From hatoMenny/strength
	dosageUnit: string | null;          // From hatoEgys/unit
	suggestedDosages: string[];         // Common dosages for this drug
	route: DrugRoute | null;            // Inferred from form/adagMod
	frequency: string | null;           // From DDD factor
	isSuggested: boolean;               // True if any field was inferred
	confidence: 'high' | 'medium' | 'low'; // How confident we are in the preset
}

export interface ParsedDosage {
	value: number;
	unit: string;
}

// ============================================================================
// Hungarian Form to Route Mapping
// ============================================================================

/**
 * Maps Hungarian pharmaceutical form names to DrugRoute values
 * Based on NEAK database form nomenclature
 */
const FORM_TO_ROUTE_MAP: Record<string, DrugRoute> = {
	// Oral forms
	'tabletta': 'oral',
	'filmtabletta': 'oral',
	'kapszula': 'oral',
	'drazsé': 'oral',
	'drazse': 'oral',
	'kemény kapszula': 'oral',
	'lágy kapszula': 'oral',
	'bélben oldódó': 'oral',
	'retard': 'oral',
	'módosított': 'oral',
	'granulátum': 'oral',
	'por': 'oral',
	'oldat': 'oral',
	'szirup': 'oral',
	'csepp': 'oral',
	'rágótabletta': 'oral',
	'szopogató': 'oral',
	'pezsgőtabletta': 'oral',
	'diszpergálódó': 'oral',
	'szuszpenzió': 'oral',

	// Sublingual/Buccal
	'nyelv alatti': 'sublingual',
	'szájban oldódó': 'buccal',
	'bukkális': 'buccal',

	// Injectable forms - IV
	'infúzió': 'iv',
	'oldatos infúzió': 'iv',
	'infúziós': 'iv',
	'intravénás': 'iv',
	'injekció': 'iv', // Default, may be overridden by specific keywords
	'oldatos injekció': 'iv',
	'por oldathoz': 'iv',
	'koncentrátum': 'iv',

	// Injectable forms - IM
	'intramuscularis': 'im',
	'intramuszkuláris': 'im',
	'izomba': 'im',

	// Injectable forms - SC
	'subcutan': 'sc',
	'szubkután': 'sc',
	'bőr alá': 'sc',
	'pen': 'sc', // Most pre-filled pens are SC
	'előretöltött': 'sc',
	'fecskendő': 'sc',

	// Topical forms
	'kenőcs': 'topical',
	'krém': 'topical',
	'gél': 'topical',
	'olaj': 'topical',
	'lemosó': 'topical',
	'emulzió': 'topical',
	'lotio': 'topical',
	'hab': 'topical',
	'spray': 'topical',
	'bőrre': 'topical',
	'külsőleges': 'topical',

	// Inhaled forms
	'inhaláció': 'inhaled',
	'aeroszol': 'inhaled',
	'inhalációs': 'inhaled',
	'turbuhaler': 'inhaled',
	'diskus': 'inhaled',
	'easyhaler': 'inhaled',
	'porinhaláció': 'inhaled',
	'légúti': 'inhaled',

	// Ophthalmic forms
	'szemcsepp': 'ophthalmic',
	'szemkenőcs': 'ophthalmic',
	'szemgél': 'ophthalmic',
	'szem': 'ophthalmic',

	// Otic forms
	'fülcsepp': 'otic',
	'fül': 'otic',

	// Nasal forms
	'orrspray': 'nasal',
	'orrcsepp': 'nasal',
	'nazális': 'nasal',
	'orr': 'nasal',

	// Rectal forms
	'kúp': 'rectal',
	'végbél': 'rectal',
	'rektális': 'rectal',

	// Vaginal forms
	'hüvely': 'vaginal',
	'vaginális': 'vaginal',

	// Transdermal forms
	'tapasz': 'transdermal',
	'transdermális': 'transdermal',

	// Intrathecal/Epidural (rare, usually specified explicitly)
	'intrathecalis': 'intrathecal',
	'epidurális': 'epidural',
};

/**
 * Keywords that override the default injection route
 */
const INJECTION_ROUTE_KEYWORDS: Record<string, DrugRoute> = {
	'intravénás': 'iv',
	'intravenous': 'iv',
	'iv': 'iv',
	'i.v.': 'iv',
	'intramuscularis': 'im',
	'intramuscular': 'im',
	'im': 'im',
	'i.m.': 'im',
	'subcutan': 'sc',
	'subcutaneous': 'sc',
	'sc': 'sc',
	's.c.': 'sc',
	'intrathecal': 'intrathecal',
	'epidural': 'epidural',
};

// ============================================================================
// Common Dosage Patterns
// ============================================================================

/**
 * Common dosage values for different units
 * Used to suggest alternatives
 */
const COMMON_DOSAGES_BY_UNIT: Record<string, string[]> = {
	'mg': ['5 mg', '10 mg', '20 mg', '25 mg', '50 mg', '100 mg', '200 mg', '250 mg', '500 mg', '1000 mg'],
	'g': ['0.5 g', '1 g', '2 g', '5 g'],
	'mcg': ['25 mcg', '50 mcg', '100 mcg', '200 mcg', '500 mcg'],
	'µg': ['25 µg', '50 µg', '100 µg', '200 µg', '500 µg'],
	'ml': ['1 ml', '2 ml', '5 ml', '10 ml', '20 ml', '50 ml', '100 ml'],
	'IU': ['100 IU', '500 IU', '1000 IU', '5000 IU', '10000 IU'],
	'NE': ['100 NE', '500 NE', '1000 NE', '5000 NE', '10000 NE'],
	'%': ['0.5%', '1%', '2%', '5%', '10%'],
};

// ============================================================================
// SmartDrugPresetService Class
// ============================================================================

class SmartDrugPresetService {
	/**
	 * Extract preset from ExtendedDrug (55 fields from PUPHAX)
	 */
	extractPresetFromExtended(drug: ExtendedDrug): DrugPreset {
		const preset: DrugPreset = {
			dosage: null,
			dosageUnit: null,
			suggestedDosages: [],
			route: null,
			frequency: null,
			isSuggested: false,
			confidence: 'low',
		};

		// Extract dosage from hatoMenny (active amount)
		if (drug.hatoMenny) {
			preset.dosage = drug.hatoMenny;
			preset.isSuggested = true;
		} else if (drug.strength) {
			preset.dosage = drug.strength;
			preset.isSuggested = true;
		} else if (drug.dddMenny) {
			preset.dosage = drug.dddMenny;
			preset.isSuggested = true;
		}

		// Extract dosage unit
		if (drug.hatoEgys) {
			preset.dosageUnit = drug.hatoEgys;
		} else if (drug.dddEgys) {
			preset.dosageUnit = drug.dddEgys;
		}

		// Build full dosage string if we have both value and unit
		if (preset.dosage && preset.dosageUnit && !preset.dosage.includes(preset.dosageUnit)) {
			preset.dosage = `${preset.dosage} ${preset.dosageUnit}`;
		}

		// Suggest common dosages based on unit
		if (preset.dosageUnit) {
			const normalizedUnit = this.normalizeUnit(preset.dosageUnit);
			preset.suggestedDosages = COMMON_DOSAGES_BY_UNIT[normalizedUnit] || [];

			// Add the extracted dosage at the front if not already in list
			if (preset.dosage && !preset.suggestedDosages.includes(preset.dosage)) {
				preset.suggestedDosages = [preset.dosage, ...preset.suggestedDosages.slice(0, 4)];
			}
		}

		// Infer route from adagMod (administration method) or form
		if (drug.adagMod) {
			preset.route = this.inferRouteFromForm(drug.adagMod);
			if (preset.route) preset.isSuggested = true;
		}

		if (!preset.route && drug.gyForma) {
			preset.route = this.inferRouteFromForm(drug.gyForma);
			if (preset.route) preset.isSuggested = true;
		}

		if (!preset.route && drug.productForm) {
			preset.route = this.inferRouteFromForm(drug.productForm);
			if (preset.route) preset.isSuggested = true;
		}

		// Check drug name for route hints (e.g., "inj.", "tabletta")
		if (!preset.route && drug.name) {
			preset.route = this.inferRouteFromForm(drug.name);
			if (preset.route) preset.isSuggested = true;
		}

		// Infer frequency from DDD factor
		if (drug.dddFaktor) {
			preset.frequency = this.inferFrequencyFromDDD(drug.dddFaktor);
			if (preset.frequency) preset.isSuggested = true;
		}

		// Calculate confidence
		preset.confidence = this.calculateConfidence(preset, drug);

		return preset;
	}

	/**
	 * Extract preset from SimplifiedDrug (local database)
	 */
	extractPresetFromLocal(drug: SimplifiedDrug): DrugPreset {
		const preset: DrugPreset = {
			dosage: null,
			dosageUnit: null,
			suggestedDosages: [],
			route: null,
			frequency: null,
			isSuggested: false,
			confidence: 'low',
		};

		// Local drugs have route directly
		if (drug.route) {
			preset.route = drug.route;
			preset.isSuggested = true;
		}

		// Parse dosage from the dosage field
		if (drug.dosage) {
			preset.dosage = drug.dosage;
			preset.isSuggested = true;

			// Try to parse unit
			const parsed = this.parseDosageString(drug.dosage);
			if (parsed) {
				preset.dosageUnit = parsed.unit;

				// Suggest common dosages
				const normalizedUnit = this.normalizeUnit(parsed.unit);
				preset.suggestedDosages = COMMON_DOSAGES_BY_UNIT[normalizedUnit] || [];

				if (!preset.suggestedDosages.includes(preset.dosage)) {
					preset.suggestedDosages = [preset.dosage, ...preset.suggestedDosages.slice(0, 4)];
				}
			}
		}

		// Try to infer route from form if not set
		if (!preset.route && drug.form) {
			preset.route = this.inferRouteFromForm(drug.form);
			if (preset.route) preset.isSuggested = true;
		}

		// Calculate confidence
		preset.confidence = this.calculateConfidenceLocal(preset, drug);

		return preset;
	}

	/**
	 * Extract preset from DrugSummaryLight (search results)
	 */
	extractPresetFromSummary(drug: DrugSummaryLight): DrugPreset {
		const preset: DrugPreset = {
			dosage: null,
			dosageUnit: null,
			suggestedDosages: [],
			route: null,
			frequency: null,
			isSuggested: false,
			confidence: 'low',
		};

		// Use strength as dosage
		if (drug.strength) {
			preset.dosage = drug.strength;
			preset.isSuggested = true;

			const parsed = this.parseDosageString(drug.strength);
			if (parsed) {
				preset.dosageUnit = parsed.unit;
				const normalizedUnit = this.normalizeUnit(parsed.unit);
				preset.suggestedDosages = COMMON_DOSAGES_BY_UNIT[normalizedUnit] || [];
			}
		}

		// Infer route from productForm
		if (drug.productForm) {
			preset.route = this.inferRouteFromForm(drug.productForm);
			if (preset.route) preset.isSuggested = true;
		}

		// Check name for route hints
		if (!preset.route && drug.name) {
			preset.route = this.inferRouteFromForm(drug.name);
			if (preset.route) preset.isSuggested = true;
		}

		preset.confidence = preset.isSuggested ? 'medium' : 'low';
		return preset;
	}

	/**
	 * Infer DrugRoute from Hungarian pharmaceutical form string
	 */
	inferRouteFromForm(form: string): DrugRoute | null {
		if (!form) return null;

		const normalizedForm = form.toLowerCase().trim();

		// First check for specific injection route keywords
		for (const [keyword, route] of Object.entries(INJECTION_ROUTE_KEYWORDS)) {
			if (normalizedForm.includes(keyword.toLowerCase())) {
				return route;
			}
		}

		// Then check form-to-route mapping
		for (const [formKey, route] of Object.entries(FORM_TO_ROUTE_MAP)) {
			if (normalizedForm.includes(formKey.toLowerCase())) {
				return route;
			}
		}

		// Special handling for ambiguous forms
		if (normalizedForm.includes('injekció') || normalizedForm.includes('inj.')) {
			// Default injection to IV unless specified otherwise
			return 'iv';
		}

		return null;
	}

	/**
	 * Parse dosage string into value and unit
	 */
	parseDosageString(dosage: string): ParsedDosage | null {
		if (!dosage) return null;

		// Common patterns: "100 mg", "0.5 g", "50mcg", "1000 IU"
		const patterns = [
			/^([\d.,]+)\s*(mg|g|mcg|µg|ml|l|IU|NE|%|mmol|mEq)$/i,
			/^([\d.,]+)(mg|g|mcg|µg|ml|l|IU|NE|%|mmol|mEq)$/i,
			/^([\d.,]+)\s*\/\s*([\d.,]+)\s*(mg|g|mcg|µg|ml|l)$/i, // e.g., "500/125 mg"
		];

		for (const pattern of patterns) {
			const match = dosage.trim().match(pattern);
			if (match) {
				const value = parseFloat(match[1].replace(',', '.'));
				const unit = match[2] || match[3];
				if (!isNaN(value)) {
					return { value, unit };
				}
			}
		}

		// Try to extract just the unit if value parsing failed
		const unitMatch = dosage.match(/(mg|g|mcg|µg|ml|l|IU|NE|%|mmol|mEq)/i);
		if (unitMatch) {
			return { value: 0, unit: unitMatch[1] };
		}

		return null;
	}

	/**
	 * Normalize unit for lookup
	 */
	private normalizeUnit(unit: string): string {
		const normalized = unit.toLowerCase().trim();

		// Map variations to standard forms
		const unitMap: Record<string, string> = {
			'µg': 'mcg',
			'mikrogramm': 'mcg',
			'milligramm': 'mg',
			'gramm': 'g',
			'milliliter': 'ml',
			'liter': 'l',
			'nemzetközi egység': 'IU',
			'ne': 'NE',
		};

		return unitMap[normalized] || normalized;
	}

	/**
	 * Infer frequency from DDD factor
	 */
	private inferFrequencyFromDDD(dddFactor: string): string | null {
		const factor = parseFloat(dddFactor.replace(',', '.'));
		if (isNaN(factor)) return null;

		// DDD factor indicates how many doses per day
		if (factor === 1) return '1x naponta';
		if (factor === 2) return '2x naponta';
		if (factor === 3) return '3x naponta';
		if (factor === 4) return '4x naponta';
		if (factor === 0.5) return 'Minden második nap';
		if (factor < 1) return 'Hetente egyszer';

		return null;
	}

	/**
	 * Calculate confidence level for extended drug preset
	 */
	private calculateConfidence(preset: DrugPreset, drug: ExtendedDrug): 'high' | 'medium' | 'low' {
		let score = 0;

		// Dosage confidence
		if (drug.hatoMenny && drug.hatoEgys) score += 2;
		else if (preset.dosage) score += 1;

		// Route confidence
		if (drug.adagMod) score += 2;
		else if (preset.route) score += 1;

		// Frequency confidence
		if (drug.dddFaktor) score += 1;

		if (score >= 4) return 'high';
		if (score >= 2) return 'medium';
		return 'low';
	}

	/**
	 * Calculate confidence level for local drug preset
	 */
	private calculateConfidenceLocal(preset: DrugPreset, drug: SimplifiedDrug): 'high' | 'medium' | 'low' {
		let score = 0;

		if (preset.dosage) score += 1;
		if (drug.route) score += 2; // Direct route is highly reliable
		if (preset.dosageUnit) score += 1;

		if (score >= 3) return 'high';
		if (score >= 2) return 'medium';
		return 'low';
	}
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const smartDrugPresetService = new SmartDrugPresetService();
export default smartDrugPresetService;
