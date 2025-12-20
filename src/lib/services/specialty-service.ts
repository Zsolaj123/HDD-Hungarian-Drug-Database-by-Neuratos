/**
 * Specialty Service
 *
 * Provides medical specialty lookup functionality for drug prescribing eligibility.
 * Maps specialty IDs (from eligibility[].specialtyId) to human-readable names.
 */

import type { ComponentType } from 'svelte';
import {
	Brain,
	Heart,
	Stethoscope,
	Baby,
	Scan,
	Ear,
	Utensils,
	Home,
	Bone,
	ScanLine,
	Shield,
	Eye,
	Ambulance,
	Syringe,
	Bug,
	Atom,
	Pill,
	Scale,
	type Icon
} from 'lucide-svelte';

export interface Specialty {
	id: string;
	code: number;
	name: string;
	shortName: string;
	category: string;
	icon: string;
	equivalentId: number | null;
}

export interface PrescriberCategory {
	id: number;
	name: string;
	description: string;
}

interface SpecialtyDatabase {
	meta: {
		source: string;
		extractedAt: string;
		totalSpecialties: number;
	};
	specialties: Record<string, Specialty>;
	prescriberCategories: PrescriberCategory[];
	categoryGroups: Record<string, number[]>;
}

// Icon component mapping
const ICON_MAP: Record<string, ComponentType<Icon>> = {
	Brain,
	Heart,
	Stethoscope,
	Baby,
	Scan,
	Ear,
	Utensils,
	Home,
	Bone,
	ScanLine,
	Shield,
	Eye,
	Ambulance,
	Syringe,
	Bug,
	Atom,
	Pill,
	Scale
};

class SpecialtyService {
	private specialties: Map<string, Specialty> = new Map();
	private prescriberCategories: PrescriberCategory[] = [];
	private categoryGroups: Map<string, number[]> = new Map();
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	/**
	 * Initialize the service by loading specialty data
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
			const response = await fetch('/data/specialties/specialty-codes.json');
			if (!response.ok) {
				throw new Error(`Failed to load specialty codes: ${response.status}`);
			}

			const data: SpecialtyDatabase = await response.json();

			// Build specialty map
			for (const [id, specialty] of Object.entries(data.specialties)) {
				this.specialties.set(id, specialty);
			}

			// Store prescriber categories
			this.prescriberCategories = data.prescriberCategories || [];

			// Store category groups
			for (const [category, ids] of Object.entries(data.categoryGroups || {})) {
				this.categoryGroups.set(category, ids);
			}

			console.log(`[SpecialtyService] Loaded ${this.specialties.size} specialties`);
		} catch (error) {
			console.error('[SpecialtyService] Failed to load specialty codes:', error);
		}
	}

	/**
	 * Get specialty name for a specialty ID
	 * @param specialtyId The specialty ID from eligibility data
	 * @returns The specialty name or null if not found
	 */
	getSpecialtyName(specialtyId: string | number | null): string | null {
		if (specialtyId === null || specialtyId === undefined) return null;

		const id = String(specialtyId);
		const specialty = this.specialties.get(id);
		return specialty?.name || null;
	}

	/**
	 * Get short specialty name for compact display
	 */
	getSpecialtyShortName(specialtyId: string | number | null): string | null {
		if (specialtyId === null || specialtyId === undefined) return null;

		const id = String(specialtyId);
		const specialty = this.specialties.get(id);
		return specialty?.shortName || specialty?.name || null;
	}

	/**
	 * Get the full specialty object
	 */
	getSpecialty(specialtyId: string | number | null): Specialty | null {
		if (specialtyId === null || specialtyId === undefined) return null;

		const id = String(specialtyId);
		return this.specialties.get(id) || null;
	}

	/**
	 * Get the icon component for a specialty
	 */
	getSpecialtyIcon(specialtyId: string | number | null): ComponentType<Icon> {
		if (specialtyId === null || specialtyId === undefined) return Stethoscope;

		const specialty = this.getSpecialty(specialtyId);
		if (!specialty?.icon) return Stethoscope;

		return ICON_MAP[specialty.icon] || Stethoscope;
	}

	/**
	 * Get the icon name for a specialty (for dynamic rendering)
	 */
	getSpecialtyIconName(specialtyId: string | number | null): string {
		if (specialtyId === null || specialtyId === undefined) return 'Stethoscope';

		const specialty = this.getSpecialty(specialtyId);
		return specialty?.icon || 'Stethoscope';
	}

	/**
	 * Get all specialties
	 */
	getAllSpecialties(): Specialty[] {
		return Array.from(this.specialties.values());
	}

	/**
	 * Get specialties by category
	 */
	getSpecialtiesByCategory(
		category: 'neurology' | 'cardiology' | 'psychiatry' | 'internal' | 'pediatrics' | 'surgery' | 'general' | 'other'
	): Specialty[] {
		const ids = this.categoryGroups.get(category) || [];
		return ids
			.map((id) => this.specialties.get(String(id)))
			.filter((s): s is Specialty => s !== undefined);
	}

	/**
	 * Get prescriber category info
	 */
	getPrescriberCategories(): PrescriberCategory[] {
		return this.prescriberCategories;
	}

