/**
 * GYSE (Medical Aids) Database Service
 *
 * Local-first service for searching Hungarian medical aids database from NEAK.
 * Contains 3,309 items including wheelchairs, prosthetics, glucose meters, etc.
 */

export interface GyseItem {
	id: string;
	tttCode: string;
	name: string;
	brandName: string;
	packSize: string;
	isoCode: string;
	atcCode: string;
	category: string;
	manufacturer: string;
	distributor: string;
	inMarket: boolean;
	// Pricing
	grossPrice: number;
	netPrice: number;
	supportPercent: number;
	supportType: string;
	patientFee: number;
	// EU support
	euSupportPercent: number;
	euPatientFee: number;
	euPoints: number | null;
	// Classification
	besorolas: string;
	pharmacy: boolean;
	// Search
	searchName: string;
	priority: number;
}

interface GyseDatabase {
	meta: {
		source: string;
		sourceUrl: string;
		extractedAt: string;
		totalItems: number;
		inMarket: number;
		version: string;
	};
	items: GyseItem[];
}

interface SearchOptions {
	limit?: number;
	inMarketOnly?: boolean;
	category?: string;
}

class GyseDatabaseService {
	private database: GyseDatabase | null = null;
	private isLoading = false;
	private loadPromise: Promise<void> | null = null;

	// Search indices
	private itemById: Map<string, GyseItem> = new Map();
	private itemsByTtt: Map<string, GyseItem> = new Map();

	/**
	 * Initialize the service by loading the database
	 */
	async initialize(): Promise<void> {
		if (this.database) return;

		if (this.loadPromise) {
			await this.loadPromise;
			return;
		}

		this.loadPromise = this.loadDatabase();
		await this.loadPromise;
	}

	private async loadDatabase(): Promise<void> {
		if (this.isLoading) return;
		this.isLoading = true;

		try {
			const response = await fetch('/data/gyse/gyse-database.json');
			if (!response.ok) {
				throw new Error(`Failed to load GYSE database: ${response.status}`);
			}

			this.database = await response.json();
			this.buildIndices();

			console.log(
				`[GyseService] Loaded ${this.database?.meta.totalItems} medical aids`
			);
		} catch (error) {
			console.error('[GyseService] Failed to load database:', error);
			throw error;
		} finally {
			this.isLoading = false;
		}
	}

	private buildIndices(): void {
		if (!this.database?.items) return;

		this.itemById.clear();
		this.itemsByTtt.clear();

		for (const item of this.database.items) {
			this.itemById.set(item.id, item);
			if (item.tttCode) {
				this.itemsByTtt.set(item.tttCode, item);
			}
		}
	}

	/**
	 * Search medical aids by name, ISO code, or TTT code
	 */
	async search(query: string, options: SearchOptions = {}): Promise<GyseItem[]> {
		await this.initialize();

		if (!this.database?.items || !query || query.length < 2) {
			return [];
		}

		const { limit = 30, inMarketOnly = false, category } = options;
		const normalizedQuery = query
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');

		const results: Array<{ item: GyseItem; score: number }> = [];

		for (const item of this.database.items) {
			// Filter by market status
			if (inMarketOnly && !item.inMarket) continue;

			// Filter by category
			if (category && item.category !== category) continue;

			let score = 0;

			// Exact TTT code match
			if (item.tttCode.toLowerCase() === normalizedQuery) {
				score = 100;
			}
			// TTT code starts with
			else if (item.tttCode.toLowerCase().startsWith(normalizedQuery)) {
				score = 80;
			}
			// ISO code match
			else if (item.isoCode.toLowerCase().includes(normalizedQuery)) {
				score = 70;
			}
			// Name starts with
			else if (item.searchName.startsWith(normalizedQuery)) {
				score = 60;
			}
			// Name contains
			else if (item.searchName.includes(normalizedQuery)) {
				score = 40;
			}
			// Brand name match
			else if (item.brandName.toLowerCase().includes(normalizedQuery)) {
				score = 30;
			}

			if (score > 0) {
				// Boost in-market items
				if (item.inMarket) score += 10;
				results.push({ item, score });
			}
		}

		// Sort by score (descending), then by priority
		results.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.item.priority - b.item.priority;
		});

		return results.slice(0, limit).map((r) => r.item);
	}

	/**
	 * Get item by ID
	 */
	async getById(id: string): Promise<GyseItem | null> {
		await this.initialize();
		return this.itemById.get(id) || null;
	}

	/**
	 * Get item by TTT code
	 */
	async getByTttCode(tttCode: string): Promise<GyseItem | null> {
		await this.initialize();
		return this.itemsByTtt.get(tttCode) || null;
	}

	/**
	 * Get database statistics
	 */
	async getStatistics(): Promise<{
		totalItems: number;
		inMarket: number;
		lastUpdated: string;
		source: string;
	}> {
		await this.initialize();

		return {
			totalItems: this.database?.meta.totalItems || 0,
			inMarket: this.database?.meta.inMarket || 0,
			lastUpdated: this.database?.meta.extractedAt || 'Unknown',
			source: this.database?.meta.source || 'Unknown'
		};
	}

	/**
	 * Get all items (for browsing/filtering)
	 */
	async getAllItems(options: SearchOptions = {}): Promise<GyseItem[]> {
		await this.initialize();

		if (!this.database?.items) return [];

		let items = [...this.database.items];

		if (options.inMarketOnly) {
			items = items.filter((i) => i.inMarket);
		}

		if (options.category) {
			items = items.filter((i) => i.category === options.category);
		}

		// Sort by priority (in-market first)
		items.sort((a, b) => a.priority - b.priority);

		if (options.limit) {
			items = items.slice(0, options.limit);
		}

		return items;
	}
}

// Export singleton instance
export const gyseService = new GyseDatabaseService();
