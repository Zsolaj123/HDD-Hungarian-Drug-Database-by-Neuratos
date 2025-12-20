<script lang="ts">
	/**
	 * DrugAutocomplete - Smart Drug search with local-first architecture
	 *
	 * Features:
	 * - LOCAL-FIRST: Full 46,485 drugs from NEAK MDB (Official ORKA Database)
	 * - SMART SEARCH: Grouped by active ingredient, dosage variants
	 * - PASTE DETECTION: Match pasted drug names from kórlap
	 * - DOSAGE SELECTOR: Show all dosage variants for selected drug
	 * - Debounced search (150ms) for performance
	 * - Keyboard navigation (Arrow keys, Enter, Escape)
	 * - Shows active ingredient, dosage, prescription & reimbursement status
	 * - ARIA accessible
	 */

	import {
		drugService,
		type Drug,
		type SimplifiedDrug,
		type GroupedDrugResult,
		type DrugVariant,
		getRouteDisplayName
	} from '$lib/services/drug-database-service';
	import {
		puphaxService,
		type DrugSummaryLight,
		type ExtendedDrug,
		formatDrugWithStrength,
		getPrescriptionBadgeClass
	} from '$lib/services/puphax-api-service';
	import {
		smartDrugPresetService,
		type DrugPreset
	} from '$lib/services/smart-drug-preset-service';
	import { localDrugExpansionService } from '$lib/services/local-drug-expansion-service';
	import {
		Search,
		Pill,
		AlertCircle,
		Loader2,
		X,
		Info,
		Wifi,
		WifiOff,
		ChevronDown,
		FileText,
		Cloud,
		ClipboardPaste,
		ChevronRight,
		Sparkles
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { fly, fade, slide } from 'svelte/transition';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		/** Current value (drug name) */
		value?: string;
		/** Placeholder text */
		placeholder?: string;
		/** Whether the input is disabled */
		disabled?: boolean;
		/** Auto-focus on mount */
		autofocus?: boolean;
		/** Maximum results to show */
		maxResults?: number;
		/** Show detailed drug info panel on selection */
		showDetailPanel?: boolean;
		/** Enable smart dosage selector when drug is selected */
		showDosageSelector?: boolean;
		/** Enable paste detection for kórlap drug matching */
		enablePasteDetection?: boolean;
		/** Enable grouped mode - groups drugs by base name with inline dosage variants */
		groupedMode?: boolean;
		/** Callback when a drug is selected */
		onSelect?: (drug: Drug | SimplifiedDrug | DrugSummaryLight) => void;
		/** Callback when value changes (for controlled input) */
		onValueChange?: (value: string) => void;
		/** Callback when full drug details are loaded */
		onDetailsLoad?: (details: ExtendedDrug) => void;
		/** Callback when drug preset (dosage/route) is available */
		onPresetAvailable?: (preset: DrugPreset) => void;
		/** Callback when dosage variant is selected */
		onDosageSelect?: (dosage: string, drug: Drug) => void;
		/** Callback when info button is clicked */
		onInfoClick?: (drug: Drug | SimplifiedDrug | DrugSummaryLight) => void;
		/** Callback when custom drug is added from paste panel */
		onAddCustomDrug?: (text: string, dosage?: string, frequency?: string) => void;
		/** Custom class for the container */
		class?: string;
	}

	let {
		value = $bindable(''),
		placeholder = 'Keresés gyógyszer neve, hatóanyag vagy ATC kód alapján...',
		disabled = false,
		autofocus = false,
		maxResults = 20,
		showDetailPanel = false,
		showDosageSelector = true,
		enablePasteDetection = true,
		groupedMode = false,
		onSelect,
		onValueChange,
		onDetailsLoad,
		onPresetAvailable,
		onDosageSelect,
		onInfoClick,
		onAddCustomDrug,
		class: className = ''
	}: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let inputRef: HTMLInputElement | null = $state(null);
	let containerRef: HTMLDivElement | null = $state(null);
	let listRef: HTMLUListElement | null = $state(null);

	let isOpen = $state(false);
	let isLoading = $state(false);
	let isInitialized = $state(false);
	let isPuphaxOnline = $state(false);
	let isPuphaxLoading = $state(false);
	let puphaxSearchTriggered = $state(false); // True when user clicks "Search online" button

	// Search results - unified type that works with both sources
	interface UnifiedDrug {
		id: string;
		name: string;
		activeIngredient: string;
		dosage?: string;
		strength?: string;
		form: string;
		route?: string;
		productForm?: string;
		atcCode: string;
		prescriptionRequired: boolean;
		reimbursable?: boolean;
		manufacturer?: string;
		source: 'local' | 'puphax';
	}

	let results = $state<UnifiedDrug[]>([]);
	let puphaxResults = $state<UnifiedDrug[]>([]);
	let highlightedIndex = $state(-1);
	let searchQuery = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Selected drug details
	let selectedDrug = $state<UnifiedDrug | null>(null);
	let drugDetails = $state<ExtendedDrug | null>(null);
	let isLoadingDetails = $state(false);

	// Dosage variants state
	let dosageVariants = $state<Array<{ drug: Drug; dosage: string; form: string; isExactMatch: boolean }>>([]);
	let showDosageVariantsPanel = $state(false);
	let selectedBaseName = $state('');

	// Paste detection state
	let pasteMatches = $state<Array<{ drug: Drug; confidence: 'high' | 'medium' | 'low'; matchType: string }>>([]);
	let showPastePanel = $state(false);
	let pastedText = $state('');
	let extractedDosage = $state('');
	let extractedFrequency = $state('');

	// Grouped mode state
	let groupedResults = $state<GroupedDrugResult[]>([]);
	let expandedGroupKey = $state<string | null>(null);

	// Stats
	let totalDrugs = $state(0);
	let searchTimeMs = $state(0);

	// ============================================================================
	// Derived
	// ============================================================================

	const allResults = $derived([...results, ...puphaxResults]);
	const hasResults = $derived(allResults.length > 0);
	const showDropdown = $derived(
		isOpen && (hasResults || isLoading || isPuphaxLoading || (value.length >= 2 && !isLoading))
	);
	// Show "Search online" button ONLY when NO local results AND query >= 3 chars AND PUPHAX is online
	// Since we have the full 43K database locally, this should be rare (new drugs or typos)
	const showPuphaxButton = $derived(
		isPuphaxOnline &&
		!puphaxSearchTriggered &&
		!isPuphaxLoading &&
		results.length === 0 &&
		value.length >= 3 &&
		puphaxResults.length === 0
	);

	// ============================================================================
	// Initialization
	// ============================================================================

	onMount(async () => {
		try {
			// Initialize local drug service (fast, ~50ms)
			await drugService.initialize();
			const stats = await drugService.getStatistics();
			totalDrugs = stats.totalDrugs;
			isInitialized = true;

			// Check PUPHAX availability in background (non-blocking)
			// Don't await - let it run in background so UI is immediately responsive
			puphaxService.checkHealth().then(online => {
				isPuphaxOnline = online;
			}).catch(() => {
				isPuphaxOnline = false;
			});
		} catch (error) {
			console.error('[DrugAutocomplete] Failed to initialize:', error);
		}

		// Handle clicks outside to close dropdown
		const handleClickOutside = (e: MouseEvent) => {
			if (containerRef && !containerRef.contains(e.target as Node)) {
				isOpen = false;
				highlightedIndex = -1;
			}
		};

		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});

	// ============================================================================
	// Search Logic
	// ============================================================================

	function normalizeToUnified(
		drug: Drug | SimplifiedDrug,
		source: 'local' | 'puphax'
	): UnifiedDrug {
		return {
			id: drug.id,
			name: drug.name,
			activeIngredient: drug.activeIngredient,
			dosage: drug.dosage,
			form: drug.form,
			route: drug.route,
			atcCode: drug.atcCode,
			prescriptionRequired: drug.prescriptionRequired,
			source
		};
	}

	function normalizePuphaxDrug(drug: DrugSummaryLight): UnifiedDrug {
		return {
			id: drug.id,
			name: drug.name,
			activeIngredient: drug.activeIngredient,
			strength: drug.strength,
			form: drug.productForm,
			productForm: drug.productForm,
			atcCode: drug.atcCode,
			prescriptionRequired: drug.prescriptionRequired,
			reimbursable: drug.reimbursable,
			manufacturer: drug.manufacturer,
			source: 'puphax'
		};
	}

	async function performLocalSearch(query: string): Promise<UnifiedDrug[]> {
		const searchResults = await drugService.searchDrugs(query, { limit: maxResults });
		const unified = searchResults.map((d) => normalizeToUnified(d, 'local'));

		// Sort: active drugs first, then withdrawn drugs
		unified.sort((a, b) => {
			const aActive = a.inMarket !== false;
			const bActive = b.inMarket !== false;
			if (aActive && !bActive) return -1;
			if (!aActive && bActive) return 1;
			return 0; // Keep original order for same status
		});

		return unified;
	}

	async function performPuphaxSearch(query: string): Promise<UnifiedDrug[]> {
		if (!isPuphaxOnline) return [];

		const response = await puphaxService.searchDrugs(query, { limit: maxResults });
		if (!response?.drugs) return [];

		return response.drugs.map(normalizePuphaxDrug);
	}

	async function performSearch(query: string) {
		if (!query || query.length < 2) {
			results = [];
			puphaxResults = [];
			groupedResults = [];
			expandedGroupKey = null;
			isLoading = false;
			puphaxSearchTriggered = false;
			return;
		}

		const startTime = performance.now();

		// Local search only (instant) - PUPHAX is now button-triggered
		isLoading = true;
		puphaxSearchTriggered = false;
		puphaxResults = [];
		expandedGroupKey = null;

		try {
			if (groupedMode) {
				// Use grouped search for two-step selection
				groupedResults = await drugService.searchDrugsGrouped(query, { limit: maxResults });

				// Sort: groups with active variants first, all-withdrawn groups last
				groupedResults.sort((a, b) => {
					const aHasActive = a.variants.some(v => v.isInMarket);
					const bHasActive = b.variants.some(v => v.isInMarket);
					if (aHasActive && !bHasActive) return -1;
					if (!aHasActive && bHasActive) return 1;
					return 0;
				});

				results = []; // Clear flat results in grouped mode
				highlightedIndex = groupedResults.length > 0 ? 0 : -1;
			} else {
				// Regular flat search
				results = await performLocalSearch(query);
				groupedResults = [];
				highlightedIndex = results.length > 0 ? 0 : -1;
			}
		} catch (error) {
			console.error('[DrugAutocomplete] Local search error:', error);
			results = [];
			groupedResults = [];
		}
		isLoading = false;
		searchTimeMs = Math.round(performance.now() - startTime);
	}

	/**
	 * Trigger PUPHAX search manually (button click)
	 */
	async function triggerPuphaxSearch() {
		if (!isPuphaxOnline || !value || value.length < 2) return;

		puphaxSearchTriggered = true;
		isPuphaxLoading = true;

		try {
			const puphaxDrugs = await performPuphaxSearch(value);
			// Filter out duplicates (by name similarity)
			const localNames = new Set(results.map((d) => d.name.toLowerCase()));
			puphaxResults = puphaxDrugs.filter((d) => !localNames.has(d.name.toLowerCase()));
			// Update highlighted index if we now have results
			if (puphaxResults.length > 0 && highlightedIndex < 0) {
				highlightedIndex = results.length;
			}
		} catch (error) {
			console.error('[DrugAutocomplete] PUPHAX search error:', error);
			puphaxResults = [];
		}

		isPuphaxLoading = false;
	}

	function debouncedSearch(query: string) {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		searchQuery = query;

		if (!query || query.length < 2) {
			results = [];
			puphaxResults = [];
			isLoading = false;
			return;
		}

		isLoading = true;
		debounceTimer = setTimeout(() => {
			performSearch(query);
		}, 100); // Reduced from 150ms for snappier response
	}

	// ============================================================================
	// Paste Detection
	// ============================================================================

	async function handlePaste(e: ClipboardEvent) {
		if (!enablePasteDetection) return;

		const text = e.clipboardData?.getData('text');
		if (!text || text.length < 3 || text.length > 200) return;

		// Check if this looks like a drug entry (has letters and possibly numbers/dosage)
		const looksLikeDrug = /^[a-záéíóöőúüű\s]+([\d.,]+\s*(mg|g|ml|mcg)?)?/i.test(text.trim());
		if (!looksLikeDrug) return;

		pastedText = text.trim();

		try {
			const matchResult = await drugService.matchPastedDrug(pastedText);

			pasteMatches = matchResult.matches.map((m) => ({
				drug: m.drug,
				confidence: m.confidence,
				matchType: m.matchType
			}));
			extractedDosage = matchResult.extractedInfo.dosage || '';
			extractedFrequency = matchResult.extractedInfo.frequency || '';
			// Show panel even if no matches (for custom drug option)
			showPastePanel = true;
		} catch (error) {
			console.error('[DrugAutocomplete] Paste match failed:', error);
			// Still show panel for custom drug option on error
			if (onAddCustomDrug) {
				pasteMatches = [];
				showPastePanel = true;
			}
		}
	}

	function selectPasteMatch(drug: Drug) {
		const displayName = drug.dosage ? `${drug.name}` : drug.name;
		value = displayName;
		onValueChange?.(value);

		selectedDrug = normalizeToUnified(drug, 'local');

		const drugForCallback = {
			id: drug.id,
			name: drug.name,
			activeIngredient: drug.activeIngredient,
			dosage: drug.dosage || '',
			form: drug.form,
			route: drug.route,
			atcCode: drug.atcCode,
			prescriptionRequired: drug.prescriptionRequired
		};
		onSelect?.(drugForCallback);

		// Load dosage variants
		if (showDosageSelector) {
			loadDosageVariants(drug.id);
		}

		// Get preset
		const localDrug: SimplifiedDrug = {
			id: drug.id,
			name: drug.name,
			activeIngredient: drug.activeIngredient,
			dosage: drug.dosage || '',
			form: drug.form,
			route: drug.route,
			prescriptionRequired: drug.prescriptionRequired,
			atcCode: drug.atcCode
		};
		const preset = smartDrugPresetService.extractPresetFromLocal(localDrug);
		if (preset.isSuggested) {
			onPresetAvailable?.(preset);
		}

		showPastePanel = false;
		pasteMatches = [];
		isOpen = false;
	}

	function closePastePanel() {
		showPastePanel = false;
		pasteMatches = [];
		pastedText = '';
	}

	// ============================================================================
	// Dosage Variants
	// ============================================================================

	async function loadDosageVariants(drugId: string) {
		if (!showDosageSelector) return;

		try {
			const variants = await drugService.getDosageVariants(drugId);
			if (variants && variants.variants.length > 1) {
				dosageVariants = variants.variants.map((v) => ({
					drug: v.drug,
					dosage: v.dosage,
					form: v.form,
					isExactMatch: v.isExactMatch
				}));
				selectedBaseName = variants.baseName;
				showDosageVariantsPanel = true;
			} else {
				dosageVariants = [];
				showDosageVariantsPanel = false;
			}
		} catch (error) {
			console.error('[DrugAutocomplete] Failed to load dosage variants:', error);
			dosageVariants = [];
		}
	}

	function selectDosageVariant(variant: { drug: Drug; dosage: string }) {
		value = variant.drug.name;
		onValueChange?.(value);

		selectedDrug = normalizeToUnified(variant.drug, 'local');

		const drugForCallback = {
			id: variant.drug.id,
			name: variant.drug.name,
			activeIngredient: variant.drug.activeIngredient,
			dosage: variant.drug.dosage || '',
			form: variant.drug.form,
			route: variant.drug.route,
			atcCode: variant.drug.atcCode,
			prescriptionRequired: variant.drug.prescriptionRequired
		};
		onSelect?.(drugForCallback);
		onDosageSelect?.(variant.dosage, variant.drug);

		// Update preset
		const localDrug: SimplifiedDrug = {
			id: variant.drug.id,
			name: variant.drug.name,
			activeIngredient: variant.drug.activeIngredient,
			dosage: variant.drug.dosage || '',
			form: variant.drug.form,
			route: variant.drug.route,
			prescriptionRequired: variant.drug.prescriptionRequired,
			atcCode: variant.drug.atcCode
		};
		const preset = smartDrugPresetService.extractPresetFromLocal(localDrug);
		if (preset.isSuggested) {
			onPresetAvailable?.(preset);
		}

		showDosageVariantsPanel = false;
	}

	function closeDosagePanel() {
		showDosageVariantsPanel = false;
		dosageVariants = [];
	}

	// ============================================================================
	// Drug Details (Lazy Loading)
	// ============================================================================

	async function loadDrugDetails(drug: UnifiedDrug) {
		if (drug.source !== 'puphax' || !isPuphaxOnline) return;

		isLoadingDetails = true;
		try {
			const details = await puphaxService.getDrugDetails(drug.id);
			if (details) {
				drugDetails = details;
				onDetailsLoad?.(details);
			}
		} catch (error) {
			console.error('[DrugAutocomplete] Failed to load details:', error);
		}
		isLoadingDetails = false;
	}

	// ============================================================================
	// Event Handlers
	// ============================================================================

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		value = target.value;
		onValueChange?.(value);
		debouncedSearch(value);
		isOpen = true;
		selectedDrug = null;
		drugDetails = null;
	}

	function handleFocus() {
		if (value && value.length >= 2) {
			isOpen = true;
			if (results.length === 0) {
				debouncedSearch(value);
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!isOpen) {
			if (e.key === 'ArrowDown' && value.length >= 2) {
				isOpen = true;
				e.preventDefault();
			}
			return;
		}

		const totalResults = allResults.length;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				highlightedIndex = Math.min(highlightedIndex + 1, totalResults - 1);
				scrollToHighlighted();
				break;

			case 'ArrowUp':
				e.preventDefault();
				highlightedIndex = Math.max(highlightedIndex - 1, 0);
				scrollToHighlighted();
				break;

			case 'Enter':
				e.preventDefault();
				if (highlightedIndex >= 0 && allResults[highlightedIndex]) {
					selectDrug(allResults[highlightedIndex]);
				}
				break;

			case 'Escape':
				e.preventDefault();
				isOpen = false;
				highlightedIndex = -1;
				break;

			case 'Tab':
				isOpen = false;
				highlightedIndex = -1;
				break;
		}
	}

	function scrollToHighlighted() {
		if (listRef && highlightedIndex >= 0) {
			const item = listRef.children[highlightedIndex] as HTMLElement;
			if (item) {
				item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		}
	}

	async function selectDrug(drug: UnifiedDrug) {
		const displayName = drug.strength ? `${drug.name} ${drug.strength}` : drug.name;
		value = displayName;
		onValueChange?.(value);
		selectedDrug = drug;

		// Create compatible object for onSelect callback
		const drugForCallback = {
			id: drug.id,
			name: drug.name,
			activeIngredient: drug.activeIngredient,
			dosage: drug.dosage || drug.strength || '',
			form: drug.form || drug.productForm || '',
			route: (drug.route as Drug['route']) || 'oral',
			atcCode: drug.atcCode,
			prescriptionRequired: drug.prescriptionRequired
		};
		onSelect?.(drugForCallback);

		isOpen = false;
		highlightedIndex = -1;

		// If PUPHAX drug, add to local expansion cache
		if (drug.source === 'puphax') {
			// Create DrugSummaryLight-like object for the expansion service
			const summaryDrug: DrugSummaryLight = {
				id: drug.id,
				name: drug.name,
				manufacturer: drug.manufacturer || '',
				atcCode: drug.atcCode,
				activeIngredient: drug.activeIngredient,
				prescriptionRequired: drug.prescriptionRequired,
				reimbursable: drug.reimbursable ?? false,
				productForm: drug.productForm || drug.form,
				strength: drug.strength || drug.dosage || '',
				packSize: ''
			};
			await localDrugExpansionService.addPuphaxDrug(summaryDrug);

			// Load full details and extract preset
			if (isPuphaxOnline) {
				const details = await puphaxService.getDrugDetails(drug.id);
				if (details) {
					drugDetails = details;
					onDetailsLoad?.(details);

					// Extract preset from extended drug details
					const preset = smartDrugPresetService.extractPresetFromExtended(details);
					if (preset.isSuggested) {
						onPresetAvailable?.(preset);
					}
				} else {
					// Fallback: extract preset from summary
					const preset = smartDrugPresetService.extractPresetFromSummary(summaryDrug);
					if (preset.isSuggested) {
						onPresetAvailable?.(preset);
					}
				}
			} else {
				// Offline: extract preset from summary
				const preset = smartDrugPresetService.extractPresetFromSummary(summaryDrug);
				if (preset.isSuggested) {
					onPresetAvailable?.(preset);
				}
			}
		} else {
			// Local drug: extract preset directly
			const localDrug: SimplifiedDrug = {
				id: drug.id,
				name: drug.name,
				activeIngredient: drug.activeIngredient,
				dosage: drug.dosage || '',
				form: drug.form,
				route: (drug.route as Drug['route']) || 'oral',
				prescriptionRequired: drug.prescriptionRequired,
				atcCode: drug.atcCode
			};
			const preset = smartDrugPresetService.extractPresetFromLocal(localDrug);
			if (preset.isSuggested) {
				onPresetAvailable?.(preset);
			}
		}

		// Load dosage variants for the selected drug
		if (showDosageSelector && drug.source === 'local') {
			loadDosageVariants(drug.id);
		}

		// Show detail panel if enabled (for local drugs without auto-load)
		if (showDetailPanel && drug.source === 'puphax' && !drugDetails) {
			loadDrugDetails(drug);
		}
	}

	function clearInput() {
		value = '';
		onValueChange?.('');
		results = [];
		puphaxResults = [];
		isOpen = false;
		highlightedIndex = -1;
		selectedDrug = null;
		drugDetails = null;
		inputRef?.focus();
	}

	// ============================================================================
	// Helpers
	// ============================================================================

	function getHighlightParts(
		text: string,
		query: string
	): Array<{ text: string; highlighted: boolean }> {
		if (!query || query.length < 2 || !text) {
			return [{ text: text || '', highlighted: false }];
		}

		const parts: Array<{ text: string; highlighted: boolean }> = [];
		const lowerText = text.toLowerCase();
		const lowerQuery = query.toLowerCase();
		let lastIndex = 0;

		let index = lowerText.indexOf(lowerQuery);
		while (index !== -1) {
			if (index > lastIndex) {
				parts.push({ text: text.slice(lastIndex, index), highlighted: false });
			}
			parts.push({ text: text.slice(index, index + query.length), highlighted: true });
			lastIndex = index + query.length;
			index = lowerText.indexOf(lowerQuery, lastIndex);
		}

		if (lastIndex < text.length) {
			parts.push({ text: text.slice(lastIndex), highlighted: false });
		}

		return parts.length > 0 ? parts : [{ text, highlighted: false }];
	}

	function getRouteShortLabel(route: string | undefined): string {
		if (!route) return '';
		const shortLabels: Record<string, string> = {
			oral: 'PO',
			iv: 'IV',
			im: 'IM',
			sc: 'SC',
			topical: 'TOP',
			inhaled: 'INH',
			rectal: 'RECT',
			ophthalmic: 'OPH',
			nasal: 'NAS',
			sublingual: 'SL'
		};
		return shortLabels[route] || route.toUpperCase().slice(0, 3);
	}

	function getPrescriptionBadge(required: boolean): { text: string; class: string } {
		return required
			? { text: 'Rx', class: 'bg-red-500/20 text-red-400 border-red-500/30' }
			: { text: 'OTC', class: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
	}

	function getReimbursementBadge(
		reimbursable: boolean | undefined
	): { text: string; class: string } | null {
		if (reimbursable === undefined) return null;
		return reimbursable
			? { text: 'TB', class: 'bg-blue-500/20 text-blue-400 border-blue-500/30' }
			: { text: 'NTB', class: 'bg-slate-500/20 text-slate-400 border-slate-500/30' };
	}

	/**
	 * Check if drug is discontinued (not in market)
	 */
	function isDiscontinued(drug: Drug | SimplifiedDrug | DrugSummaryLight): boolean {
		return 'inMarket' in drug && drug.inMarket === false;
	}

	/**
	 * Handle info button click
	 */
	function handleInfoClick(e: MouseEvent, drug: Drug | SimplifiedDrug | DrugSummaryLight) {
		e.stopPropagation();
		e.preventDefault();
		onInfoClick?.(drug);
	}

	/**
	 * Handle adding custom drug from paste panel
	 */
	function handleAddCustomDrug() {
		onAddCustomDrug?.(pastedText, extractedDosage, extractedFrequency);
		closePastePanel();
	}

	// ============================================================================
	// Grouped Mode Handlers
	// ============================================================================

	/**
	 * Toggle group expansion in grouped mode
	 */
	function toggleGroupExpansion(group: GroupedDrugResult) {
		const groupKey = `${group.baseName}|${group.activeIngredient}`;
		if (expandedGroupKey === groupKey) {
			expandedGroupKey = null;
		} else {
			expandedGroupKey = groupKey;
		}
	}

	/**
	 * Check if a group is expanded
	 */
	function isGroupExpanded(group: GroupedDrugResult): boolean {
		const groupKey = `${group.baseName}|${group.activeIngredient}`;
		return expandedGroupKey === groupKey;
	}

	/**
	 * Select a specific drug variant from grouped mode
	 */
	function selectGroupedVariant(variant: DrugVariant) {
		const drug = variant.drug;
		value = drug.name;
		onValueChange?.(value);

		selectedDrug = normalizeToUnified(drug, 'local');

		const drugForCallback = {
			id: drug.id,
			name: drug.name,
			activeIngredient: drug.activeIngredient,
			dosage: drug.dosage || '',
			form: drug.form,
			route: drug.route,
			atcCode: drug.atcCode,
			prescriptionRequired: drug.prescriptionRequired
		};
		onSelect?.(drugForCallback);
		onDosageSelect?.(variant.dosage, drug);

		// Extract preset
		const localDrug: SimplifiedDrug = {
			id: drug.id,
			name: drug.name,
			activeIngredient: drug.activeIngredient,
			dosage: drug.dosage || '',
			form: drug.form,
			route: drug.route,
			prescriptionRequired: drug.prescriptionRequired,
			atcCode: drug.atcCode
		};
		const preset = smartDrugPresetService.extractPresetFromLocal(localDrug);
		if (preset.isSuggested) {
			onPresetAvailable?.(preset);
		}

		isOpen = false;
		highlightedIndex = -1;
		expandedGroupKey = null;
		groupedResults = [];
	}

	/**
	 * Handle group click - always expand to show dosage variants
	 * User must explicitly select a dosage variant
	 */
	function selectGroupDefault(group: GroupedDrugResult, e: MouseEvent) {
		// Always toggle expansion - require explicit dosage selection
		toggleGroupExpansion(group);
	}

	/**
	 * Handle keyboard navigation in grouped mode
	 */
	function handleGroupedKeydown(e: KeyboardEvent) {
		if (!isOpen || !groupedMode) return;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				highlightedIndex = Math.min(highlightedIndex + 1, groupedResults.length - 1);
				scrollToHighlighted();
				break;

			case 'ArrowUp':
				e.preventDefault();
				highlightedIndex = Math.max(highlightedIndex - 1, 0);
				scrollToHighlighted();
				break;

			case 'Enter':
				e.preventDefault();
				if (highlightedIndex >= 0 && groupedResults[highlightedIndex]) {
					const group = groupedResults[highlightedIndex];
					if (group.variants.length === 1) {
						selectGroupedVariant(group.variants[0]);
					} else if (isGroupExpanded(group)) {
						// Select first variant if already expanded
						selectGroupedVariant(group.variants[0]);
					} else {
						toggleGroupExpansion(group);
					}
				}
				break;

			case 'ArrowRight':
				e.preventDefault();
				if (highlightedIndex >= 0 && groupedResults[highlightedIndex]) {
					const group = groupedResults[highlightedIndex];
					if (!isGroupExpanded(group)) {
						toggleGroupExpansion(group);
					}
				}
				break;

			case 'ArrowLeft':
				e.preventDefault();
				expandedGroupKey = null;
				break;

			case 'Escape':
				e.preventDefault();
				if (expandedGroupKey) {
					expandedGroupKey = null;
				} else {
					isOpen = false;
					highlightedIndex = -1;
				}
				break;

			case 'Tab':
				isOpen = false;
				highlightedIndex = -1;
				expandedGroupKey = null;
				break;
		}
	}

	/**
	 * Get short form label for grouped display
	 */
	function getShortFormLabel(form: string): string {
		if (!form) return '';
		const shortForms: Record<string, string> = {
			'filmtabletta': 'film.',
			'tabletta': 'tabl.',
			'kapszula': 'kaps.',
			'kemény kapszula': 'k.kaps.',
			'lágy kapszula': 'l.kaps.',
			'injekció': 'inj.',
			'infúzió': 'inf.',
			'oldat': 'old.',
			'por': 'por',
			'krém': 'krém',
			'kenőcs': 'ken.',
			'gél': 'gél',
			'spray': 'spray',
			'szemcsepp': 'sz.csepp'
		};

		const lower = form.toLowerCase();
		for (const [key, short] of Object.entries(shortForms)) {
			if (lower.includes(key)) return short;
		}
		return form.substring(0, 6);
	}
</script>

<div bind:this={containerRef} class="relative w-full {className}">
	<!-- Input Field -->
	<div class="relative">
		<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
			{#if isLoading}
				<Loader2 class="h-5 w-5 text-slate-400 animate-spin" />
			{:else}
				<Search class="h-5 w-5 text-slate-400" />
			{/if}
		</div>

		<input
			bind:this={inputRef}
			type="text"
			{value}
			{placeholder}
			{disabled}
			autocomplete="off"
			spellcheck="false"
			role="combobox"
			aria-autocomplete="list"
			aria-expanded={isOpen}
			aria-controls="drug-autocomplete-listbox"
			aria-activedescendant={highlightedIndex >= 0 ? `drug-option-${highlightedIndex}` : undefined}
			class="w-full pl-10 pr-20 py-3 bg-slate-800/50 border border-slate-600 rounded-lg
				text-white placeholder-slate-400
				focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
				disabled:opacity-50 disabled:cursor-not-allowed
				transition-all duration-200"
			oninput={handleInput}
			onfocus={handleFocus}
			onkeydown={groupedMode ? handleGroupedKeydown : handleKeydown}
			onpaste={handlePaste}
		/>

		<!-- Right side icons -->
		<div class="absolute inset-y-0 right-0 pr-3 flex items-center gap-2">
			<!-- Online/Offline indicator -->
			{#if isInitialized}
				<div
					class="flex items-center gap-1 text-xs"
					title={isPuphaxOnline ? 'PUPHAX online' : 'Offline mód'}
				>
					{#if isPuphaxOnline}
						<Wifi class="h-4 w-4 text-emerald-400" />
					{:else}
						<WifiOff class="h-4 w-4 text-slate-500" />
					{/if}
				</div>
			{/if}

			<!-- Clear button -->
			{#if value}
				<button
					type="button"
					class="text-slate-400 hover:text-white transition-colors"
					onclick={clearInput}
					aria-label="Törlés"
				>
					<X class="h-5 w-5" />
				</button>
			{/if}
		</div>
	</div>

	<!-- Status Bar -->
	{#if isInitialized && !isOpen}
		<div class="mt-1 text-xs text-slate-500 flex items-center gap-2">
			<Pill class="h-3 w-3" />
			<span>{totalDrugs.toLocaleString('hu-HU')} gyógyszer (NEAK MDB)</span>
			{#if enablePasteDetection}
				<span class="text-blue-400 flex items-center gap-1" title="Gyógyszer beillesztés felismerés">
					<ClipboardPaste class="h-3 w-3" />
				</span>
			{/if}
			{#if isPuphaxOnline}
				<span class="text-emerald-500 flex items-center gap-1">
					<Wifi class="h-3 w-3" />
					<span>online</span>
				</span>
			{/if}
		</div>
	{/if}

	<!-- Dropdown Results -->
	{#if showDropdown}
		<div
			class="absolute z-50 w-full mt-2 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden"
			transition:fly={{ y: -10, duration: 200 }}
		>
			<!-- Grouped Results List (Two-Step Selection) -->
			{#if groupedMode && groupedResults.length > 0}
				<ul
					bind:this={listRef}
					id="drug-autocomplete-listbox"
					role="listbox"
					class="max-h-96 overflow-y-auto"
				>
					<!-- Grouped Results Header -->
					<li class="px-3 py-1.5 bg-slate-900/50 text-xs text-slate-500 font-medium sticky top-0 flex justify-between">
						<span>{groupedResults.length} gyógyszercsoport</span>
						<span class="text-blue-400">Kattintson a kiszerelésekhez</span>
					</li>

					{#each groupedResults as group, index (`${group.baseName}|${group.activeIngredient}`)}
						{@const isHighlighted = index === highlightedIndex}
						{@const isExpanded = isGroupExpanded(group)}
						{@const prescriptionBadge = getPrescriptionBadge(group.defaultVariant.prescriptionRequired)}
						{@const hasActiveVariant = group.variants.some(v => v.isInMarket)}
						{@const allWithdrawn = !hasActiveVariant}

						<!-- Group Header -->
						<li
							id="drug-option-{index}"
							role="option"
							aria-selected={isHighlighted}
							aria-expanded={isExpanded}
							tabindex="-1"
							class="px-4 py-3 cursor-pointer border-b border-slate-700/50
								transition-colors duration-100
								{isHighlighted
								? 'bg-blue-600/20 border-l-2 border-l-blue-500'
								: 'hover:bg-slate-700/50'}
								{allWithdrawn ? 'opacity-50 grayscale-[30%]' : ''}"
							onclick={(e) => selectGroupDefault(group, e)}
							onmouseenter={() => (highlightedIndex = index)}
						>
							<div class="flex items-center justify-between gap-2">
								<!-- Group Info -->
								<div class="flex-1 min-w-0">
									<!-- Drug Base Name -->
									<div class="font-medium text-white truncate flex items-center gap-2">
										<span>
											{#each getHighlightParts(group.displayName, searchQuery) as part}
												{#if part.highlighted}
													<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part.text}</mark>
												{:else}
													{part.text}
												{/if}
											{/each}
										</span>
										{#if allWithdrawn}
											<span class="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-900/40 text-red-400 border border-red-700/40">
												Kivont
											</span>
										{/if}
									</div>

									<!-- Active Ingredient & ATC -->
									<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
										{#if group.activeIngredient}
											<span class="truncate max-w-[200px]">
												{#each getHighlightParts(group.activeIngredient, searchQuery) as part}
													{#if part.highlighted}
														<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part.text}</mark>
													{:else}
														{part.text}
													{/if}
												{/each}
											</span>
										{/if}
										{#if group.atcCode}
											<span class="text-slate-500 font-mono text-xs">{group.atcCode}</span>
										{/if}
									</div>
								</div>

								<!-- Right Side: Variant Count Badge + Expand Icon -->
								<div class="flex items-center gap-2 flex-shrink-0">
									<!-- Prescription Badge -->
									<span class="px-2 py-0.5 text-xs font-medium rounded border {prescriptionBadge.class}">
										{prescriptionBadge.text}
									</span>

									<!-- Variant Count Badge -->
									<span class="px-2 py-1 text-xs font-medium rounded-full
										{group.variantCount > 1 ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-slate-700/50 text-slate-400'}">
										{group.variantCount} kisz.
									</span>

									<!-- Expand/Collapse Icon - always show -->
									<ChevronRight
										class="h-4 w-4 text-slate-400 transition-transform duration-200 {isExpanded ? 'rotate-90' : ''}"
									/>
								</div>
							</div>

							<!-- Expanded Dosage Variants - always show when expanded -->
							{#if isExpanded}
								<div
									class="mt-3 pt-3 border-t border-slate-700/50"
									transition:slide={{ duration: 150 }}
									onclick={(e) => e.stopPropagation()}
								>
									<div class="flex flex-wrap gap-2">
										{#each group.variants as variant (variant.drug.id)}
											{@const isInMarket = variant.isInMarket}
											<button
												type="button"
												class="px-3 py-2 rounded-lg border text-sm font-medium transition-all
													{isInMarket
														? 'bg-slate-700/50 border-slate-600 text-white hover:bg-blue-500/20 hover:border-blue-500/50'
														: 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-700/50'}"
												onclick={(e) => { e.stopPropagation(); selectGroupedVariant(variant); }}
											>
												<span class="font-bold text-blue-400">{variant.dosage || 'N/A'}</span>
												{#if variant.form}
													<span class="text-xs text-slate-500 ml-1">· {getShortFormLabel(variant.form)}</span>
												{/if}
												{#if !isInMarket}
													<span class="text-xs text-slate-500 ml-1">(kivont)</span>
												{/if}
											</button>
										{/each}
									</div>
									<p class="mt-2 text-xs text-slate-500">
										Válassza ki a kívánt kiszerelést
									</p>
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				<!-- Grouped Results Footer -->
				<div class="px-4 py-2 bg-slate-900/50 border-t border-slate-700 text-xs text-slate-500 flex justify-between">
					<span>{groupedResults.length} csoport · {groupedResults.reduce((sum, g) => sum + g.variantCount, 0)} kiszerelés</span>
					<span>{searchTimeMs}ms</span>
				</div>

			<!-- Flat Results List (Default Mode) -->
			{:else if hasResults}
				<ul
					bind:this={listRef}
					id="drug-autocomplete-listbox"
					role="listbox"
					class="max-h-80 overflow-y-auto"
				>
					<!-- Local Results Section -->
					{#if results.length > 0}
						<li class="px-3 py-1.5 bg-slate-900/50 text-xs text-slate-500 font-medium sticky top-0">
							Helyi adatbázis ({results.length})
						</li>
					{/if}

					{#each results as drug, index (drug.id)}
						{@const isHighlighted = index === highlightedIndex}
						{@const prescriptionBadge = getPrescriptionBadge(drug.prescriptionRequired)}
						{@const discontinued = isDiscontinued(drug)}
						<li
							id="drug-option-{index}"
							role="option"
							aria-selected={isHighlighted}
							tabindex="-1"
							class="px-4 py-3 cursor-pointer border-b border-slate-700/50 last:border-b-0
								transition-colors duration-100
								{isHighlighted
								? 'bg-blue-600/20 border-l-2 border-l-blue-500'
								: 'hover:bg-slate-700/50'}
								{discontinued ? 'opacity-50 grayscale-[30%]' : ''}"
							onclick={() => selectDrug(drug)}
							onkeydown={(e) => e.key === 'Enter' && selectDrug(drug)}
							onmouseenter={() => (highlightedIndex = index)}
						>
							<div class="flex items-start justify-between gap-2">
								<!-- Drug Info -->
								<div class="flex-1 min-w-0">
									<!-- Drug Name -->
									<div class="font-medium text-white truncate flex items-center gap-2">
										<span>
											{#each getHighlightParts(drug.name, searchQuery) as part}
												{#if part.highlighted}
													<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5"
														>{part.text}</mark
													>
												{:else}
													{part.text}
												{/if}
											{/each}
										</span>
										{#if discontinued}
											<span class="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-900/40 text-red-400 border border-red-700/40">
												Kivont
											</span>
										{/if}
									</div>

									<!-- Active Ingredient & Details -->
									<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
										{#if drug.activeIngredient}
											<span class="truncate max-w-[200px]">
												{#each getHighlightParts(drug.activeIngredient, searchQuery) as part}
													{#if part.highlighted}
														<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5"
															>{part.text}</mark
														>
													{:else}
														{part.text}
													{/if}
												{/each}
											</span>
										{/if}

										{#if drug.dosage || drug.strength}
											<span class="text-blue-400 font-medium">{drug.dosage || drug.strength}</span>
										{/if}

										{#if drug.form || drug.productForm}
											<span class="text-slate-500">· {drug.form || drug.productForm}</span>
										{/if}
									</div>

									<!-- ATC Code -->
									{#if drug.atcCode}
										<div class="mt-1 text-xs text-slate-500 font-mono">
											{#each getHighlightParts(drug.atcCode, searchQuery) as part}
												{#if part.highlighted}
													<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5"
														>{part.text}</mark
													>
												{:else}
													{part.text}
												{/if}
											{/each}
										</div>
									{/if}
								</div>

								<!-- Badges and Info Button -->
								<div class="flex items-start gap-2 flex-shrink-0">
									<!-- Info Button -->
									{#if onInfoClick}
										<button
											type="button"
											class="p-1.5 rounded-md hover:bg-slate-600/50 text-slate-400 hover:text-blue-400 transition-colors"
											onclick={(e) => handleInfoClick(e, drug)}
											title="Gyógyszer információ"
											aria-label="Gyógyszer információ"
										>
											<Info class="h-4 w-4" />
										</button>
									{/if}

									<!-- Badges Column -->
									<div class="flex flex-col items-end gap-1">
										<!-- Route Badge -->
										{#if drug.route}
											<span class="px-2 py-0.5 text-xs font-medium rounded bg-slate-700 text-slate-300">
												{getRouteShortLabel(drug.route)}
											</span>
										{/if}

										<!-- Prescription Badge -->
										<span
											class="px-2 py-0.5 text-xs font-medium rounded border {prescriptionBadge.class}"
										>
											{prescriptionBadge.text}
										</span>
									</div>
								</div>
							</div>
						</li>
					{/each}

					<!-- PUPHAX Results Section -->
					{#if puphaxResults.length > 0}
						<li
							class="px-3 py-1.5 bg-emerald-900/30 text-xs text-emerald-400 font-medium sticky top-0 border-t border-emerald-500/20"
						>
							<span class="flex items-center gap-1.5">
								<Wifi class="h-3 w-3" />
								PUPHAX ({puphaxResults.length} további)
							</span>
						</li>
					{/if}

					{#each puphaxResults as drug, i (drug.id)}
						{@const index = results.length + i}
						{@const isHighlighted = index === highlightedIndex}
						{@const prescriptionBadge = getPrescriptionBadge(drug.prescriptionRequired)}
						{@const reimbursementBadge = getReimbursementBadge(drug.reimbursable)}
						<li
							id="drug-option-{index}"
							role="option"
							aria-selected={isHighlighted}
							tabindex="-1"
							class="px-4 py-3 cursor-pointer border-b border-slate-700/50 last:border-b-0
								transition-colors duration-100
								{isHighlighted
								? 'bg-emerald-600/20 border-l-2 border-l-emerald-500'
								: 'hover:bg-slate-700/50'}"
							onclick={() => selectDrug(drug)}
							onkeydown={(e) => e.key === 'Enter' && selectDrug(drug)}
							onmouseenter={() => (highlightedIndex = index)}
						>
							<div class="flex items-start justify-between gap-2">
								<!-- Drug Info -->
								<div class="flex-1 min-w-0">
									<!-- Drug Name with strength -->
									<div class="font-medium text-white truncate">
										{#each getHighlightParts(drug.name, searchQuery) as part}
											{#if part.highlighted}
												<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5"
													>{part.text}</mark
												>
											{:else}
												{part.text}
											{/if}
										{/each}
										{#if drug.strength}
											<span class="text-blue-400 ml-1">{drug.strength}</span>
										{/if}
									</div>

									<!-- Active Ingredient & Details -->
									<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
										{#if drug.activeIngredient}
											<span class="truncate max-w-[200px]">
												{#each getHighlightParts(drug.activeIngredient, searchQuery) as part}
													{#if part.highlighted}
														<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5"
															>{part.text}</mark
														>
													{:else}
														{part.text}
													{/if}
												{/each}
											</span>
										{/if}

										{#if drug.productForm}
											<span class="text-slate-500">· {drug.productForm}</span>
										{/if}

										{#if drug.manufacturer}
											<span class="text-slate-600 text-xs">({drug.manufacturer})</span>
										{/if}
									</div>

									<!-- ATC Code -->
									{#if drug.atcCode}
										<div class="mt-1 text-xs text-slate-500 font-mono">
											{drug.atcCode}
										</div>
									{/if}
								</div>

								<!-- Badges -->
								<div class="flex flex-col items-end gap-1 flex-shrink-0">
									<!-- Prescription Badge -->
									<span
										class="px-2 py-0.5 text-xs font-medium rounded border {prescriptionBadge.class}"
									>
										{prescriptionBadge.text}
									</span>

									<!-- Reimbursement Badge -->
									{#if reimbursementBadge}
										<span
											class="px-2 py-0.5 text-xs font-medium rounded border {reimbursementBadge.class}"
											title={drug.reimbursable ? 'Támogatott' : 'Nem támogatott'}
										>
											{reimbursementBadge.text}
										</span>
									{/if}
								</div>
							</div>
						</li>
					{/each}
				</ul>

				<!-- Results Footer -->
				<div
					class="px-4 py-2 bg-slate-900/50 border-t border-slate-700 text-xs text-slate-500 flex justify-between"
				>
					<span>{allResults.length} találat</span>
					<span>{searchTimeMs}ms{isPuphaxLoading ? ' (PUPHAX...)' : ''}</span>
				</div>
			{/if}

			<!-- Search Online Button - only shows when NO local results -->
			{#if showPuphaxButton}
				<button
					type="button"
					class="w-full px-4 py-3 flex items-center justify-center gap-2
						bg-emerald-900/30 border-t border-emerald-500/30
						text-emerald-400 text-sm font-medium
						hover:bg-emerald-900/50 transition-colors"
					onclick={(e) => { e.stopPropagation(); e.preventDefault(); triggerPuphaxSearch(); }}
				>
					<Cloud class="h-4 w-4" />
					<span>Keresés a NEAK SOAP szolgáltatásban</span>
				</button>
			{/if}

			<!-- Loading State -->
			{#if isLoading && results.length === 0 && groupedResults.length === 0}
				<div class="px-4 py-8 text-center">
					<Loader2 class="h-6 w-6 text-blue-400 animate-spin mx-auto mb-2" />
					<span class="text-slate-400 text-sm">Keresés...</span>
				</div>
			{/if}

			<!-- PUPHAX Loading -->
			{#if isPuphaxLoading && results.length > 0}
				<div
					class="px-4 py-2 bg-emerald-900/20 border-t border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2"
				>
					<Loader2 class="h-3 w-3 animate-spin" />
					<span>PUPHAX keresés...</span>
				</div>
			{/if}

			<!-- No Results -->
			{#if !isLoading && !isPuphaxLoading && allResults.length === 0 && groupedResults.length === 0 && value.length >= 2}
				<div class="px-4 py-6 text-center">
					<AlertCircle class="h-6 w-6 text-slate-500 mx-auto mb-2" />
					<span class="text-slate-400 text-sm">Nincs találat: "{value}"</span>
					<p class="text-slate-500 text-xs mt-1">Próbáljon hatóanyagra vagy ATC kódra keresni</p>

					<!-- Search Online Button when no local results - for newest drugs not yet in CSV -->
					{#if isPuphaxOnline && !puphaxSearchTriggered && value.length >= 3}
						<button
							type="button"
							class="mt-4 px-4 py-2 flex items-center justify-center gap-2 mx-auto
								bg-emerald-500/20 border border-emerald-500/40 rounded-lg
								text-emerald-400 text-sm font-medium
								hover:bg-emerald-500/30 transition-colors"
							onclick={(e) => { e.stopPropagation(); e.preventDefault(); triggerPuphaxSearch(); }}
						>
							<Cloud class="h-4 w-4" />
							<span>Keresés a NEAK SOAP szolgáltatásban</span>
						</button>
						<p class="text-slate-600 text-xs mt-2">Legújabb gyógyszerek esetén</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Selected Drug Detail Panel -->
	{#if showDetailPanel && selectedDrug}
		<div
			class="mt-4 p-4 bg-slate-800/50 border border-slate-600 rounded-lg"
			transition:slide={{ duration: 200 }}
		>
			<div class="flex items-start justify-between">
				<div>
					<h4 class="font-medium text-white flex items-center gap-2">
						<Pill class="h-4 w-4 text-blue-400" />
						{selectedDrug.name}
						{#if selectedDrug.strength}
							<span class="text-blue-400">{selectedDrug.strength}</span>
						{/if}
					</h4>
					<p class="mt-1 text-sm text-slate-400">{selectedDrug.activeIngredient}</p>
				</div>

				{#if selectedDrug.source === 'puphax' && isPuphaxOnline}
					<button
						type="button"
						class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400
							bg-blue-500/10 border border-blue-500/30 rounded-lg
							hover:bg-blue-500/20 transition-colors"
						onclick={() => loadDrugDetails(selectedDrug!)}
						disabled={isLoadingDetails}
					>
						{#if isLoadingDetails}
							<Loader2 class="h-3 w-3 animate-spin" />
						{:else}
							<Info class="h-3 w-3" />
						{/if}
						Részletek
					</button>
				{/if}
			</div>

			<!-- Drug Details (if loaded) -->
			{#if drugDetails}
				<div class="mt-4 grid grid-cols-2 gap-4 text-sm" transition:slide={{ duration: 200 }}>
					{#if drugDetails.manufacturer}
						<div>
							<span class="text-slate-500 text-xs uppercase">Gyártó</span>
							<p class="text-white">{drugDetails.manufacturer}</p>
						</div>
					{/if}

					{#if drugDetails.productForm}
						<div>
							<span class="text-slate-500 text-xs uppercase">Forma</span>
							<p class="text-white">{drugDetails.productForm}</p>
						</div>
					{/if}

					{#if drugDetails.dddMenny && drugDetails.dddEgys}
						<div>
							<span class="text-slate-500 text-xs uppercase">Napi dózis (DDD)</span>
							<p class="text-white">{drugDetails.dddMenny} {drugDetails.dddEgys}</p>
						</div>
					{/if}

					{#if drugDetails.price}
						<div>
							<span class="text-slate-500 text-xs uppercase">Ár</span>
							<p class="text-white">{drugDetails.price.toLocaleString('hu-HU')} Ft</p>
						</div>
					{/if}

					{#if drugDetails.supportPercent}
						<div>
							<span class="text-slate-500 text-xs uppercase">Támogatás</span>
							<p class="text-emerald-400">{drugDetails.supportPercent}%</p>
						</div>
					{/if}

					{#if drugDetails.packSize}
						<div>
							<span class="text-slate-500 text-xs uppercase">Kiszerelés</span>
							<p class="text-white">{drugDetails.packSize}</p>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Paste Detection Panel -->
	{#if showPastePanel}
		<div
			class="mt-4 p-4 bg-amber-900/30 border border-amber-500/40 rounded-lg"
			transition:slide={{ duration: 200 }}
		>
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<ClipboardPaste class="h-4 w-4 text-amber-400" />
					<span class="text-sm font-medium text-amber-300">
						{pasteMatches.length > 0 ? 'Gyógyszer felismerve' : 'Nem található egyezés'}
					</span>
				</div>
				<button
					type="button"
					class="text-slate-400 hover:text-white transition-colors"
					onclick={closePastePanel}
					aria-label="Bezárás"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<p class="text-xs text-slate-400 mb-3">
				Beillesztett szöveg: <span class="text-white font-mono">"{pastedText}"</span>
				{#if extractedDosage}
					<span class="ml-2 text-blue-400">Dózis: {extractedDosage}</span>
				{/if}
				{#if extractedFrequency}
					<span class="ml-2 text-emerald-400">Adagolás: {extractedFrequency}</span>
				{/if}
			</p>

			{#if pasteMatches.length > 0}
				<div class="space-y-2 max-h-48 overflow-y-auto">
					{#each pasteMatches.slice(0, 5) as match (match.drug.id)}
						{@const confidenceColors = {
							high: 'border-emerald-500/50 bg-emerald-500/10',
							medium: 'border-amber-500/50 bg-amber-500/10',
							low: 'border-slate-500/50 bg-slate-500/10'
						}}
						<button
							type="button"
							class="w-full p-3 rounded-lg border text-left transition-all hover:scale-[1.01] {confidenceColors[match.confidence]}"
							onclick={() => selectPasteMatch(match.drug)}
						>
							<div class="flex items-start justify-between gap-2">
								<div class="flex-1 min-w-0">
									<div class="font-medium text-white truncate">{match.drug.name}</div>
									<div class="text-sm text-slate-400 mt-1">
										<span>{match.drug.activeIngredient}</span>
										{#if match.drug.dosage}
											<span class="text-blue-400 ml-2">{match.drug.dosage}</span>
										{/if}
									</div>
								</div>
								<div class="flex flex-col items-end gap-1">
									<span class="px-2 py-0.5 text-xs font-medium rounded {match.confidence === 'high' ? 'bg-emerald-500/20 text-emerald-400' : match.confidence === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-400'}">
										{match.confidence === 'high' ? 'Pontos' : match.confidence === 'medium' ? 'Valószínű' : 'Lehetséges'}
									</span>
									<span class="text-xs text-slate-500">{match.matchType}</span>
								</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Add as Custom Drug Option -->
			{#if onAddCustomDrug}
				<div class="mt-3 pt-3 border-t border-amber-500/20">
					<button
						type="button"
						class="w-full p-3 rounded-lg border border-slate-500/50 bg-slate-800/50 text-left transition-all hover:bg-slate-700/50 hover:border-slate-400/50"
						onclick={handleAddCustomDrug}
					>
						<div class="flex items-center gap-3">
							<div class="p-1.5 rounded-md bg-slate-700/50">
								<FileText class="h-4 w-4 text-slate-400" />
							</div>
							<div class="flex-1 min-w-0">
								<div class="font-medium text-slate-300 truncate">Hozzáadás egyéni gyógyszerként</div>
								<div class="text-xs text-slate-500 mt-0.5">
									"{pastedText}" {extractedDosage ? `(${extractedDosage})` : ''}
								</div>
							</div>
						</div>
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Dosage Variants Panel -->
	{#if showDosageVariantsPanel && dosageVariants.length > 1}
		<div
			class="mt-4 p-4 bg-blue-900/30 border border-blue-500/40 rounded-lg"
			transition:slide={{ duration: 200 }}
		>
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<Sparkles class="h-4 w-4 text-blue-400" />
					<span class="text-sm font-medium text-blue-300">Elérhető dózisok - {selectedBaseName}</span>
				</div>
				<button
					type="button"
					class="text-slate-400 hover:text-white transition-colors"
					onclick={closeDosagePanel}
					aria-label="Bezárás"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="flex flex-wrap gap-2">
				{#each dosageVariants as variant (variant.drug.id)}
					<button
						type="button"
						class="px-3 py-2 rounded-lg border text-sm font-medium transition-all
							{variant.isExactMatch
								? 'bg-blue-500/30 border-blue-400 text-blue-200'
								: 'bg-slate-700/50 border-slate-600 text-slate-300 hover:bg-slate-600/50 hover:border-blue-500/50'}"
						onclick={() => selectDosageVariant(variant)}
					>
						<span class="font-bold">{variant.dosage || 'N/A'}</span>
						{#if variant.form}
							<span class="text-xs text-slate-400 ml-1">({variant.form})</span>
						{/if}
					</button>
				{/each}
			</div>

			<p class="mt-3 text-xs text-slate-500">
				{dosageVariants.length} kiszerelés elérhető · Kattintson a kívánt dózisra
			</p>
		</div>
	{/if}
</div>

<!-- Keyboard Hints -->
{#if isOpen && hasResults}
	<div
		class="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-800/90 border border-slate-600 rounded-lg text-xs text-slate-400 flex gap-4 backdrop-blur-sm z-50"
		transition:fade={{ duration: 150 }}
	>
		<span><kbd class="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">↑↓</kbd> navigáció</span>
		<span><kbd class="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">Enter</kbd> kiválasztás</span
		>
		<span><kbd class="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">Esc</kbd> bezárás</span>
	</div>
{/if}
