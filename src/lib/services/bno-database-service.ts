/**
 * BNO (ICD-10) Database Service
 *
 * Local-first service for searching Hungarian ICD-10 diagnosis codes.
 * Contains 23,664 codes covering all disease classifications.
 */

export interface BnoCode {
	id: string;
	code: string;
	description: string;
	chapter: string;
	searchCode: string;
	searchDesc: string;
}

interface BnoDatabase {
	meta: {
		source: string;
		extractedAt: string;
		totalCodes: number;
		version: string;
	};
	codes: BnoCode[];
}

// ICD-10 Chapter descriptions (Hungarian)
export const BNO_CHAPTERS: Record<string, string> = {
	A: 'Fertőző és parazitás betegségek (A00-B99)',
	B: 'Fertőző és parazitás betegségek (A00-B99)',
	C: 'Daganatok (C00-D48)',
	D: 'Daganatok és vér/vérképző szervek (C00-D89)',
	E: 'Endokrin, táplálkozási és anyagcsere betegségek (E00-E90)',
	F: 'Mentális és viselkedészavarok (F00-F99)',
	G: 'Idegrendszer betegségei (G00-G99)',
	H: 'Szem és fül betegségei (H00-H95)',
	I: 'Keringési rendszer betegségei (I00-I99)',
	J: 'Légzőrendszer betegségei (J00-J99)',
	K: 'Emésztőrendszer betegségei (K00-K93)',
	L: 'Bőr és bőralatti szövet betegségei (L00-L99)',
	M: 'Csont-izomrendszer és kötőszövet betegségei (M00-M99)',
	N: 'Urogenitális rendszer betegségei (N00-N99)',
	O: 'Terhesség, szülés és gyermekágy (O00-O99)',
	P: 'Perinatális szakban keletkező állapotok (P00-P96)',
	Q: 'Veleszületett rendellenességek (Q00-Q99)',
	R: 'Máshova nem osztályozott tünetek és jelek (R00-R99)',
	S: 'Sérülések és mérgezések - testrész (S00-T98)',
	T: 'Sérülések és mérgezések - típus (S00-T98)',
	U: 'Speciális célú kódok (U00-U99)',
	V: 'Külső okok - közlekedési balesetek (V01-Y98)',
	W: 'Külső okok - egyéb balesetek (V01-Y98)',
	X: 'Külső okok - önártalom, támadás (V01-Y98)',
	Y: 'Külső okok - orvosi ellátás szövődményei (V01-Y98)',
	Z: 'Az egészségi állapotot befolyásoló tényezők (Z00-Z99)'
};

// Common MS-related BNO codes for quick access
export const MS_BNO_CODES = [
	{ code: 'G35', description: 'Sclerosis multiplex' },
	{ code: 'G35H0', description: 'SM - Relapszáló-remittáló' },
	{ code: 'G35H1', description: 'SM - Primer progresszív' },
	{ code: 'G35H2', description: 'SM - Szekunder progresszív' },
	{ code: 'G35H3', description: 'SM - Progresszív-relapszáló' },
	{ code: 'G37', description: 'Az idegrendszer egyéb demyelinisatiós betegségei' },
	{ code: 'G36', description: 'Egyéb akut disszeminált demyelinisatio' }
];

interface SearchOptions {
	limit?: number;
	chapter?: string;
}

class BnoDatabaseService {
	private database: BnoDatabase | null = null;
	private isLoading = false;
	private loadPromise: Promise<void> | null = null;

	// Search indices
	private codeByCode: Map<string, BnoCode> = new Map();
	private codesByChapter: Map<string, BnoCode[]> = new Map();

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
			const response = await fetch('/data/bno/bno-codes.json');
			if (!response.ok) {
				throw new Error(`Failed to load BNO database: ${response.status}`);
			}

			this.database = await response.json();
			this.buildIndices();

