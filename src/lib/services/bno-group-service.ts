/**
 * BNO Group Service
 *
 * Manages configurable BNO disease groups for quick access.
 * Supports default groups from JSON and user custom groups from localStorage.
 */

import { bnoService } from './bno-database-service';
import { indicationService, type BnoDrugEntry } from './indication-service';

// ============================================================================
// Types
// ============================================================================

export interface BnoGroup {
	id: string;
	name: string;
	nameEn?: string;
	description?: string;
	icon?: string;
	codes: string[]; // Can include wildcards like "G*" or ranges like "I60-I69"
	isDefault: boolean;
	specialty?: string;
	sortOrder?: number;
}

export interface UserBnoGroupSettings {
	enabledGroups: string[]; // IDs of enabled groups (default + custom)
	customGroups: BnoGroup[];
	groupOrder: string[]; // Order of group IDs
	expandedGroups: string[]; // Currently expanded in UI
	lastModified: string;
}

export interface BnoGroupWithStats extends BnoGroup {
	codeCount: number;
	drugCount: number;
	expandedCodes: string[];
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'neuratos-bno-group-settings';

// ============================================================================
// Service Class
// ============================================================================

class BnoGroupService {
	private defaultGroups: BnoGroup[] = [];
	private isLoaded = false;
	private loadPromise: Promise<void> | null = null;

	/**
	 * Initialize by loading default groups
	 */
	async initialize(): Promise<void> {
		if (this.isLoaded) return;

		if (this.loadPromise) {
			await this.loadPromise;
			return;
		}

		this.loadPromise = this.loadDefaultGroups();
		await this.loadPromise;
	}

	/**
	 * Load default groups from JSON file
	 */
	private async loadDefaultGroups(): Promise<void> {
		try {
			const response = await fetch('/data/bno/bno-groups.json');
			if (!response.ok) {
				throw new Error('Failed to load BNO groups');
			}

			const data = await response.json();
			this.defaultGroups = data.groups || [];
			this.isLoaded = true;

			console.log(`[BnoGroupService] Loaded ${this.defaultGroups.length} default groups`);
		} catch (error) {
			console.error('[BnoGroupService] Failed to load default groups:', error);
			this.defaultGroups = [];
			this.isLoaded = true;
		}
	}

	/**
	 * Get all default groups
	 */
	async getDefaultGroups(): Promise<BnoGroup[]> {
		await this.initialize();
		return [...this.defaultGroups];
	}

	/**
	 * Get user settings from localStorage
	 */
	getUserSettings(): UserBnoGroupSettings {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				return JSON.parse(stored);
			}
		} catch (error) {
			console.error('[BnoGroupService] Failed to load user settings:', error);
		}

