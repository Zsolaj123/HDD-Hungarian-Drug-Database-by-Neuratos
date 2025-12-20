/**
 * EMA Service - European Medicines Agency Data Integration
 *
 * Provides access to EU drug authorization, shortage, and safety alert data.
 * Data source: https://www.ema.europa.eu/en/about-us/about-website/download-website-data-json-data-format
 */

import { ingredientTranslationService } from './ingredient-translation-service';

// ============= INTERFACES =============

export interface EmaMedicine {
  name: string;                    // name_of_medicine
  inn: string;                     // international_non_proprietary_name_common_name
  activeSubstance: string;         // active_substance
  atcCode: string;                 // atc_code_human
  status: string;                  // medicine_status (Authorised, Withdrawn, etc.)
  therapeuticIndication: string;   // therapeutic_indication
  therapeuticArea: string;         // therapeutic_area_mesh
  pharmacotherapeuticGroup: string; // pharmacotherapeutic_group_human
  authorisationDate: string;       // marketing_authorisation_date
  holder: string;                  // marketing_authorisation_developer_applicant_holder
  biosimilar: boolean;
  orphanMedicine: boolean;
  additionalMonitoring: boolean;
  genericOrHybrid: boolean;
  conditionalApproval: boolean;
  productUrl: string;              // medicine_url
  lastUpdated: string;             // last_updated_date
}

export interface EmaShortage {
  medicine: string;                // medicine_affected
  inn: string;                     // international_non_proprietary_name_inn_or_common_name
  status: 'Ongoing' | 'Resolved';  // supply_shortage_status
  formsAffected: string;           // pharmaceutical_forms_affected
  strengthsAffected: string;       // strengths_affected
  hasAlternatives: boolean | 'Unknown'; // availability_of_alternatives
  therapeuticArea: string;         // therapeutic_area_mesh
  startDate: string;               // start_of_shortage_date
  expectedResolution: string;      // expected_resolution
  lastUpdated: string;             // last_updated_date
  shortageUrl: string;             // shortage_url
}

export interface EmaDhpc {
  medicine: string;                // name_of_medicine
  activeSubstances: string;        // active_substances
  dhpcType: string;                // dhpc_type (Adverse event, Quality defect, etc.)
  atcCode: string;                 // atc_code_human
  therapeuticArea: string;         // therapeutic_area_mesh
  disseminationDate: string;       // dissemination_date
  dhpcUrl: string;                 // dhpc_url
  procedureNumber: string;         // procedure_number
}

export interface EmaMatchResult {
  matched: boolean;
  method?: 'atc' | 'inn' | 'name' | 'activeSubstance';
  medicine?: EmaMedicine;
  shortages?: EmaShortage[];
  dhpcs?: EmaDhpc[];
  searchTerm?: string;
}

// ============= RAW DATA TYPES =============

interface RawEmaMedicine {
  name_of_medicine: string;
  international_non_proprietary_name_common_name: string;
  active_substance: string;
  atc_code_human: string;
  medicine_status: string;
  therapeutic_indication: string;
  therapeutic_area_mesh: string;
  pharmacotherapeutic_group_human: string;
  marketing_authorisation_date: string;
  marketing_authorisation_developer_applicant_holder: string;
  biosimilar: string;
  orphan_medicine: string;
  additional_monitoring: string;
  generic_or_hybrid: string;
  conditional_approval: string;
  medicine_url: string;
  last_updated_date: string;
}

interface RawEmaShortage {
  medicine_affected: string;
  international_non_proprietary_name_inn_or_common_name: string;
  supply_shortage_status: string;
  pharmaceutical_forms_affected: string;
  strengths_affected: string;
  availability_of_alternatives: string;
  therapeutic_area_mesh: string;
  start_of_shortage_date: string;
  expected_resolution: string;
  last_updated_date: string;
  shortage_url: string;
}

interface RawEmaDhpc {
  name_of_medicine: string;
  active_substances: string;
  dhpc_type: string;
  atc_code_human: string;
  therapeutic_area_mesh: string;
  dissemination_date: string;
  dhpc_url: string;
  procedure_number: string;
}

// ============= SERVICE CLASS =============