	/**
	 * Parse prescriber category from eligibility data
	 * Returns a simplified prescriber type
	 */
	parsePrescriberType(category: string): {
		type: 'gp' | 'outpatient' | 'inpatient' | 'designated' | 'other';
		label: string;
		icon: string;
	} {
		const lower = category.toLowerCase();

		if (lower.includes('háziorvos')) {
			return { type: 'gp', label: 'Háziorvos', icon: 'Home' };
		}
		if (lower.includes('fekvőbeteg') && lower.includes('járóbeteg')) {
			return { type: 'outpatient', label: 'Szakrendelés / Kórházi', icon: 'Building2' };
		}
		if (lower.includes('fekvőbeteg')) {
			return { type: 'inpatient', label: 'Kórházi', icon: 'Hospital' };
		}
		if (lower.includes('járóbeteg')) {
			return { type: 'outpatient', label: 'Szakrendelés', icon: 'Stethoscope' };
		}
		if (lower.includes('kijelölt')) {
			return { type: 'designated', label: 'Kijelölt intézmény', icon: 'Building' };
		}
		if (lower.includes('megkötés nélkül')) {
			return { type: 'gp', label: 'Bárki', icon: 'UserCheck' };
		}

		return { type: 'other', label: category, icon: 'Stethoscope' };
	}

	/**
	 * Get color info for a specialty category
	 * Returns CSS-compatible color values for backgrounds, borders, and text
	 */
	getSpecialtyCategoryColor(specialtyId: string | number | null): {
		bg: string;
		border: string;
		text: string;
		name: string;
	} {
		const specialty = this.getSpecialty(specialtyId);
		const category = specialty?.category || 'other';

		const CATEGORY_COLORS: Record<
			string,
			{ bg: string; border: string; text: string; name: string }
		> = {
			neurology: {
				bg: 'rgba(139, 92, 246, 0.15)',
				border: 'rgba(139, 92, 246, 0.4)',
				text: 'rgb(167, 139, 250)',
				name: 'violet'
			},
			cardiology: {
				bg: 'rgba(239, 68, 68, 0.15)',
				border: 'rgba(239, 68, 68, 0.4)',
				text: 'rgb(252, 165, 165)',
				name: 'red'
			},
			psychiatry: {
				bg: 'rgba(236, 72, 153, 0.15)',
				border: 'rgba(236, 72, 153, 0.4)',
				text: 'rgb(249, 168, 212)',
				name: 'pink'
			},
			internal: {
				bg: 'rgba(59, 130, 246, 0.15)',
				border: 'rgba(59, 130, 246, 0.4)',
				text: 'rgb(147, 197, 253)',
				name: 'blue'
			},
			pediatrics: {
				bg: 'rgba(16, 185, 129, 0.15)',
				border: 'rgba(16, 185, 129, 0.4)',
				text: 'rgb(110, 231, 183)',
				name: 'emerald'
			},
			surgery: {
				bg: 'rgba(245, 158, 11, 0.15)',
				border: 'rgba(245, 158, 11, 0.4)',
				text: 'rgb(252, 211, 77)',
				name: 'amber'
			},
			dermatology: {
				bg: 'rgba(168, 85, 247, 0.15)',
				border: 'rgba(168, 85, 247, 0.4)',
				text: 'rgb(196, 181, 253)',
				name: 'purple'
			},
			ophthalmology: {
				bg: 'rgba(20, 184, 166, 0.15)',
				border: 'rgba(20, 184, 166, 0.4)',
				text: 'rgb(94, 234, 212)',
				name: 'teal'
			},
			otolaryngology: {
				bg: 'rgba(6, 182, 212, 0.15)',
				border: 'rgba(6, 182, 212, 0.4)',
				text: 'rgb(103, 232, 249)',
				name: 'cyan'
			},
			radiology: {
				bg: 'rgba(99, 102, 241, 0.15)',
				border: 'rgba(99, 102, 241, 0.4)',
				text: 'rgb(165, 180, 252)',
				name: 'indigo'
			},
			emergency: {
				bg: 'rgba(251, 146, 60, 0.15)',
				border: 'rgba(251, 146, 60, 0.4)',
				text: 'rgb(253, 186, 116)',
				name: 'orange'
			},
			general: {
				bg: 'rgba(34, 197, 94, 0.15)',
				border: 'rgba(34, 197, 94, 0.4)',
				text: 'rgb(134, 239, 172)',
				name: 'green'
			},
			obstetrics: {
				bg: 'rgba(244, 114, 182, 0.15)',
				border: 'rgba(244, 114, 182, 0.4)',
				text: 'rgb(249, 168, 212)',
				name: 'fuchsia'
			},
			pathology: {
				bg: 'rgba(217, 70, 239, 0.15)',
				border: 'rgba(217, 70, 239, 0.4)',
				text: 'rgb(232, 121, 249)',
				name: 'fuchsia-dark'
			},
			laboratory: {
				bg: 'rgba(14, 165, 233, 0.15)',
				border: 'rgba(14, 165, 233, 0.4)',
				text: 'rgb(56, 189, 248)',
				name: 'sky'
			},
			rehabilitation: {
				bg: 'rgba(132, 204, 22, 0.15)',
				border: 'rgba(132, 204, 22, 0.4)',
				text: 'rgb(163, 230, 53)',
				name: 'lime'
			},
			other: {
				bg: 'rgba(100, 116, 139, 0.15)',
				border: 'rgba(100, 116, 139, 0.4)',
				text: 'rgb(148, 163, 184)',
				name: 'slate'
			}
		};

		return CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
	}

	/**
	 * Check if the service is initialized
	 */
	isInitialized(): boolean {
		return this.initialized;
	}
}

// Export singleton instance
export const specialtyService = new SpecialtyService();