		// Return default settings
		return this.getDefaultSettings();
	}

	/**
	 * Get default settings (all default groups enabled)
	 */
	private getDefaultSettings(): UserBnoGroupSettings {
		const enabledGroupIds = this.defaultGroups
			.filter(g => g.isDefault)
			.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
			.map(g => g.id);

		return {
			enabledGroups: enabledGroupIds,
			customGroups: [],
			groupOrder: enabledGroupIds,
			expandedGroups: [],
			lastModified: new Date().toISOString()
		};
	}

	/**
	 * Save user settings to localStorage
	 */
	saveUserSettings(settings: UserBnoGroupSettings): void {
		try {
			settings.lastModified = new Date().toISOString();
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		} catch (error) {
			console.error('[BnoGroupService] Failed to save user settings:', error);
		}
	}

	/**
	 * Get all groups (default + custom) with user preferences applied
	 */
	async getAllGroups(): Promise<BnoGroup[]> {
		await this.initialize();
		const settings = this.getUserSettings();

		// Combine default and custom groups
		const allGroups = [...this.defaultGroups, ...settings.customGroups];

		// Sort by user's order preference
		if (settings.groupOrder.length > 0) {
			allGroups.sort((a, b) => {
				const aIndex = settings.groupOrder.indexOf(a.id);
				const bIndex = settings.groupOrder.indexOf(b.id);
				if (aIndex === -1 && bIndex === -1) return 0;
				if (aIndex === -1) return 1;
				if (bIndex === -1) return -1;
				return aIndex - bIndex;
			});
		}

		return allGroups;
	}

	/**
	 * Get only enabled groups with stats
	 */
	async getEnabledGroupsWithStats(): Promise<BnoGroupWithStats[]> {
		await this.initialize();
		await bnoService.initialize();

		const settings = this.getUserSettings();
		const allGroups = await this.getAllGroups();

		const enabledGroups = allGroups.filter(g => settings.enabledGroups.includes(g.id));
		const result: BnoGroupWithStats[] = [];

		for (const group of enabledGroups) {
			const expandedCodes = await this.expandGroupCodes(group);
			const drugCount = await this.getDrugCountForCodes(expandedCodes);

			result.push({
				...group,
				codeCount: expandedCodes.length,
				drugCount,
				expandedCodes
			});
		}

		return result;
	}

	/**
	 * Expand wildcards and ranges in group codes to actual BNO codes
	 */
	async expandGroupCodes(group: BnoGroup): Promise<string[]> {
		await bnoService.initialize();

		const expandedCodes: Set<string> = new Set();

		for (const pattern of group.codes) {
			if (pattern.includes('*')) {
				// Wildcard pattern (e.g., "G*" or "I6*")
				const prefix = pattern.replace('*', '');
				const matches = bnoService.searchByPrefix(prefix);
				matches.forEach(code => expandedCodes.add(code.code));
			} else if (pattern.includes('-')) {
				// Range pattern (e.g., "I60-I69")
				const [start, end] = pattern.split('-');
				const matches = bnoService.searchByRange(start, end);
				matches.forEach(code => expandedCodes.add(code.code));
			} else {
				// Single code or prefix
				const matches = bnoService.searchByPrefix(pattern);
				if (matches.length > 0) {
					matches.forEach(code => expandedCodes.add(code.code));
				} else {
					expandedCodes.add(pattern); // Keep as is if not found
				}
			}
		}

		return Array.from(expandedCodes).sort();
	}

	/**
	 * Get drug count for a set of BNO codes
	 */
	private async getDrugCountForCodes(codes: string[]): Promise<number> {
		await indicationService.initialize();

		const drugIds = new Set<string>();

		for (const code of codes.slice(0, 50)) { // Limit for performance
			const drugs = await indicationService.getDrugsForBno(code);
			if (drugs) {
				drugs.drugs.forEach(d => drugIds.add(d.drugId));
			}
		}

		return drugIds.size;
	}

	/**
	 * Get drugs for a specific group
	 */
	async getDrugsForGroup(groupId: string): Promise<BnoDrugEntry[]> {
		await this.initialize();
		await indicationService.initialize();

		const allGroups = await this.getAllGroups();
		const group = allGroups.find(g => g.id === groupId);

		if (!group) {
			return [];
		}

		const expandedCodes = await this.expandGroupCodes(group);
		const drugMap = new Map<string, BnoDrugEntry['drugs'][0]>();

		for (const code of expandedCodes.slice(0, 100)) { // Limit for performance
			const entry = await indicationService.getDrugsForBno(code);
			if (entry) {
				entry.drugs.forEach(d => {
					if (!drugMap.has(d.drugId)) {
						drugMap.set(d.drugId, d);
					}
				});
			}
		}

		return [{
			code: groupId,
			description: group.name,
			drugs: Array.from(drugMap.values())
		}];
	}

	/**
	 * Add a custom group
	 */
	addCustomGroup(group: Omit<BnoGroup, 'id' | 'isDefault'>): string {
		const settings = this.getUserSettings();
		const newId = `custom-${Date.now()}`;

		const newGroup: BnoGroup = {
			...group,
			id: newId,
			isDefault: false
		};

		settings.customGroups.push(newGroup);
		settings.enabledGroups.push(newId);
		settings.groupOrder.push(newId);

		this.saveUserSettings(settings);
		return newId;
	}

	/**
	 * Remove a custom group
	 */
	removeCustomGroup(groupId: string): void {
		const settings = this.getUserSettings();

		settings.customGroups = settings.customGroups.filter(g => g.id !== groupId);
		settings.enabledGroups = settings.enabledGroups.filter(id => id !== groupId);
		settings.groupOrder = settings.groupOrder.filter(id => id !== groupId);
		settings.expandedGroups = settings.expandedGroups.filter(id => id !== groupId);

		this.saveUserSettings(settings);
	}

	/**
	 * Toggle group enabled state
	 */
	toggleGroupEnabled(groupId: string): void {
		const settings = this.getUserSettings();

		if (settings.enabledGroups.includes(groupId)) {
			settings.enabledGroups = settings.enabledGroups.filter(id => id !== groupId);
		} else {
			settings.enabledGroups.push(groupId);
		}

		this.saveUserSettings(settings);
	}

	/**
	 * Update group order
	 */
	updateGroupOrder(newOrder: string[]): void {
		const settings = this.getUserSettings();
		settings.groupOrder = newOrder;
		this.saveUserSettings(settings);
	}

	/**
	 * Toggle group expanded state
	 */
	toggleGroupExpanded(groupId: string): void {
		const settings = this.getUserSettings();

		if (settings.expandedGroups.includes(groupId)) {
			settings.expandedGroups = settings.expandedGroups.filter(id => id !== groupId);
		} else {
			settings.expandedGroups.push(groupId);
		}

		this.saveUserSettings(settings);
	}

	/**
	 * Reset to default settings
	 */
	async resetToDefaults(): Promise<void> {
		await this.initialize();
		localStorage.removeItem(STORAGE_KEY);
	}

	/**
	 * Update a custom group
	 */
	updateCustomGroup(groupId: string, updates: Partial<BnoGroup>): void {
		const settings = this.getUserSettings();

		const index = settings.customGroups.findIndex(g => g.id === groupId);
		if (index !== -1) {
			settings.customGroups[index] = {
				...settings.customGroups[index],
				...updates,
				id: groupId, // Don't allow ID change
				isDefault: false // Keep as custom
			};
			this.saveUserSettings(settings);
		}
	}
}

// Export singleton instance
export const bnoGroupService = new BnoGroupService();