class EmaService {
  private medicines: EmaMedicine[] = [];
  private shortages: EmaShortage[] = [];
  private dhpcs: EmaDhpc[] = [];

  // Indexes for fast lookup
  private medicinesByAtc: Map<string, EmaMedicine[]> = new Map();
  private medicinesByInn: Map<string, EmaMedicine[]> = new Map();
  private medicinesByName: Map<string, EmaMedicine> = new Map();
  private medicinesByActiveSubstance: Map<string, EmaMedicine[]> = new Map();

  private shortagesByInn: Map<string, EmaShortage[]> = new Map();
  private dhpcsByActiveSubstance: Map<string, EmaDhpc[]> = new Map();
  private dhpcsByAtc: Map<string, EmaDhpc[]> = new Map();

  private initialized = false;
  private dataTimestamp: string = '';

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await Promise.all([
        this.loadMedicines(),
        this.loadShortages(),
        this.loadDhpcs()
      ]);

      this.buildIndexes();
      this.initialized = true;
      console.log(`[EMA] Initialized with ${this.medicines.length} medicines, ${this.shortages.length} shortages, ${this.dhpcs.length} DHPCs`);
    } catch (error) {
      console.error('[EMA] Failed to initialize:', error);
      throw error;
    }
  }

  private async loadMedicines(): Promise<void> {
    const response = await fetch('/data/ema/medicines_output_medicines_en.json');
    const raw: RawEmaMedicine[] = await response.json();

    this.medicines = raw
      .filter(m => m.name_of_medicine) // Filter out empty entries
      .map(m => ({
        name: m.name_of_medicine || '',
        inn: m.international_non_proprietary_name_common_name || '',
        activeSubstance: m.active_substance || '',
        atcCode: m.atc_code_human || '',
        status: m.medicine_status || '',
        therapeuticIndication: m.therapeutic_indication || '',
        therapeuticArea: m.therapeutic_area_mesh || '',
        pharmacotherapeuticGroup: m.pharmacotherapeutic_group_human || '',
        authorisationDate: m.marketing_authorisation_date || '',
        holder: m.marketing_authorisation_developer_applicant_holder || '',
        biosimilar: m.biosimilar === 'Yes',
        orphanMedicine: m.orphan_medicine === 'Yes',
        additionalMonitoring: m.additional_monitoring === 'Yes',
        genericOrHybrid: m.generic_or_hybrid === 'Yes',
        conditionalApproval: m.conditional_approval === 'Yes',
        productUrl: m.medicine_url || '',
        lastUpdated: m.last_updated_date || ''
      }));

    // Get latest update date from medicines
    const latestDate = this.medicines
      .map(m => m.lastUpdated)
      .filter(d => d)
      .sort()
      .pop();
    if (latestDate) {
      this.dataTimestamp = latestDate;
    }
  }

  private async loadShortages(): Promise<void> {
    const response = await fetch('/data/ema/medicines_output_shortages_en.json');
    const raw: RawEmaShortage[] = await response.json();

    this.shortages = raw.map(s => ({
      medicine: s.medicine_affected || '',
      inn: s.international_non_proprietary_name_inn_or_common_name || '',
      status: s.supply_shortage_status === 'Ongoing' ? 'Ongoing' : 'Resolved',
      formsAffected: s.pharmaceutical_forms_affected || '',
      strengthsAffected: s.strengths_affected || '',
      hasAlternatives: s.availability_of_alternatives === 'Yes'
        ? true
        : s.availability_of_alternatives === 'No'
          ? false
          : 'Unknown',
      therapeuticArea: s.therapeutic_area_mesh || '',
      startDate: s.start_of_shortage_date || '',
      expectedResolution: s.expected_resolution || '',
      lastUpdated: s.last_updated_date || '',
      shortageUrl: s.shortage_url || ''
    }));

    // Update timestamp from shortages if more recent
    const latestShortageDate = this.shortages
      .map(s => s.lastUpdated)
      .filter(d => d)
      .sort()
      .pop();
    if (latestShortageDate && (!this.dataTimestamp || latestShortageDate > this.dataTimestamp)) {
      this.dataTimestamp = latestShortageDate;
    }
  }

  private async loadDhpcs(): Promise<void> {
    const response = await fetch('/data/ema/medicines_output_dhpc_en.json');
    const raw: RawEmaDhpc[] = await response.json();

    this.dhpcs = raw.map(d => ({
      medicine: d.name_of_medicine || '',
      activeSubstances: d.active_substances || '',
      dhpcType: d.dhpc_type || '',
      atcCode: d.atc_code_human || '',
      therapeuticArea: d.therapeutic_area_mesh || '',
      disseminationDate: d.dissemination_date || '',
      dhpcUrl: d.dhpc_url || '',
      procedureNumber: d.procedure_number || ''
    }));
  }

  private buildIndexes(): void {
    // Index medicines by ATC code
    for (const med of this.medicines) {
      if (med.atcCode) {
        const existing = this.medicinesByAtc.get(med.atcCode.toUpperCase()) || [];
        existing.push(med);
        this.medicinesByAtc.set(med.atcCode.toUpperCase(), existing);
      }
    }

    // Index medicines by INN (normalized lowercase)
    for (const med of this.medicines) {
      if (med.inn) {
        const normalizedInn = this.normalizeText(med.inn);
        const existing = this.medicinesByInn.get(normalizedInn) || [];
        existing.push(med);
        this.medicinesByInn.set(normalizedInn, existing);
      }
    }

    // Index medicines by name
    for (const med of this.medicines) {
      if (med.name) {
        this.medicinesByName.set(med.name.toLowerCase(), med);
      }
    }

    // Index medicines by active substance
    for (const med of this.medicines) {
      if (med.activeSubstance) {
        const normalizedSubstance = this.normalizeText(med.activeSubstance);
        const existing = this.medicinesByActiveSubstance.get(normalizedSubstance) || [];
        existing.push(med);
        this.medicinesByActiveSubstance.set(normalizedSubstance, existing);
      }
    }

    // Index shortages by INN
    for (const shortage of this.shortages) {
      if (shortage.inn) {
        // Handle multiple INNs separated by semicolons
        const inns = shortage.inn.split(';').map(i => this.normalizeText(i.trim()));
        for (const inn of inns) {
          const existing = this.shortagesByInn.get(inn) || [];
          existing.push(shortage);
          this.shortagesByInn.set(inn, existing);
        }
      }
    }

    // Index DHPCs by active substance
    for (const dhpc of this.dhpcs) {
      if (dhpc.activeSubstances) {
        // Handle multiple substances separated by semicolons
        const substances = dhpc.activeSubstances.split(';').map(s => this.normalizeText(s.trim()));
        for (const substance of substances) {
          const existing = this.dhpcsByActiveSubstance.get(substance) || [];
          existing.push(dhpc);
          this.dhpcsByActiveSubstance.set(substance, existing);
        }
      }

      // Also index by ATC code
      if (dhpc.atcCode) {
        const existing = this.dhpcsByAtc.get(dhpc.atcCode.toUpperCase()) || [];
        existing.push(dhpc);
        this.dhpcsByAtc.set(dhpc.atcCode.toUpperCase(), existing);
      }
    }
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // Remove diacritics
  }

  // ============= PUBLIC METHODS =============

  getDataTimestamp(): string {
    return this.dataTimestamp;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Find EMA data for a Hungarian drug
   */
  async findEmaData(hungarianDrug: {
    activeIngredient?: string;
    atcCode?: string;
    name?: string;
  }): Promise<EmaMatchResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    let medicine: EmaMedicine | undefined;
    let method: 'atc' | 'inn' | 'name' | 'activeSubstance' | undefined;
    let searchTerm: string | undefined;

    // 1. Try ATC code (most reliable)
    if (hungarianDrug.atcCode) {
      const byAtc = this.medicinesByAtc.get(hungarianDrug.atcCode.toUpperCase());
      if (byAtc && byAtc.length > 0) {
        medicine = byAtc[0]; // Take first match
        method = 'atc';
        searchTerm = hungarianDrug.atcCode;
      }
    }

    // 2. Try INN/active substance (after translation)
    if (!medicine && hungarianDrug.activeIngredient) {
      const englishVariants = await ingredientTranslationService.toEnglish(hungarianDrug.activeIngredient);

      for (const english of englishVariants) {
        const normalizedEnglish = this.normalizeText(english);

        // Try INN match
        const byInn = this.medicinesByInn.get(normalizedEnglish);
        if (byInn && byInn.length > 0) {
          medicine = byInn[0];
          method = 'inn';
          searchTerm = english;
          break;
        }

        // Try active substance match
        const bySubstance = this.medicinesByActiveSubstance.get(normalizedEnglish);
        if (bySubstance && bySubstance.length > 0) {
          medicine = bySubstance[0];
          method = 'activeSubstance';
          searchTerm = english;
          break;
        }
      }
    }

    // 3. Try brand name fuzzy match (last resort)
    if (!medicine && hungarianDrug.name) {
      const byName = this.medicinesByName.get(hungarianDrug.name.toLowerCase());
      if (byName) {
        medicine = byName;
        method = 'name';
        searchTerm = hungarianDrug.name;
      }
    }

    // Get related shortages and DHPCs
    let shortages: EmaShortage[] = [];
    let dhpcs: EmaDhpc[] = [];

    if (searchTerm || medicine) {
      const searchTermNormalized = searchTerm ? this.normalizeText(searchTerm) : '';

      // Get shortages - check multiple potential matches
      if (medicine?.inn) {
        const innNormalized = this.normalizeText(medicine.inn);
        shortages = this.shortagesByInn.get(innNormalized) || [];
      }
      if (shortages.length === 0 && searchTermNormalized) {
        shortages = this.shortagesByInn.get(searchTermNormalized) || [];
      }

      // Get DHPCs - check by ATC code and active substance
      if (medicine?.atcCode) {
        dhpcs = this.dhpcsByAtc.get(medicine.atcCode.toUpperCase()) || [];
      }
      if (dhpcs.length === 0 && medicine?.activeSubstance) {
        const substanceNormalized = this.normalizeText(medicine.activeSubstance);
        dhpcs = this.dhpcsByActiveSubstance.get(substanceNormalized) || [];
      }
      if (dhpcs.length === 0 && searchTermNormalized) {
        dhpcs = this.dhpcsByActiveSubstance.get(searchTermNormalized) || [];
      }
    }

    // Filter to only ongoing shortages
    const ongoingShortages = shortages.filter(s => s.status === 'Ongoing');

    // Sort DHPCs by date (most recent first)
    dhpcs.sort((a, b) => {
      const dateA = this.parseDateString(a.disseminationDate);
      const dateB = this.parseDateString(b.disseminationDate);
      return dateB.getTime() - dateA.getTime();
    });

    return {
      matched: !!medicine,
      method,
      medicine,
      shortages: ongoingShortages,
      dhpcs: dhpcs.slice(0, 10), // Limit to 10 most recent
      searchTerm
    };
  }

  private parseDateString(dateStr: string): Date {
    if (!dateStr) return new Date(0);
    // Format: DD/MM/YYYY
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    return new Date(0);
  }

  /**
   * Get all ongoing shortages (for dashboard/overview)
   */
  getOngoingShortages(): EmaShortage[] {
    return this.shortages.filter(s => s.status === 'Ongoing');
  }

  /**
   * Get recent DHPCs (for dashboard/overview)
   */
  getRecentDhpcs(limit = 10): EmaDhpc[] {
    return [...this.dhpcs]
      .sort((a, b) => {
        const dateA = this.parseDateString(a.disseminationDate);
        const dateB = this.parseDateString(b.disseminationDate);
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, limit);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalMedicines: number;
    ongoingShortages: number;
    resolvedShortages: number;
    totalDhpcs: number;
    lastUpdated: string;
  } {
    return {
      totalMedicines: this.medicines.length,
      ongoingShortages: this.shortages.filter(s => s.status === 'Ongoing').length,
      resolvedShortages: this.shortages.filter(s => s.status === 'Resolved').length,
      totalDhpcs: this.dhpcs.length,
      lastUpdated: this.dataTimestamp
    };
  }
}

// Export singleton instance
export const emaService = new EmaService();