			console.log(
				`[BnoService] Loaded ${this.database?.meta.totalCodes} BNO codes`
			);
		} catch (error) {
			console.error('[BnoService] Failed to load database:', error);
			throw error;
		} finally {
			this.isLoading = false;
		}
	}

	private buildIndices(): void {
		if (!this.database?.codes) return;

		this.codeByCode.clear();
		this.codesByChapter.clear();

		for (const code of this.database.codes) {
			// Index by code (case-insensitive)
			this.codeByCode.set(code.code.toUpperCase(), code);

			// Group by chapter
			const chapterCodes = this.codesByChapter.get(code.chapter) || [];
			chapterCodes.push(code);
			this.codesByChapter.set(code.chapter, chapterCodes);
		}
	}

	/**
	 * Search BNO codes by code or description
	 */
	async search(query: string, options: SearchOptions = {}): Promise<BnoCode[]> {
		await this.initialize();

		if (!this.database?.codes || !query || query.length < 2) {
			return [];
		}

		const { limit = 30, chapter } = options;
		const normalizedQuery = query
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');

		const results: Array<{ code: BnoCode; score: number }> = [];

		for (const code of this.database.codes) {
			// Filter by chapter
			if (chapter && code.chapter !== chapter) continue;

			let score = 0;

			// Exact code match
			if (code.searchCode === normalizedQuery) {
				score = 100;
			}
			// Code starts with
			else if (code.searchCode.startsWith(normalizedQuery)) {
				score = 80;
			}
			// Code contains
			else if (code.searchCode.includes(normalizedQuery)) {
				score = 60;
			}
			// Description starts with word
			else if (code.searchDesc.split(' ').some((w) => w.startsWith(normalizedQuery))) {
				score = 50;
			}
			// Description contains
			else if (code.searchDesc.includes(normalizedQuery)) {
				score = 30;
			}

			if (score > 0) {
				results.push({ code, score });
			}
		}

		// Sort by score (descending), then alphabetically by code
		results.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.code.code.localeCompare(b.code.code);
		});

		return results.slice(0, limit).map((r) => r.code);
	}

	/**
	 * Get code by exact BNO code
	 */
	async getByCode(code: string): Promise<BnoCode | null> {
		await this.initialize();
		return this.codeByCode.get(code.toUpperCase()) || null;
	}

	/**
	 * Get all codes for a chapter
	 */
	async getByChapter(chapter: string, limit?: number): Promise<BnoCode[]> {
		await this.initialize();
		const codes = this.codesByChapter.get(chapter.toUpperCase()) || [];
		return limit ? codes.slice(0, limit) : codes;
	}

	/**
	 * Get MS-related codes (quick access)
	 */
	getMsCodes(): typeof MS_BNO_CODES {
		return MS_BNO_CODES;
	}

	/**
	 * Get chapter info
	 */
	getChapterInfo(chapter: string): string {
		return BNO_CHAPTERS[chapter.toUpperCase()] || 'Ismeretlen fejezet';
	}

	/**
	 * Get all chapters
	 */
	getChapters(): Array<{ code: string; description: string }> {
		return Object.entries(BNO_CHAPTERS).map(([code, description]) => ({
			code,
			description
		}));
	}

	/**
	 * Get database statistics
	 */
	async getStatistics(): Promise<{
		totalCodes: number;
		chapters: number;
		lastUpdated: string;
		source: string;
	}> {
		await this.initialize();

		return {
			totalCodes: this.database?.meta.totalCodes || 0,
			chapters: this.codesByChapter.size,
			lastUpdated: this.database?.meta.extractedAt || 'Unknown',
			source: this.database?.meta.source || 'Unknown'
		};
	}

	/**
	 * Validate a BNO code format
	 */
	isValidFormat(code: string): boolean {
		// BNO codes: Letter + 2-4 digits + optional letter/digit suffix
		return /^[A-Z]\d{2,4}[A-Z0-9]*$/i.test(code);
	}

	/**
	 * Search codes by prefix (for wildcard expansion)
	 * E.g., "G35" returns all codes starting with G35
	 */
	searchByPrefix(prefix: string): BnoCode[] {
		if (!this.database?.codes || !prefix) return [];

		const upperPrefix = prefix.toUpperCase();
		return this.database.codes.filter(code =>
			code.code.toUpperCase().startsWith(upperPrefix)
		);
	}

	/**
	 * Search codes by range (e.g., "I60" to "I69")
	 * Returns all codes that start with codes in the range
	 */
	searchByRange(start: string, end: string): BnoCode[] {
		if (!this.database?.codes || !start || !end) return [];

		const upperStart = start.toUpperCase();
		const upperEnd = end.toUpperCase();

		// Extract the letter and numeric parts
		const startLetter = upperStart.charAt(0);
		const startNum = parseInt(upperStart.slice(1), 10);
		const endNum = parseInt(upperEnd.slice(1), 10);

		const validPrefixes: string[] = [];
		for (let i = startNum; i <= endNum; i++) {
			validPrefixes.push(`${startLetter}${i.toString().padStart(2, '0')}`);
		}

		return this.database.codes.filter(code => {
			const codeUpper = code.code.toUpperCase();
			return validPrefixes.some(prefix => codeUpper.startsWith(prefix));
		});
	}

	/**
	 * Get codes matching multiple patterns (for group expansion)
	 */
	searchByPatterns(patterns: string[]): BnoCode[] {
		const result = new Set<BnoCode>();

		for (const pattern of patterns) {
			if (pattern.includes('*')) {
				const prefix = pattern.replace('*', '').toUpperCase();
				this.searchByPrefix(prefix).forEach(code => result.add(code));
			} else if (pattern.includes('-')) {
				const [start, end] = pattern.split('-');
				this.searchByRange(start, end).forEach(code => result.add(code));
			} else {
				this.searchByPrefix(pattern).forEach(code => result.add(code));
			}
		}

		return Array.from(result);
	}
}

// Export singleton instance
export const bnoService = new BnoDatabaseService();
