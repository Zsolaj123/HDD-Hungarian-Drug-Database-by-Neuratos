/**
 * Manual Pairing Store
 *
 * Stores user-defined pairings between Hungarian drugs and FDA/EMA search terms.
 * When automatic lookup fails, users can manually search and the successful
 * pairing is saved for future auto-lookup.
 */

export interface ManualPairing {
	drugId: string;           // NEAK drug ID
	drugName: string;         // Original Hungarian drug name
	searchTerm: string;       // English search term that worked
	foundBrandName?: string;  // Brand name from FDA/EMA result
	timestamp: number;        // When the pairing was saved
}

const FDA_STORAGE_KEY = 'hdd-manual-fda-pairings';
const EMA_STORAGE_KEY = 'hdd-manual-ema-pairings';

type PairingType = 'fda' | 'ema';

/**
 * Get storage key for pairing type
 */
function getStorageKey(type: PairingType): string {
	return type === 'fda' ? FDA_STORAGE_KEY : EMA_STORAGE_KEY;
}

/**
 * Load all pairings from localStorage
 */
function loadPairings(type: PairingType): Map<string, ManualPairing> {
	if (typeof window === 'undefined') return new Map();

	try {
		const stored = localStorage.getItem(getStorageKey(type));
		if (!stored) return new Map();

		const data = JSON.parse(stored);
		return new Map(Object.entries(data));
	} catch (error) {
		console.error(`[ManualPairingStore] Error loading ${type} pairings:`, error);
		return new Map();
	}
}

/**
 * Save all pairings to localStorage
 */
function savePairings(type: PairingType, pairings: Map<string, ManualPairing>): void {
	if (typeof window === 'undefined') return;

	try {
		const data = Object.fromEntries(pairings);
		localStorage.setItem(getStorageKey(type), JSON.stringify(data));
	} catch (error) {
		console.error(`[ManualPairingStore] Error saving ${type} pairings:`, error);
	}
}

/**
 * Get a saved manual pairing for a drug
 */
export function getManualPairing(type: PairingType, drugId: string): ManualPairing | null {
	const pairings = loadPairings(type);
	return pairings.get(drugId) || null;
}

/**
 * Save a successful manual pairing
 */
export function saveManualPairing(type: PairingType, pairing: ManualPairing): void {
	const pairings = loadPairings(type);
	pairings.set(pairing.drugId, pairing);
	savePairings(type, pairings);

	console.log(`[ManualPairingStore] Saved ${type} pairing for "${pairing.drugName}": ${pairing.searchTerm}`);
}

/**
 * Remove a manual pairing
 */
export function removeManualPairing(type: PairingType, drugId: string): void {
	const pairings = loadPairings(type);
	pairings.delete(drugId);
	savePairings(type, pairings);
}

/**
 * Get all saved pairings for a type
 */
export function getAllPairings(type: PairingType): ManualPairing[] {
	const pairings = loadPairings(type);
	return Array.from(pairings.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Clear all pairings for a type
 */
export function clearAllPairings(type: PairingType): void {
	if (typeof window === 'undefined') return;
	localStorage.removeItem(getStorageKey(type));
}

/**
 * Get pairing statistics
 */
export function getPairingStats(): { fda: number; ema: number } {
	return {
		fda: loadPairings('fda').size,
		ema: loadPairings('ema').size
	};
}
