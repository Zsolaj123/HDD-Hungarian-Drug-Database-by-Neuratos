<script lang="ts">
	/**
	 * Comprehensive Drug Browser Page
	 *
	 * Features:
	 * - Full-page drug browser with all 55 PUPHAX fields
	 * - Tabbed interface for different field categories
	 * - Advanced filtering (ATC, manufacturer, prescription type)
	 * - Galaxy UI styling with dark theme
	 */

	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		drugService,
		type Drug,
		type SimplifiedDrug,
		getRouteDisplayName
	} from '$lib/services/drug-database-service';
	import { type DrugSummaryLight } from '$lib/services/puphax-api-service';
	import {
		indicationService,
		type DrugIndicationEntry
	} from '$lib/services/indication-service';
	import { openFdaService, type OpenFdaSearchResult, type OpenFdaMultiIngredientResult } from '$lib/services/openfda-service';
	import { ingredientTranslationService } from '$lib/services/ingredient-translation-service';
	import { emaService, type EmaMatchResult, type EmaShortage, type EmaDhpc, type EmaMultiIngredientResult } from '$lib/services/ema-service';
	import { ingredientParserService } from '$lib/services/ingredient-parser-service';
	import { specialtyService } from '$lib/services/specialty-service';
	import { getManualPairing, saveManualPairing, type ManualPairing } from '$lib/utils/manual-pairing-store';
	import { formatBoxedWarning } from '$lib/utils/fda-text-formatter';
	import DrugAutocomplete from '$lib/components/ui/DrugAutocomplete.svelte';
	import DrugInfoModal from '$lib/components/ui/DrugInfoModal.svelte';
	import FdaContentDisplay from '$lib/components/ui/FdaContentDisplay.svelte';
	import IndicationSkeleton from '$lib/components/ui/IndicationSkeleton.svelte';
	import {
		Search,
		Pill,
		FlaskConical,
		Package,
		FileText,
		Calendar,
		Building2,
		Tag,
		ArrowLeft,
		CheckCircle2,
		XCircle,
		Info,
		Filter,
		X,
		Stethoscope,
		AlertCircle,
		ExternalLink,
		ShieldAlert,
		Loader2,
		AlertTriangle,
		Ban,
		Home,
		Hospital,
		Clock,
		UserCheck,
		Brain,
		Heart,
		Shield,
		Globe,
		ChevronDown,
		ChevronUp,
		ChevronRight
	} from 'lucide-svelte';
	import { fade, slide } from 'svelte/transition';

	// ============================================================================
	// State
	// ============================================================================

	let selectedDrug = $state<Drug | null>(null);
	let activeTab = $state<'basic' | 'indications' | 'fda' | 'ema'>('basic');
	let tabsScrolled = $state(false);

	// Collapsible sections in Alapadatok
	let showDosageSection = $state(true);
	let showPackagingSection = $state(true);
	let showRegulatorySection = $state(true);
	let isLoading = $state(false);
	let showFilters = $state(false);

	// Info modal state
	let modalDrug = $state<Drug | SimplifiedDrug | null>(null);
	let showInfoModal = $state(false);

	// Indications state
	let drugIndications = $state<DrugIndicationEntry | null>(null);
	let indicationsLoading = $state(false);

	// FDA clinical data state
	let fdaData = $state<OpenFdaSearchResult | null>(null);
	let fdaLoading = $state(false);
	// Multi-ingredient FDA state
	let fdaMultiData = $state<OpenFdaMultiIngredientResult | null>(null);
	let isMultiIngredientDrug = $state(false);
	let activeFdaIngredientTab = $state(0);

	// EMA state - real EMA data integration
	let emaData = $state<EmaMatchResult | null>(null);
	let emaLoading = $state(false);
	let emaDataTimestamp = $state<string>('');
	// Keep for backwards compatibility with external links
	let emaEnglishIngredient = $state<string>('');
	// Multi-ingredient EMA state
	let emaMultiData = $state<EmaMultiIngredientResult | null>(null);
	let activeEmaIngredientTab = $state(0);

	// Manual search state (when auto-lookup fails)
	let manualFdaSearch = $state('');
	let manualFdaLoading = $state(false);
	let manualFdaResults = $state<OpenFdaSearchResult | null>(null);
	let fdaMatchedByPairing = $state(false);

	let manualEmaSearch = $state('');
	let manualEmaLoading = $state(false);
	let manualEmaResults = $state<EmaMatchResult | null>(null);
	let emaMatchedByPairing = $state(false);

	// EMA autocomplete suggestions
	let emaSuggestions = $state<Array<{inn: string, name: string, status: string}>>([]);
	let showEmaSuggestions = $state(false);

	// FDA autocomplete suggestions (from ingredient translations)
	let fdaSuggestions = $state<string[]>([]);
	let showFdaSuggestions = $state(false);

	// Pairing save state (must be manually saved, not auto)
	let fdaPairingPending = $state(false);
	let emaPairingPending = $state(false);

	// Per-ingredient manual search state (for multi-ingredient drugs)
	let perIngredientFdaSearch = $state<Map<number, string>>(new Map());
	let perIngredientFdaLoading = $state<Map<number, boolean>>(new Map());
	let perIngredientFdaResults = $state<Map<number, OpenFdaSearchResult | null>>(new Map());
	let perIngredientFdaSuggestions = $state<Map<number, string[]>>(new Map());
	let showPerIngredientFdaSuggestions = $state<Map<number, boolean>>(new Map());

	let perIngredientEmaSearch = $state<Map<number, string>>(new Map());
	let perIngredientEmaLoading = $state<Map<number, boolean>>(new Map());
	let perIngredientEmaResults = $state<Map<number, EmaMatchResult | null>>(new Map());
	let perIngredientEmaSuggestions = $state<Map<number, Array<{inn: string, name: string, status: string}>>>(new Map());
	let showPerIngredientEmaSuggestions = $state<Map<number, boolean>>(new Map());

	// Filters
	let filterAtc = $state('');
	let filterPrescription = $state<'all' | 'rx' | 'otc'>('all');
	let filterMarket = $state<'all' | 'in' | 'out'>('all');

	// ============================================================================
	// Load drug from URL parameter
	// ============================================================================

	onMount(async () => {
		// Initialize specialty service for eligibility display
		specialtyService.initialize();

		const drugId = $page.url.searchParams.get('id');
		if (drugId) {
			isLoading = true;
			try {
				const drug = await drugService.getFullDrugDetails(drugId);
				if (drug) {
					selectedDrug = drug;
					// Preload indications immediately (parallel with other loads)
					loadDrugIndications(drugId);
				}
			} catch (error) {
				console.error('Failed to load drug:', error);
			}
			isLoading = false;
		}
	});

	// ============================================================================
	// Handlers
	// ============================================================================

	async function loadDrugIndications(drugId: string) {
		indicationsLoading = true;
		try {
			drugIndications = await indicationService.getIndicationsForDrug(drugId);
		} catch (error) {
			console.error('Failed to load drug indications:', error);
			drugIndications = null;
		}
		indicationsLoading = false;
	}

	async function loadFdaData(brandName: string, genericName?: string, atcCode?: string, drugId?: string) {
		fdaLoading = true;
		fdaData = null;
		fdaMultiData = null;
		activeFdaIngredientTab = 0;
		fdaMatchedByPairing = false;

		try {
			// 1. First check for saved manual pairing
			if (drugId) {
				const savedPairing = getManualPairing('fda', drugId);
				if (savedPairing) {
					console.log(`[FDA] Using saved pairing for "${savedPairing.drugName}": ${savedPairing.searchTerm}`);
					const pairingResult = await openFdaService.searchByGenericName(savedPairing.searchTerm);
					if (pairingResult?.found) {
						fdaData = pairingResult;
						fdaMatchedByPairing = true;
						fdaLoading = false;
						return;
					}
				}
			}

			// 2. Extract brand name from full drug name (e.g., "TECFIDERA 120 MG..." -> "TECFIDERA")
			const cleanBrand = brandName.split(/\s+\d/)[0].trim();

			// 3. Check if multi-ingredient drug
			if (genericName && isMultiIngredientDrug) {
				// Use multi-ingredient lookup for combination drugs
				fdaMultiData = await openFdaService.getMultiIngredientLabels(cleanBrand, genericName, atcCode);
				// Also set single fdaData if combination match found
				if (fdaMultiData?.combinationMatch?.found) {
					fdaData = fdaMultiData.combinationMatch;
				}
			} else {
				// Use translation-aware method for single ingredient drugs
				fdaData = await openFdaService.getDrugLabelWithTranslation(cleanBrand, genericName, atcCode);
			}
		} catch (error) {
			console.error('Failed to load FDA data:', error);
			fdaData = null;
			fdaMultiData = null;
		}
		fdaLoading = false;
	}

	async function loadEmaData(drug: { activeIngredient?: string; atcCode?: string; name?: string }, drugId?: string) {
		emaLoading = true;
		emaData = null;
		emaMultiData = null;
		activeEmaIngredientTab = 0;
		emaMatchedByPairing = false;

		try {
			await emaService.initialize();

			// 1. First check for saved manual pairing
			if (drugId) {
				const savedPairing = getManualPairing('ema', drugId);
				if (savedPairing) {
					console.log(`[EMA] Using saved pairing for "${savedPairing.drugName}": ${savedPairing.searchTerm}`);
					const pairingResult = await emaService.searchDirectByInn(savedPairing.searchTerm);
					if (pairingResult?.matched) {
						emaData = pairingResult;
						emaMatchedByPairing = true;
						emaDataTimestamp = emaService.getDataTimestamp();
						emaLoading = false;
						return;
					}
				}
			}

			// 2. Check if multi-ingredient drug
			if (drug.activeIngredient && isMultiIngredientDrug) {
				// Use multi-ingredient lookup for combination drugs
				emaMultiData = await emaService.findMultiIngredientData({
					activeIngredient: drug.activeIngredient,
					atcCode: drug.atcCode,
					name: drug.name
				});
				// Also set single emaData if combination match found
				if (emaMultiData?.combinationMatch) {
					emaData = {
						matched: true,
						method: 'atc',
						medicine: emaMultiData.combinationMatch,
						shortages: emaMultiData.aggregatedShortages,
						dhpcs: emaMultiData.aggregatedDhpcs,
						searchTerm: drug.atcCode
					};
				}
			} else {
				// Use standard single-ingredient lookup
				emaData = await emaService.findEmaData({
					activeIngredient: drug.activeIngredient,
					atcCode: drug.atcCode,
					name: drug.name
				});
			}
			emaDataTimestamp = emaService.getDataTimestamp();
		} catch (error) {
			console.error('Failed to load EMA data:', error);
			emaData = null;
			emaMultiData = null;
		}
		emaLoading = false;
	}

	/**
	 * Manual FDA search when auto-lookup fails
	 * Allows user to search with English drug names directly
	 */
	async function handleManualFdaSearch() {
		if (!manualFdaSearch.trim() || !selectedDrug) return;

		manualFdaLoading = true;
		manualFdaResults = null;

		try {
			// Try generic_name search first (most reliable for FDA)
			const result = await openFdaService.searchByGenericName(manualFdaSearch.trim().toUpperCase());

			if (result?.found) {
				manualFdaResults = result;
				fdaPairingPending = true; // Mark as pending - user must click save
			} else {
				manualFdaResults = { found: false, label: null, error: null, searchedBy: 'generic_name' };
				fdaPairingPending = false;
			}
		} catch (error) {
			console.error('Manual FDA search failed:', error);
			manualFdaResults = { found: false, label: null, error: String(error), searchedBy: 'generic_name' };
			fdaPairingPending = false;
		}

		manualFdaLoading = false;
	}

	/**
	 * Save FDA pairing manually (user must click button)
	 */
	function saveFdaPairing() {
		if (!selectedDrug || !manualFdaResults?.found) return;

		saveManualPairing('fda', {
			drugId: selectedDrug.id,
			drugName: selectedDrug.name,
			searchTerm: manualFdaSearch.trim(),
			foundBrandName: manualFdaResults.label?.brandName || undefined,
			timestamp: Date.now()
		});

		fdaPairingPending = false;
		fdaMatchedByPairing = true;
	}

	/**
	 * Manual EMA search when auto-lookup fails
	 * Uses direct INN search - user enters English terms directly
	 */
	async function handleManualEmaSearch() {
		if (!manualEmaSearch.trim() || !selectedDrug) return;

		manualEmaLoading = true;
		manualEmaResults = null;
		showEmaSuggestions = false;

		try {
			await emaService.initialize();

			// Use direct INN search (no translation - user enters English)
			const result = await emaService.searchDirectByInn(manualEmaSearch.trim());

			if (result?.matched) {
				manualEmaResults = result;
				emaPairingPending = true; // Mark as pending - user must click save
			} else {
				manualEmaResults = null;
				emaPairingPending = false;
			}
		} catch (error) {
			console.error('Manual EMA search failed:', error);
			manualEmaResults = null;
			emaPairingPending = false;
		}

		manualEmaLoading = false;
	}

	/**
	 * Save EMA pairing manually (user must click button)
	 */
	function saveEmaPairing() {
		if (!selectedDrug || !manualEmaResults?.matched) return;

		saveManualPairing('ema', {
			drugId: selectedDrug.id,
			drugName: selectedDrug.name,
			searchTerm: manualEmaSearch.trim(),
			foundBrandName: manualEmaResults.medicine?.name || undefined,
			timestamp: Date.now()
		});

		emaPairingPending = false;
		emaMatchedByPairing = true;
	}

	/**
	 * Update EMA autocomplete suggestions as user types
	 */
	async function updateEmaSuggestions(query: string) {
		if (query.length < 2) {
			emaSuggestions = [];
			showEmaSuggestions = false;
			return;
		}

		await emaService.initialize();
		const medicines = emaService.getMedicines();
		const queryLower = query.toLowerCase();

		// Search INN and medicine names for matches
		const matches = medicines
			.filter(m => {
				const inn = m.inn?.toLowerCase() || '';
				const name = m.name?.toLowerCase() || '';
				return inn.includes(queryLower) || name.includes(queryLower);
			})
			.filter(m => m.status === 'Authorised') // Only authorised medicines
			.slice(0, 10) // Limit to 10 suggestions
			.map(m => ({
				inn: m.inn || '',
				name: m.name || '',
				status: m.status || ''
			}));

		emaSuggestions = matches;
		showEmaSuggestions = matches.length > 0;
	}

	/**
	 * Select an EMA suggestion from autocomplete
	 */
	function selectEmaSuggestion(suggestion: {inn: string, name: string}) {
		manualEmaSearch = suggestion.inn.split(';')[0].trim(); // Use first INN component
		showEmaSuggestions = false;
		handleManualEmaSearch();
	}

	/**
	 * Update FDA autocomplete suggestions from ingredient translations
	 */
	async function updateFdaSuggestions(query: string) {
		if (query.length < 2) {
			fdaSuggestions = [];
			showFdaSuggestions = false;
			return;
		}

		// Get all English translations and match against query
		const queryLower = query.toLowerCase();
		const allTranslations = await ingredientTranslationService.getAllTranslations();

		// Collect unique English terms that match
		const matchingTerms = new Set<string>();

		// Prioritize terms starting with query
		for (const [hungarian, englishArray] of allTranslations) {
			for (const english of englishArray) {
				if (english.toLowerCase().startsWith(queryLower)) {
					matchingTerms.add(english);
				}
			}
		}

		// Then add terms containing query
		for (const [hungarian, englishArray] of allTranslations) {
			for (const english of englishArray) {
				if (english.toLowerCase().includes(queryLower)) {
					matchingTerms.add(english);
				}
			}
		}

		const suggestions = [...matchingTerms].slice(0, 10);
		fdaSuggestions = suggestions;
		showFdaSuggestions = suggestions.length > 0;
	}

	/**
	 * Select an FDA suggestion from autocomplete
	 */
	function selectFdaSuggestion(suggestion: string) {
		manualFdaSearch = suggestion;
		showFdaSuggestions = false;
		handleManualFdaSearch();
	}

	// ============================================================================
	// Per-Ingredient Manual Search Functions (for multi-ingredient drugs)
	// ============================================================================

	/**
	 * Update FDA autocomplete suggestions for a specific ingredient index
	 */
	async function updatePerIngredientFdaSuggestions(idx: number, query: string) {
		if (query.length < 2) {
			perIngredientFdaSuggestions = new Map(perIngredientFdaSuggestions.set(idx, []));
			showPerIngredientFdaSuggestions = new Map(showPerIngredientFdaSuggestions.set(idx, false));
			return;
		}

		const queryLower = query.toLowerCase();
		const allTranslations = await ingredientTranslationService.getAllTranslations();
		const matchingTerms = new Set<string>();

		// Prioritize terms starting with query
		for (const [hungarian, englishArray] of allTranslations) {
			for (const english of englishArray) {
				if (english.toLowerCase().startsWith(queryLower)) {
					matchingTerms.add(english);
				}
			}
		}

		// Then add terms containing query
		for (const [hungarian, englishArray] of allTranslations) {
			for (const english of englishArray) {
				if (english.toLowerCase().includes(queryLower)) {
					matchingTerms.add(english);
				}
			}
		}

		const suggestions = [...matchingTerms].slice(0, 10);
		perIngredientFdaSuggestions = new Map(perIngredientFdaSuggestions.set(idx, suggestions));
		showPerIngredientFdaSuggestions = new Map(showPerIngredientFdaSuggestions.set(idx, suggestions.length > 0));
	}

	/**
	 * Handle manual FDA search for a specific ingredient index
	 */
	async function handlePerIngredientFdaSearch(idx: number) {
		const searchTerm = perIngredientFdaSearch.get(idx)?.trim();
		if (!searchTerm || !selectedDrug) return;

		perIngredientFdaLoading = new Map(perIngredientFdaLoading.set(idx, true));
		perIngredientFdaResults = new Map(perIngredientFdaResults.set(idx, null));

		try {
			const result = await openFdaService.searchByGenericName(searchTerm.toUpperCase());
			perIngredientFdaResults = new Map(perIngredientFdaResults.set(idx, result?.found ? result : { found: false, label: null, error: null, searchedBy: 'generic_name' }));
		} catch (error) {
			console.error('[FDA Per-Ingredient] Search error:', error);
			perIngredientFdaResults = new Map(perIngredientFdaResults.set(idx, { found: false, label: null, error: String(error), searchedBy: 'generic_name' }));
		}

		perIngredientFdaLoading = new Map(perIngredientFdaLoading.set(idx, false));
	}

	/**
	 * Select FDA suggestion for a specific ingredient
	 */
	function selectPerIngredientFdaSuggestion(idx: number, suggestion: string) {
		perIngredientFdaSearch = new Map(perIngredientFdaSearch.set(idx, suggestion));
		showPerIngredientFdaSuggestions = new Map(showPerIngredientFdaSuggestions.set(idx, false));
		handlePerIngredientFdaSearch(idx);
	}

	/**
	 * Update EMA autocomplete suggestions for a specific ingredient index
	 */
	function updatePerIngredientEmaSuggestions(idx: number, query: string) {
		if (query.length < 2) {
			perIngredientEmaSuggestions = new Map(perIngredientEmaSuggestions.set(idx, []));
			showPerIngredientEmaSuggestions = new Map(showPerIngredientEmaSuggestions.set(idx, false));
			return;
		}

		const queryLower = query.toLowerCase();
		const medicines = emaService.getMedicines();

		const matches = medicines
			.filter(m => {
				const nameMatch = m.name?.toLowerCase().includes(queryLower);
				const innMatch = m.inn?.toLowerCase().includes(queryLower);
				const substanceMatch = m.activeSubstance?.toLowerCase().includes(queryLower);
				return nameMatch || innMatch || substanceMatch;
			})
			.filter(m => m.status === 'Authorised')
			.slice(0, 10)
			.map(m => ({
				inn: m.inn || '',
				name: m.name || '',
				status: m.status || ''
			}));

		perIngredientEmaSuggestions = new Map(perIngredientEmaSuggestions.set(idx, matches));
		showPerIngredientEmaSuggestions = new Map(showPerIngredientEmaSuggestions.set(idx, matches.length > 0));
	}

	/**
	 * Handle manual EMA search for a specific ingredient index
	 */
	async function handlePerIngredientEmaSearch(idx: number) {
		const searchTerm = perIngredientEmaSearch.get(idx)?.trim();
		if (!searchTerm || !selectedDrug) return;

		perIngredientEmaLoading = new Map(perIngredientEmaLoading.set(idx, true));
		perIngredientEmaResults = new Map(perIngredientEmaResults.set(idx, null));

		try {
			const result = await emaService.searchDirectByInn(searchTerm);
			perIngredientEmaResults = new Map(perIngredientEmaResults.set(idx, result?.matched ? result : null));
		} catch (error) {
			console.error('[EMA Per-Ingredient] Search error:', error);
			perIngredientEmaResults = new Map(perIngredientEmaResults.set(idx, null));
		}

		perIngredientEmaLoading = new Map(perIngredientEmaLoading.set(idx, false));
	}

	/**
	 * Select EMA suggestion for a specific ingredient
	 */
	function selectPerIngredientEmaSuggestion(idx: number, suggestion: {inn: string, name: string}) {
		perIngredientEmaSearch = new Map(perIngredientEmaSearch.set(idx, suggestion.inn.split(';')[0].trim()));
		showPerIngredientEmaSuggestions = new Map(showPerIngredientEmaSuggestions.set(idx, false));
		handlePerIngredientEmaSearch(idx);
	}

	/**
	 * Reset manual search state when drug changes
	 */
	function resetManualSearchState() {
		manualFdaSearch = '';
		manualFdaResults = null;
		manualFdaLoading = false;
		fdaMatchedByPairing = false;
		fdaPairingPending = false;
		fdaSuggestions = [];
		showFdaSuggestions = false;

		manualEmaSearch = '';
		manualEmaResults = null;
		manualEmaLoading = false;
		emaMatchedByPairing = false;
		emaPairingPending = false;
		emaSuggestions = [];
		showEmaSuggestions = false;

		// Reset per-ingredient search state
		perIngredientFdaSearch = new Map();
		perIngredientFdaLoading = new Map();
		perIngredientFdaResults = new Map();
		perIngredientFdaSuggestions = new Map();
		showPerIngredientFdaSuggestions = new Map();

		perIngredientEmaSearch = new Map();
		perIngredientEmaLoading = new Map();
		perIngredientEmaResults = new Map();
		perIngredientEmaSuggestions = new Map();
		showPerIngredientEmaSuggestions = new Map();
	}

	async function handleDrugSelect(drug: Drug | SimplifiedDrug | DrugSummaryLight) {
		// Fetch full drug details from the database
		isLoading = true;
		drugIndications = null; // Reset indications
		fdaData = null; // Reset FDA data
		fdaMultiData = null; // Reset multi-ingredient FDA data
		emaData = null; // Reset EMA data
		emaMultiData = null; // Reset multi-ingredient EMA data
		emaEnglishIngredient = ''; // Reset EMA ingredient
		isMultiIngredientDrug = false; // Reset multi-ingredient flag
		activeFdaIngredientTab = 0;
		activeEmaIngredientTab = 0;
		resetManualSearchState(); // Reset manual search state
		try {
			const fullDrug = await drugService.getFullDrugDetails(drug.id);
			if (fullDrug) {
				selectedDrug = fullDrug;

				// Detect multi-ingredient drugs using parser
				if (fullDrug.activeIngredient) {
					const parsed = ingredientParserService.parse(fullDrug.activeIngredient);
					isMultiIngredientDrug = parsed.isMultiIngredient;
					console.log(`[Drug] ${fullDrug.name}: ${parsed.isMultiIngredient ? 'Multi-ingredient' : 'Single ingredient'}`, parsed.ingredients);
				}

				// Update URL without navigation
				const url = new URL(window.location.href);
				url.searchParams.set('id', fullDrug.id);
				window.history.pushState({}, '', url.toString());
				// Load indications in background
				loadDrugIndications(fullDrug.id);
				// Load EMA data in background (pass drugId for saved pairing lookup)
				loadEmaData({
					activeIngredient: fullDrug.activeIngredient,
					atcCode: fullDrug.atcCode,
					name: fullDrug.name
				}, fullDrug.id);
				// Translate ingredient for EMA links
				if (fullDrug.activeIngredient) {
					const englishVariants = await ingredientTranslationService.toEnglish(fullDrug.activeIngredient);
					emaEnglishIngredient = englishVariants[0] || fullDrug.activeIngredient;
				}
			} else {
				// Fallback: use the basic drug info from autocomplete
				selectedDrug = drug as Drug;
				loadDrugIndications(drug.id);
			}
		} catch (error) {
			console.error('Failed to load full drug details:', error);
			selectedDrug = drug as Drug;
			loadDrugIndications(drug.id);
		}
		isLoading = false;
	}

	function handleBack() {
		goto('/');
	}

	function clearSelection() {
		selectedDrug = null;
		const url = new URL(window.location.href);
		url.searchParams.delete('id');
		window.history.pushState({}, '', url.toString());
	}

	function handleInfoClick(drug: Drug | SimplifiedDrug | DrugSummaryLight) {
		modalDrug = drug as Drug | SimplifiedDrug;
		showInfoModal = true;
	}

	function closeInfoModal() {
		showInfoModal = false;
		modalDrug = null;
	}

	// ============================================================================
	// Helpers
	// ============================================================================

	function getPrescriptionLabel(required: boolean): string {
		return required ? 'Vényköteles (Rx)' : 'Szabadon kapható (OTC)';
	}

	function getMarketLabel(inMarket: boolean | undefined): string {
		if (inMarket === undefined) return 'Ismeretlen';
		return inMarket ? 'Forgalomban' : 'Forgalomból kivont';
	}

	function formatDDD(ddd: { amount: string | null; unit: string | null; factor: string | null } | null | undefined): string {
		if (!ddd || !ddd.amount || !ddd.unit) return '-';
		let result = `${ddd.amount} ${ddd.unit}`;
		if (ddd.factor && ddd.factor !== '1') {
			result += ` (faktor: ${ddd.factor})`;
		}
		return result;
	}

	function getRouteLabel(route: string | undefined): string {
		if (!route) return '-';
		const routeLabels: Record<string, string> = {
			oral: 'Szájon át (per os)',
			iv: 'Intravénás (IV)',
			im: 'Intramuscularis (IM)',
			sc: 'Subcutan (SC)',
			topical: 'Külsőleg',
			inhaled: 'Inhalációs',
			rectal: 'Végbélbe',
			ophthalmic: 'Szemészeti',
			nasal: 'Nazális',
			sublingual: 'Nyelv alá',
			transdermal: 'Transzdermális',
			buccal: 'Bukkális'
		};
		return routeLabels[route] || route;
	}
</script>

<svelte:head>
	<title>{selectedDrug ? selectedDrug.name : 'Gyógyszer Adatbázis'} | HDD</title>
</svelte:head>

<div class="min-h-screen bg-slate-950 flex flex-col">
	<!-- Header -->
	<header class="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800">
		<div class="max-w-7xl mx-auto px-4 py-4">
			<div class="flex items-center gap-4">
				<button
					type="button"
					class="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
					onclick={handleBack}
					aria-label="Vissza"
				>
					<ArrowLeft class="h-5 w-5" />
				</button>

				<div class="flex-1">
					<h1 class="text-xl font-semibold text-white">Gyógyszer Adatbázis</h1>
					<p class="text-sm text-slate-400">NEAK - Teljes magyar gyógyszeradatbázis</p>
				</div>

				<button
					type="button"
					class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
					onclick={() => showFilters = !showFilters}
				>
					<Filter class="h-4 w-4" />
					<span class="text-sm">Szűrők</span>
				</button>
			</div>

			<!-- Search -->
			<div class="mt-4">
				<DrugAutocomplete
					placeholder="Keresés gyógyszer neve, hatóanyag vagy ATC kód alapján..."
					maxResults={30}
					groupedMode={true}
					onSelect={handleDrugSelect}
					onInfoClick={handleInfoClick}
				/>
			</div>

			<!-- Filters Panel -->
			{#if showFilters}
				<div class="mt-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700" transition:slide={{ duration: 200 }}>
					<div class="flex flex-wrap gap-4">
						<div class="flex-1 min-w-[200px]">
							<label class="block text-xs text-slate-400 mb-1">ATC kód prefix</label>
							<input
								type="text"
								bind:value={filterAtc}
								placeholder="pl. N02BA"
								class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
							/>
						</div>
						<div>
							<label class="block text-xs text-slate-400 mb-1">Vénykötelesség</label>
							<select
								bind:value={filterPrescription}
								class="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
							>
								<option value="all">Mind</option>
								<option value="rx">Vényköteles (Rx)</option>
								<option value="otc">Szabadon kapható</option>
							</select>
						</div>
						<div>
							<label class="block text-xs text-slate-400 mb-1">Forgalmazási státusz</label>
							<select
								bind:value={filterMarket}
								class="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
							>
								<option value="all">Mind</option>
								<option value="in">Forgalomban</option>
								<option value="out">Kivont</option>
							</select>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</header>

	<!-- Main Content -->
	<main class="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
		{#if isLoading}
			<div class="flex items-center justify-center py-20">
				<div class="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent"></div>
			</div>
		{:else if selectedDrug}
			<!-- Drug Details View -->
			<div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden" transition:fade={{ duration: 200 }}>
				<!-- Drug Header -->
				<div class="px-6 py-5 border-b border-slate-800 bg-slate-800/30">
					<div class="flex items-start justify-between gap-4">
						<div class="flex-1 min-w-0">
							<h2 class="text-2xl font-bold text-white">{selectedDrug.name}</h2>
							{#if selectedDrug.activeIngredient}
								<p class="text-lg text-blue-400 font-medium mt-1">{selectedDrug.activeIngredient}</p>
							{/if}
							{#if selectedDrug.brandName && selectedDrug.brandName !== selectedDrug.name && selectedDrug.brandName !== selectedDrug.activeIngredient}
								<p class="text-slate-400 text-sm mt-1">{selectedDrug.brandName}</p>
							{/if}

							<!-- Status Badges -->
							<div class="flex flex-wrap gap-2 mt-3">
								<span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border {selectedDrug.prescriptionRequired ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}">
									{getPrescriptionLabel(selectedDrug.prescriptionRequired)}
								</span>
								<span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border {selectedDrug.inMarket ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'}">
									{#if selectedDrug.inMarket}
										<CheckCircle2 class="h-3 w-3" />
									{:else}
										<XCircle class="h-3 w-3" />
									{/if}
									{getMarketLabel(selectedDrug.inMarket)}
								</span>
							</div>
						</div>
						<button
							type="button"
							class="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
							onclick={clearSelection}
							aria-label="Bezárás"
						>
							<X class="h-5 w-5" />
						</button>
					</div>
				</div>

				<!-- Tabs - Mobile optimized with scroll indicator -->
				<div class="border-b border-slate-800 relative overflow-hidden">
					<nav
						class="tabs-scroll-container scrollbar-hide"
						onscroll={() => tabsScrolled = true}
					>
						<button
							type="button"
							class="flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'basic'
									? 'text-blue-400 border-blue-500 bg-blue-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => activeTab = 'basic'}
						>
							<Info class="h-4 w-4" />
							<span class="hidden sm:inline">Alapadatok</span>
							<span class="sm:hidden">Alap</span>
						</button>
						<button
							type="button"
							class="flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'indications'
									? 'text-emerald-400 border-emerald-500 bg-emerald-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => activeTab = 'indications'}
						>
							<Stethoscope class="h-4 w-4" />
							<span class="hidden sm:inline">Indikációk</span>
							<span class="sm:hidden">BNO</span>
							{#if drugIndications?.bnoCodes && drugIndications.bnoCodes.length > 0}
								<span class="px-1.5 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded">
									{drugIndications.bnoCodes.length}
								</span>
							{/if}
						</button>
						<button
							type="button"
							class="flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'fda'
									? 'text-red-400 border-red-500 bg-red-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => {
								activeTab = 'fda';
								if (selectedDrug && !fdaData && !fdaLoading) {
									loadFdaData(selectedDrug.name, selectedDrug.activeIngredient, selectedDrug.atcCode, selectedDrug.id);
								}
							}}
						>
							<ShieldAlert class="h-4 w-4" />
							<span class="hidden sm:inline">FDA Klinikai</span>
							<span class="sm:hidden">FDA</span>
							{#if fdaData?.found}
								<span class="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
									✓
								</span>
							{/if}
						</button>
						<button
							type="button"
							class="flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'ema'
									? 'text-blue-400 border-blue-500 bg-blue-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => activeTab = 'ema'}
						>
							<Globe class="h-4 w-4" />
							<span class="hidden sm:inline">EMA (EU)</span>
							<span class="sm:hidden">EMA</span>
						</button>
						<a
							href="https://www.pharmindex-online.hu/kereses?q={encodeURIComponent(selectedDrug?.name || '')}"
							target="_blank"
							rel="noopener noreferrer"
							class="flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								text-slate-400 border-transparent hover:text-emerald-400 hover:bg-emerald-500/5"
						>
							<ExternalLink class="h-4 w-4" />
							<span class="hidden sm:inline">Pharmindex</span>
							<span class="sm:hidden">PhIdx</span>
						</a>
					</nav>
					<!-- Scroll indicator for mobile -->
					{#if !tabsScrolled}
						<div class="sm:hidden absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
							<div class="bg-gradient-to-l from-slate-900 via-slate-900/90 to-transparent pl-6 pr-2 h-full flex items-center">
								<div class="flex items-center gap-0.5 text-emerald-400 animate-pulse">
									<ChevronRight class="h-4 w-4" />
									<span class="text-xs font-medium">+1</span>
								</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- Tab Content -->
				<div class="p-4 sm:p-6 relative overflow-hidden min-h-[200px]">
					{#key activeTab}
						<div in:fade={{ duration: 200, delay: 80 }} out:fade={{ duration: 80 }}>
					{#if activeTab === 'basic'}
						<div class="space-y-4">
							<!-- Basic Info Grid - Always visible -->
							<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
								<!-- Hatóanyag -->
								<div class="col-span-2 sm:col-span-1">
									<div class="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
										<FlaskConical class="h-3 w-3" />
										<span>Hatóanyag</span>
									</div>
									<p class="text-sm sm:text-base text-blue-400 font-semibold">{selectedDrug.activeIngredient || '-'}</p>
								</div>
								<!-- ATC kód -->
								<div>
									<div class="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
										<Tag class="h-3 w-3" />
										<span>ATC</span>
									</div>
									<p class="text-sm sm:text-base text-white font-mono">{selectedDrug.atcCode || '-'}</p>
								</div>
								<!-- Gyártó -->
								<div>
									<div class="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
										<Building2 class="h-3 w-3" />
										<span>Gyártó</span>
									</div>
									<p class="text-sm sm:text-base text-white truncate">{selectedDrug.manufacturer || '-'}</p>
								</div>
								<!-- Beviteli mód -->
								<div>
									<div class="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
										<Info class="h-3 w-3" />
										<span>Bevitel</span>
									</div>
									<p class="text-sm sm:text-base text-white">{getRouteLabel(selectedDrug.route)}</p>
								</div>
								<!-- Gyógyszerforma -->
								<div>
									<div class="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
										<Package class="h-3 w-3" />
										<span>Forma</span>
									</div>
									<p class="text-sm sm:text-base text-white">{selectedDrug.form || '-'}</p>
								</div>
								<!-- Dózis - moved from Adagolás -->
								<div>
									<div class="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
										<Pill class="h-3 w-3" />
										<span>Dózis</span>
									</div>
									<p class="text-sm sm:text-base text-blue-400 font-semibold">{selectedDrug.dosage || '-'}</p>
								</div>
							</div>

							<!-- Collapsible: Adagolás & DDD -->
							<div class="border border-slate-800 rounded-lg overflow-hidden">
								<button
									type="button"
									class="w-full flex items-center justify-between p-3 bg-slate-800/30 hover:bg-slate-800/50 transition-colors"
									onclick={() => showDosageSection = !showDosageSection}
								>
									<span class="flex items-center gap-2 text-sm font-medium text-slate-300">
										<Pill class="h-4 w-4 text-blue-400" />
										Adagolás részletek
									</span>
									{#if showDosageSection}
										<ChevronUp class="h-4 w-4 text-slate-400" />
									{:else}
										<ChevronDown class="h-4 w-4 text-slate-400" />
									{/if}
								</button>
								{#if showDosageSection}
									<div class="p-3 grid grid-cols-2 gap-3 border-t border-slate-800" transition:slide={{ duration: 150 }}>
										<div>
											<div class="text-xs text-slate-500 mb-0.5">DDD (Napi dózis)</div>
											<p class="text-sm text-white">{formatDDD(selectedDrug.ddd)}</p>
										</div>
										{#if selectedDrug.baseName}
											<div>
												<div class="text-xs text-slate-500 mb-0.5">Alap név</div>
												<p class="text-sm text-white">{selectedDrug.baseName}</p>
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Collapsible: Kiszerelés -->
							<div class="border border-slate-800 rounded-lg overflow-hidden">
								<button
									type="button"
									class="w-full flex items-center justify-between p-3 bg-slate-800/30 hover:bg-slate-800/50 transition-colors"
									onclick={() => showPackagingSection = !showPackagingSection}
								>
									<span class="flex items-center gap-2 text-sm font-medium text-slate-300">
										<Package class="h-4 w-4 text-emerald-400" />
										Kiszerelés
										{#if selectedDrug.packSizes && selectedDrug.packSizes.length > 0}
											<span class="text-xs text-slate-500">({selectedDrug.packSizes.length})</span>
										{/if}
									</span>
									{#if showPackagingSection}
										<ChevronUp class="h-4 w-4 text-slate-400" />
									{:else}
										<ChevronDown class="h-4 w-4 text-slate-400" />
									{/if}
								</button>
								{#if showPackagingSection}
									<div class="p-3 space-y-3 border-t border-slate-800" transition:slide={{ duration: 150 }}>
										{#if selectedDrug.packSizes && selectedDrug.packSizes.length > 0}
											<div class="flex flex-wrap gap-1.5">
												{#each selectedDrug.packSizes as packSize}
													<span class="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300">
														{packSize}
													</span>
												{/each}
											</div>
										{:else if selectedDrug.packSize}
											<p class="text-sm text-white">{selectedDrug.packSize}</p>
										{/if}
										{#if selectedDrug.eanCode || selectedDrug.productCode}
											<div class="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/50">
												{#if selectedDrug.eanCode}
													<div>
														<div class="text-xs text-slate-500 mb-0.5">EAN</div>
														<p class="text-xs text-white font-mono">{selectedDrug.eanCode}</p>
													</div>
												{/if}
												{#if selectedDrug.productCode}
													<div>
														<div class="text-xs text-slate-500 mb-0.5">Termékkód</div>
														<p class="text-xs text-white font-mono">{selectedDrug.productCode}</p>
													</div>
												{/if}
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Collapsible: Szabályozás -->
							<div class="border border-slate-800 rounded-lg overflow-hidden">
								<button
									type="button"
									class="w-full flex items-center justify-between p-3 bg-slate-800/30 hover:bg-slate-800/50 transition-colors"
									onclick={() => showRegulatorySection = !showRegulatorySection}
								>
									<span class="flex items-center gap-2 text-sm font-medium text-slate-300">
										<FileText class="h-4 w-4 text-amber-400" />
										Szabályozás
									</span>
									{#if showRegulatorySection}
										<ChevronUp class="h-4 w-4 text-slate-400" />
									{:else}
										<ChevronDown class="h-4 w-4 text-slate-400" />
									{/if}
								</button>
								{#if showRegulatorySection}
									<div class="p-3 space-y-3 border-t border-slate-800" transition:slide={{ duration: 150 }}>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<div class="text-xs text-slate-500 mb-0.5">Vénykötelesség</div>
												<p class="text-sm text-white">{getPrescriptionLabel(selectedDrug.prescriptionRequired)}</p>
											</div>
											<div>
												<div class="text-xs text-slate-500 mb-0.5">Forgalmazás</div>
												<p class="text-sm text-white">{getMarketLabel(selectedDrug.inMarket)}</p>
											</div>
										</div>
										{#if selectedDrug.tttCode || (selectedDrug.tttCodes && selectedDrug.tttCodes.length > 0)}
											<div class="pt-2 border-t border-slate-800/50">
												<div class="text-xs text-slate-500 mb-1">TTT kód{selectedDrug.tttCodes && selectedDrug.tttCodes.length > 1 ? 'ok' : ''}</div>
												<div class="flex flex-wrap gap-1">
													{#if selectedDrug.tttCodes && selectedDrug.tttCodes.length > 1}
														{#each selectedDrug.tttCodes as code}
															<span class="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs font-mono text-slate-300">
																{code}
															</span>
														{/each}
													{:else if selectedDrug.tttCode}
														<span class="text-xs font-mono text-white">{selectedDrug.tttCode}</span>
													{/if}
												</div>
											</div>
										{/if}
										{#if selectedDrug.validFrom || selectedDrug.validUntil}
											<div class="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/50">
												{#if selectedDrug.validFrom}
													<div>
														<div class="text-xs text-slate-500 mb-0.5">Érvényes</div>
														<p class="text-xs text-white">{selectedDrug.validFrom}</p>
													</div>
												{/if}
												{#if selectedDrug.validUntil}
													<div>
														<div class="text-xs text-slate-500 mb-0.5">Lejár</div>
														<p class="text-xs text-white">{selectedDrug.validUntil}</p>
													</div>
												{/if}
											</div>
										{/if}
									</div>
								{/if}
							</div>
						</div>
					{:else if activeTab === 'indications'}
						<div class="space-y-6">
							{#if indicationsLoading}
								<IndicationSkeleton
									bnoCount={4}
									eligibilityCount={3}
								/>
							{:else if drugIndications}
								<!-- BNO Codes Section -->
								{#if drugIndications.bnoCodes.length > 0}
									<div>
										<h3 class="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
											<Stethoscope class="h-4 w-4 text-emerald-400" />
											Engedélyezett indikációk (BNO kódok)
											<span class="text-xs text-slate-500">({drugIndications.bnoCodes.length} kód)</span>
										</h3>
										<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
											{#each drugIndications.bnoCodes as bno}
												<a
													href="/bno?q={encodeURIComponent(bno.code)}"
													class="bno-code-card group flex items-start gap-3 p-3.5 rounded-xl transition-all duration-200
														{bno.offLabel
															? 'off-label'
															: ''}"
													style="
														background: linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%);
														border: 1px solid {bno.offLabel ? 'rgba(245, 158, 11, 0.4)' : 'rgba(100, 116, 139, 0.3)'};
														box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05);
													"
												>
													<span class="flex-shrink-0 font-mono text-emerald-400 bg-emerald-500/15 px-2.5 py-1 rounded-lg text-sm font-semibold border border-emerald-500/30 group-hover:border-emerald-400/50 transition-colors">
														{bno.code}
													</span>
													<div class="flex-1 min-w-0">
														<p class="text-sm text-slate-200 line-clamp-2 leading-relaxed">{bno.description}</p>
														{#if bno.offLabel}
															<span class="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
																<AlertCircle class="h-3 w-3" />
																Off-label
															</span>
														{/if}
													</div>
													<ExternalLink class="h-4 w-4 text-slate-500 flex-shrink-0" />
												</a>
											{/each}
										</div>
									</div>
								{/if}

								<!-- Indication Descriptions -->
								{#if drugIndications.indications.length > 0}
									<div>
										<h3 class="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
											<FileText class="h-4 w-4 text-blue-400" />
											Indikációs leírások
											<span class="text-xs text-slate-500">({drugIndications.indications.filter(i => i.description).length})</span>
										</h3>
										<div class="space-y-3">
											{#each drugIndications.indications.filter(i => i.description) as ind}
												<div
													class="indication-desc-card p-4 rounded-xl"
													style="
														background: linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%);
														border: 1px solid rgba(100, 116, 139, 0.25);
														box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.2);
													"
												>
													<div class="flex items-center flex-wrap gap-2 mb-2">
														<span class="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/30">
															<Tag class="h-3 w-3" />
															{ind.euPointType}
														</span>
														{#if ind.offLabel}
															<span class="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
																<AlertCircle class="h-3 w-3" />
																Off-label
															</span>
														{/if}
													</div>
													<p class="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{ind.description}</p>
												</div>
											{/each}
										</div>
									</div>
								{/if}

								<!-- Eligibility -->
								{#if drugIndications.eligibility.length > 0}
									{@const deduplicatedEligibility = (() => {
										const seen = new Set();
										return drugIndications.eligibility.filter(elig => {
											// Create unique key from specialty + category + eligible
											const key = `${elig.specialtyId || 'none'}|${elig.category}|${elig.eligible}|${elig.timeLimit || ''}`;
											if (seen.has(key)) return false;
											seen.add(key);
											return true;
										});
									})()}
									<div>
										<h3 class="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
											<UserCheck class="h-4 w-4 text-violet-400" />
											Jogosultság és felírási feltételek
											<span class="text-xs text-slate-500">({deduplicatedEligibility.length})</span>
										</h3>
										<!-- Grid layout: 2 columns on medium+, 1 column on mobile -->
										<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
											{#each deduplicatedEligibility as elig}
												{@const prescriberType = specialtyService.parsePrescriberType(elig.category)}
												{@const specialtyName = elig.specialtyId ? specialtyService.getSpecialtyName(elig.specialtyId) : null}
												{@const specialtyColor = elig.specialtyId ? specialtyService.getSpecialtyCategoryColor(elig.specialtyId) : null}
												{@const SpecialtyIcon = elig.specialtyId ? specialtyService.getSpecialtyIcon(elig.specialtyId) : null}
												<div
													class="eligibility-card flex items-center gap-3 p-3 rounded-lg hover:scale-[1.01] transition-all duration-200"
													style="background: linear-gradient(135deg, {specialtyColor?.bg || 'rgba(30, 41, 59, 0.6)'}, rgba(15, 23, 42, 0.9)); border: 1px solid {specialtyColor?.border || 'rgba(100, 116, 139, 0.3)'};"
												>
													<!-- Specialty/Prescriber icon - larger, more prominent -->
													<div
														class="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
														style="background: {specialtyColor?.bg || (prescriberType.type === 'gp' ? 'rgba(34, 197, 94, 0.2)' : prescriberType.type === 'inpatient' ? 'rgba(59, 130, 246, 0.2)' : prescriberType.type === 'outpatient' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(100, 116, 139, 0.2)')};"
													>
														{#if SpecialtyIcon}
															<svelte:component this={SpecialtyIcon} class="h-5 w-5" style="color: {specialtyColor?.text}" />
														{:else if prescriberType.type === 'gp'}
															<Home class="h-5 w-5 text-green-400" />
														{:else if prescriberType.type === 'inpatient'}
															<Hospital class="h-5 w-5 text-blue-400" />
														{:else if prescriberType.type === 'outpatient'}
															<Stethoscope class="h-5 w-5 text-amber-400" />
														{:else if prescriberType.type === 'designated'}
															<Building2 class="h-5 w-5 text-violet-400" />
														{:else}
															<Stethoscope class="h-5 w-5 text-slate-400" />
														{/if}
													</div>

													<!-- Content -->
													<div class="flex-1 min-w-0">
														{#if specialtyName}
															<!-- Specialty name is primary when available -->
															<div class="flex items-center flex-wrap gap-2 mb-0.5">
																<span
																	class="text-base font-semibold"
																	style="color: {specialtyColor?.text || 'rgb(226, 232, 240)'};"
																>
																	{specialtyName}
																</span>
															</div>
															<p class="text-xs text-slate-400">{prescriberType.label} • {elig.eligible}</p>
														{:else}
															<span class="text-sm font-medium text-white">{prescriberType.label}</span>
															<p class="text-xs text-slate-400 mt-0.5">{elig.eligible}</p>
														{/if}
													</div>

													<!-- Time limit badge -->
													{#if elig.timeLimit}
														<div class="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
															<Clock class="h-3.5 w-3.5" />
															{elig.timeLimit} nap
														</div>
													{/if}
												</div>
											{/each}
										</div>
									</div>
								{/if}

								<!-- EU Points Count -->
								{#if drugIndications.euPointCount > 0}
									<div class="flex items-center gap-3 pt-4 border-t border-slate-800">
										<div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-400 border border-violet-500/30">
											<Shield class="h-4 w-4" />
											<span class="text-xs font-semibold">EU támogatási pontok: {drugIndications.euPointCount}</span>
										</div>
									</div>
								{/if}
							{:else}
								<!-- No NEAK indications - try FDA/EMA fallback -->
								<div class="space-y-4">
									<div class="text-center py-4">
										<div class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-800 mb-2">
											<Stethoscope class="h-5 w-5 text-slate-500" />
										</div>
										<p class="text-slate-400 text-sm">Nincs NEAK indikációs adat (nem TB támogatott)</p>
									</div>

									<!-- EMA Fallback -->
									{#if emaData?.matched && emaData.medicine?.therapeuticIndication}
										<div class="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
											<div class="flex items-center gap-2 mb-3">
												<Globe class="h-4 w-4 text-blue-400" />
												<span class="text-sm font-medium text-blue-400">EMA Terápiás javallat (EU)</span>
											</div>
											<p class="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{emaData.medicine.therapeuticIndication}</p>
											<p class="text-xs text-slate-500 mt-3">Forrás: Európai Gyógyszerügynökség (EMA) - {emaData.medicine.name}</p>
										</div>
									{/if}

									<!-- FDA Fallback -->
									{#if fdaData?.found && fdaData.label?.indicationsAndUsage}
										<div class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
											<div class="flex items-center gap-2 mb-3">
												<ShieldAlert class="h-4 w-4 text-red-400" />
												<span class="text-sm font-medium text-red-400">FDA Indikációk (USA)</span>
											</div>
											<p class="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{fdaData.label.indicationsAndUsage}</p>
											<p class="text-xs text-slate-500 mt-3">Forrás: U.S. Food and Drug Administration (FDA)</p>
										</div>
									{:else if !fdaData && !fdaLoading}
										<!-- Offer to load FDA data -->
										<button
											type="button"
											class="w-full p-3 bg-slate-800/50 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
											onclick={() => selectedDrug && loadFdaData(selectedDrug.name, selectedDrug.activeIngredient, selectedDrug.atcCode, selectedDrug.id)}
										>
											<ShieldAlert class="h-4 w-4 text-red-400" />
											<span class="text-sm text-slate-400">FDA indikációk betöltése</span>
										</button>
									{:else if fdaLoading}
										<div class="flex items-center justify-center py-3">
											<Loader2 class="h-4 w-4 animate-spin text-red-400" />
											<span class="ml-2 text-sm text-slate-400">FDA adatok betöltése...</span>
										</div>
									{/if}

									<!-- No fallback available -->
									{#if !(emaData?.matched && emaData.medicine?.therapeuticIndication) && !fdaData?.found && !fdaLoading}
										<p class="text-xs text-slate-500 text-center">
											Kattintson az FDA vagy EMA fülre további információkért.
										</p>
									{/if}
								</div>
							{/if}
						</div>
					{:else if activeTab === 'fda'}
						<div class="space-y-6">
							{#if fdaLoading}
								<div class="flex items-center justify-center py-8">
									<Loader2 class="h-6 w-6 animate-spin text-red-500" />
									<span class="ml-3 text-slate-400">FDA adatok betöltése...</span>
								</div>
							{:else if isMultiIngredientDrug && fdaMultiData && fdaMultiData.perIngredient.length > 0}
								<!-- Multi-ingredient FDA Display with Tabs -->
								<div class="p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
									<div class="flex items-center gap-2 mb-2">
										<ShieldAlert class="h-5 w-5 text-red-400" />
										<span class="text-sm font-medium text-white">FDA Drug Labels - Hatóanyagonként</span>
										<span class="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded border border-blue-500/30">
											{fdaMultiData.perIngredient.length} hatóanyag
										</span>
									</div>
									<p class="text-xs text-slate-400">
										Keresési mód: {fdaMultiData.searchMethod === 'combination' ? 'kombinált készítmény' : fdaMultiData.searchMethod === 'per-ingredient' ? 'hatóanyagonként' : 'ATC fallback'}
									</p>
								</div>

								<!-- Per-Ingredient Tabs -->
								<div class="border-b border-slate-700">
									<nav class="flex gap-1 flex-wrap">
										{#each fdaMultiData.perIngredient as ingredient, idx}
											<button
												type="button"
												class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors
													{activeFdaIngredientTab === idx
														? 'text-red-400 border-red-500 bg-red-500/10'
														: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
												onclick={() => activeFdaIngredientTab = idx}
											>
												{ingredient.englishName || ingredient.ingredient}
												{#if ingredient.result?.found}
													<span class="w-2 h-2 rounded-full bg-green-500"></span>
												{:else}
													<span class="w-2 h-2 rounded-full bg-red-500"></span>
												{/if}
											</button>
										{/each}
									</nav>
								</div>

								<!-- Selected Ingredient Content -->
								{@const currentIngredient = fdaMultiData.perIngredient[activeFdaIngredientTab]}
								{#if currentIngredient?.result?.found && currentIngredient.result.label}
									{@const label = currentIngredient.result.label}
									<!-- Boxed Warning -->
									{#if label.boxedWarning}
										<div class="boxed-warning-container border-2 border-red-500 rounded-lg overflow-hidden">
											<div class="px-4 py-3 bg-red-500/20 border-b border-red-500 flex items-center gap-2">
												<Ban class="h-6 w-6 text-red-400" />
												<span class="font-bold text-red-400 text-lg uppercase tracking-wide">BOXED WARNING</span>
												<span class="text-red-400/60 text-sm ml-2">(Fekete dobozos figyelmeztetés)</span>
											</div>
											<div class="boxed-warning-content p-4 bg-red-500/5">
												{@html formatBoxedWarning(label.boxedWarning)}
											</div>
										</div>
									{/if}

									{#if label.contraindications}
										<FdaContentDisplay
											content={label.contraindications}
											title="Ellenjavallatok (Contraindications)"
											variant="contraindication"
											maxHeight="250px"
										/>
									{/if}

									{#if label.drugInteractions}
										<FdaContentDisplay
											content={label.drugInteractions}
											title="Gyógyszer-interakciók (Drug Interactions)"
											variant="interaction"
											maxHeight="250px"
										/>
									{/if}

									{#if label.warningsAndCautions}
										<FdaContentDisplay
											content={label.warningsAndCautions}
											title="Figyelmeztetések és óvintézkedések"
											variant="warning"
											maxHeight="250px"
										/>
									{/if}

									{#if label.adverseReactions}
										<FdaContentDisplay
											content={label.adverseReactions}
											title="Mellékhatások (Adverse Reactions)"
											variant="info"
											maxHeight="250px"
										/>
									{/if}
								{:else}
									<!-- Ingredient Not Found - Show Manual Search -->
									<div class="py-6 bg-slate-800/30 rounded-lg">
										<div class="text-center mb-4">
											<ShieldAlert class="h-8 w-8 text-slate-500 mx-auto mb-2" />
											<p class="text-slate-400">Nem található FDA adat: <span class="text-white font-medium">{currentIngredient?.englishName || currentIngredient?.ingredient}</span></p>
											<p class="text-xs text-slate-500 mt-1">A hatóanyag nem szerepel az FDA adatbázisban, vagy más néven van regisztrálva.</p>
										</div>

										<!-- Manual Search for this Ingredient -->
										<div class="max-w-md mx-auto px-4">
											<p class="text-sm text-slate-400 mb-3 text-center">Próbáljon angol névvel keresni:</p>
											<div class="flex gap-2">
												<div class="relative flex-1">
													<input
														type="text"
														value={perIngredientFdaSearch.get(activeFdaIngredientTab) || ''}
														oninput={(e) => {
															perIngredientFdaSearch = new Map(perIngredientFdaSearch.set(activeFdaIngredientTab, e.currentTarget.value));
															updatePerIngredientFdaSuggestions(activeFdaIngredientTab, e.currentTarget.value);
														}}
														placeholder="pl. {currentIngredient?.englishName || 'aspirin'}..."
														class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500/50"
														onfocus={() => {
															const val = perIngredientFdaSearch.get(activeFdaIngredientTab) || '';
															if (val.length >= 2) updatePerIngredientFdaSuggestions(activeFdaIngredientTab, val);
														}}
														onblur={() => setTimeout(() => showPerIngredientFdaSuggestions = new Map(showPerIngredientFdaSuggestions.set(activeFdaIngredientTab, false)), 200)}
														onkeydown={(e) => e.key === 'Enter' && handlePerIngredientFdaSearch(activeFdaIngredientTab)}
													/>
													<!-- Autocomplete Dropdown -->
													{#if showPerIngredientFdaSuggestions.get(activeFdaIngredientTab) && (perIngredientFdaSuggestions.get(activeFdaIngredientTab) || []).length > 0}
														<div class="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
															{#each perIngredientFdaSuggestions.get(activeFdaIngredientTab) || [] as suggestion}
																<button
																	type="button"
																	class="w-full px-3 py-2 text-left text-sm text-white hover:bg-slate-700 transition-colors first:rounded-t-lg last:rounded-b-lg"
																	onmousedown={() => selectPerIngredientFdaSuggestion(activeFdaIngredientTab, suggestion)}
																>
																	{suggestion}
																</button>
															{/each}
														</div>
													{/if}
												</div>
												<button
													type="button"
													onclick={() => handlePerIngredientFdaSearch(activeFdaIngredientTab)}
													disabled={!(perIngredientFdaSearch.get(activeFdaIngredientTab)?.trim()) || perIngredientFdaLoading.get(activeFdaIngredientTab)}
													class="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
												>
													{#if perIngredientFdaLoading.get(activeFdaIngredientTab)}
														<Loader2 class="h-4 w-4 animate-spin" />
													{:else}
														<Search class="h-4 w-4" />
													{/if}
													Keresés
												</button>
											</div>

											<!-- Search Results for this Ingredient -->
											{#if perIngredientFdaResults.get(activeFdaIngredientTab)?.found}
												{@const result = perIngredientFdaResults.get(activeFdaIngredientTab)}
												<div class="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
													<div class="flex items-center gap-2 text-emerald-400 mb-3">
														<CheckCircle2 class="h-5 w-5" />
														<span class="font-medium">Találat: {perIngredientFdaSearch.get(activeFdaIngredientTab)}</span>
													</div>
													{#if result?.label}
														<div class="space-y-2 text-sm">
															{#if result.label.brandName || result.label.genericName}
																<p class="text-slate-300">
																	<span class="font-medium">{result.label.brandName}</span>
																	{#if result.label.genericName}
																		<span class="text-slate-400"> ({result.label.genericName})</span>
																	{/if}
																</p>
															{/if}
															{#if result.label.contraindications}
																<FdaContentDisplay
																	content={result.label.contraindications}
																	title="Ellenjavallatok"
																	variant="contraindication"
																	compact
																	maxHeight="150px"
																/>
															{/if}
														</div>
													{/if}
												</div>
											{:else if perIngredientFdaResults.get(activeFdaIngredientTab) && !perIngredientFdaResults.get(activeFdaIngredientTab)?.found}
												<div class="mt-3 text-center text-sm text-slate-500">
													Nincs találat. Próbáljon más kifejezést.
												</div>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Disclaimer -->
								<div class="text-xs text-slate-500 border-t border-slate-800 pt-4">
									<p>Adatforrás: U.S. Food and Drug Administration (FDA) drug labeling database.</p>
								</div>

							{:else if fdaData?.found && fdaData.label}
								<!-- FDA Data Header -->
								<div class="p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
									<div class="flex items-center gap-2 mb-2">
										<ShieldAlert class="h-5 w-5 text-red-400" />
										<span class="text-sm font-medium text-white">FDA Drug Label - USA</span>
									</div>
									<div class="text-xs text-slate-400">
										<p>
											Keresve: {fdaData.searchedBy === 'brand_name' ? 'márkanév' : 'hatóanyag'}
											{#if fdaMatchedByPairing}
												<span class="ml-2 text-amber-400">📌 Mentett párosítás</span>
											{/if}
										</p>
										{#if fdaData.label.brandName || fdaData.label.genericName}
											<p class="mt-1">
												<span class="text-slate-300">{fdaData.label.brandName}</span>
												{#if fdaData.label.genericName}
													<span> ({fdaData.label.genericName})</span>
												{/if}
											</p>
										{/if}
									</div>
								</div>

								<!-- Boxed Warning (Black Box) - Keep prominent -->
								{#if fdaData.label.boxedWarning}
									<div class="boxed-warning-container border-2 border-red-500 rounded-lg overflow-hidden">
										<div class="px-4 py-3 bg-red-500/20 border-b border-red-500 flex items-center gap-2">
											<Ban class="h-6 w-6 text-red-400" />
											<span class="font-bold text-red-400 text-lg uppercase tracking-wide">BOXED WARNING</span>
											<span class="text-red-400/60 text-sm ml-2">(Fekete dobozos figyelmeztetés)</span>
										</div>
										<div class="boxed-warning-content p-4 bg-red-500/5">
											{@html formatBoxedWarning(fdaData.label.boxedWarning)}
										</div>
									</div>
								{/if}

								<!-- Contraindications - Enhanced Display -->
								{#if fdaData.label.contraindications}
									<FdaContentDisplay
										content={fdaData.label.contraindications}
										title="Ellenjavallatok (Contraindications)"
										variant="contraindication"
										maxHeight="300px"
									/>
								{/if}

								<!-- Drug Interactions - Enhanced Display -->
								{#if fdaData.label.drugInteractions}
									<FdaContentDisplay
										content={fdaData.label.drugInteractions}
										title="Gyógyszer-interakciók (Drug Interactions)"
										variant="interaction"
										maxHeight="300px"
									/>
								{/if}

								<!-- Warnings and Precautions - Enhanced Display -->
								{#if fdaData.label.warningsAndCautions}
									<FdaContentDisplay
										content={fdaData.label.warningsAndCautions}
										title="Figyelmeztetések és óvintézkedések"
										variant="warning"
										maxHeight="350px"
									/>
								{/if}

								<!-- Adverse Reactions - Enhanced Display -->
								{#if fdaData.label.adverseReactions}
									<FdaContentDisplay
										content={fdaData.label.adverseReactions}
										title="Mellékhatások (Adverse Reactions)"
										variant="info"
										maxHeight="350px"
									/>
								{/if}

								<!-- Section 8: Special Populations (collapsible) -->
								{#if fdaData.label.pregnancy || fdaData.label.pediatricUse || fdaData.label.geriatricUse || fdaData.label.useInSpecificPopulations || fdaData.label.nursingMothers || fdaData.label.laborAndDelivery}
									<details class="border border-slate-600 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex items-center gap-2 cursor-pointer hover:bg-slate-700/70">
											<Info class="h-4 w-4 text-slate-400" />
											<span class="font-medium text-slate-300">Speciális populációk (8. szakasz)</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30 space-y-4 max-h-[500px] overflow-y-auto">
											{#if fdaData.label.useInSpecificPopulations}
												<FdaContentDisplay
													content={fdaData.label.useInSpecificPopulations}
													title="8. Használat speciális populációkban"
													variant="info"
													compact
													showStats={false}
													maxHeight="250px"
												/>
											{/if}
											{#if fdaData.label.pregnancy}
												<FdaContentDisplay
													content={fdaData.label.pregnancy}
													title="8.1 Terhesség"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.laborAndDelivery}
												<FdaContentDisplay
													content={fdaData.label.laborAndDelivery}
													title="8.2 Szülés és vajúdás"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.nursingMothers}
												<FdaContentDisplay
													content={fdaData.label.nursingMothers}
													title="8.3 Szoptatás"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.pediatricUse}
												<FdaContentDisplay
													content={fdaData.label.pediatricUse}
													title="8.4 Gyermekek"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.geriatricUse}
												<FdaContentDisplay
													content={fdaData.label.geriatricUse}
													title="8.5 Idősek"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
										</div>
									</details>
								{/if}

								<!-- Section 10: Overdosage (collapsible) -->
								{#if fdaData.label.overdosage}
									<details class="border border-slate-600 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex items-center gap-2 cursor-pointer hover:bg-slate-700/70">
											<AlertTriangle class="h-4 w-4 text-amber-400" />
											<span class="font-medium text-slate-300">Túladagolás (10. szakasz)</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30">
											<FdaContentDisplay
												content={fdaData.label.overdosage}
												title="Túladagolás"
												variant="warning"
												compact
												showStats={false}
												maxHeight="300px"
											/>
										</div>
									</details>
								{/if}

								<!-- Section 12: Clinical Pharmacology (collapsible) -->
								{#if fdaData.label.clinicalPharmacology || fdaData.label.mechanismOfAction || fdaData.label.pharmacodynamics || fdaData.label.pharmacokinetics}
									<details class="border border-slate-600 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex items-center gap-2 cursor-pointer hover:bg-slate-700/70">
											<FileText class="h-4 w-4 text-blue-400" />
											<span class="font-medium text-slate-300">Klinikai farmakológia (12. szakasz)</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30 space-y-4 max-h-[500px] overflow-y-auto">
											{#if fdaData.label.clinicalPharmacology}
												<FdaContentDisplay
													content={fdaData.label.clinicalPharmacology}
													title="12. Klinikai farmakológia"
													variant="info"
													compact
													showStats={false}
													maxHeight="250px"
												/>
											{/if}
											{#if fdaData.label.mechanismOfAction}
												<FdaContentDisplay
													content={fdaData.label.mechanismOfAction}
													title="12.1 Hatásmechanizmus"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.pharmacodynamics}
												<FdaContentDisplay
													content={fdaData.label.pharmacodynamics}
													title="12.2 Farmakodinamika"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.pharmacokinetics}
												<FdaContentDisplay
													content={fdaData.label.pharmacokinetics}
													title="12.3 Farmakokinetika"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
										</div>
									</details>
								{/if}

								<!-- Section 14: Clinical Studies (collapsible) -->
								{#if fdaData.label.clinicalStudies}
									<details class="border border-slate-600 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex items-center gap-2 cursor-pointer hover:bg-slate-700/70">
											<FileText class="h-4 w-4 text-green-400" />
											<span class="font-medium text-slate-300">Klinikai vizsgálatok (14. szakasz)</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30">
											<FdaContentDisplay
												content={fdaData.label.clinicalStudies}
												title="Klinikai vizsgálatok"
												variant="info"
												compact
												showStats={false}
												maxHeight="400px"
											/>
										</div>
									</details>
								{/if}

								<!-- Section 2: Dosage and Administration (clinically important - auto-expanded) -->
								{#if fdaData.label.dosageAndAdministration}
									<FdaContentDisplay
										content={fdaData.label.dosageAndAdministration}
										title="Adagolás és alkalmazás (Section 2)"
										variant="info"
										maxHeight="400px"
									/>
								{/if}

								<!-- Section 9: Drug Abuse and Dependence (important for controlled substances) -->
								{#if fdaData.label.drugAbuseAndDependence || fdaData.label.abuse || fdaData.label.dependence}
									<details open class="border border-amber-600/50 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-amber-900/20 border-b border-amber-600/50 flex items-center gap-2 cursor-pointer hover:bg-amber-900/30">
											<AlertTriangle class="h-4 w-4 text-amber-400" />
											<span class="font-medium text-amber-300">Visszaélés és függőség (9. szakasz)</span>
											<span class="ml-auto text-xs text-amber-500/70">kattintson az összezáráshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30 space-y-4 max-h-[400px] overflow-y-auto">
											{#if fdaData.label.drugAbuseAndDependence}
												<FdaContentDisplay
													content={fdaData.label.drugAbuseAndDependence}
													title="9. Visszaélés és függőség"
													variant="warning"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.abuse}
												<FdaContentDisplay
													content={fdaData.label.abuse}
													title="9.1 Visszaélés"
													variant="warning"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.dependence}
												<FdaContentDisplay
													content={fdaData.label.dependence}
													title="9.2 Függőség"
													variant="warning"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
										</div>
									</details>
								{/if}

								<!-- Section 11: Description (collapsed) -->
								{#if fdaData.label.description}
									<details class="border border-slate-600 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex items-center gap-2 cursor-pointer hover:bg-slate-700/70">
											<FileText class="h-4 w-4 text-slate-400" />
											<span class="font-medium text-slate-300">Leírás (11. szakasz)</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30">
											<FdaContentDisplay
												content={fdaData.label.description}
												title="Gyógyszer leírása"
												variant="info"
												compact
												showStats={false}
												maxHeight="300px"
											/>
										</div>
									</details>
								{/if}

								<!-- Section 13: Nonclinical Toxicology (collapsed) -->
								{#if fdaData.label.nonclinicalToxicology || fdaData.label.carcinogenesis || fdaData.label.teratogenicEffects}
									<details class="border border-slate-600 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex items-center gap-2 cursor-pointer hover:bg-slate-700/70">
											<FlaskConical class="h-4 w-4 text-purple-400" />
											<span class="font-medium text-slate-300">Nem-klinikai toxikológia (13. szakasz)</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30 space-y-4 max-h-[400px] overflow-y-auto">
											{#if fdaData.label.nonclinicalToxicology}
												<FdaContentDisplay
													content={fdaData.label.nonclinicalToxicology}
													title="13. Nem-klinikai toxikológia"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.carcinogenesis}
												<FdaContentDisplay
													content={fdaData.label.carcinogenesis}
													title="13.1 Karcinogenezis, mutagenezis"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.teratogenicEffects}
												<FdaContentDisplay
													content={fdaData.label.teratogenicEffects}
													title="Teratogén hatások"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
										</div>
									</details>
								{/if}

								<!-- Section 16: How Supplied/Storage (collapsed) -->
								{#if fdaData.label.howSupplied || fdaData.label.storageAndHandling}
									<details class="border border-slate-600 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex items-center gap-2 cursor-pointer hover:bg-slate-700/70">
											<Package class="h-4 w-4 text-cyan-400" />
											<span class="font-medium text-slate-300">Kiszerelés és tárolás (16. szakasz)</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30 space-y-4">
											{#if fdaData.label.howSupplied}
												<FdaContentDisplay
													content={fdaData.label.howSupplied}
													title="16.1 Kiszerelés"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.storageAndHandling}
												<FdaContentDisplay
													content={fdaData.label.storageAndHandling}
													title="16.2 Tárolás és kezelés"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
										</div>
									</details>
								{/if}

								<!-- Section 17: Patient Counseling Information (collapsed) -->
								{#if fdaData.label.patientMedicationInformation || fdaData.label.informationForPatients}
									<details class="border border-slate-600 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex items-center gap-2 cursor-pointer hover:bg-slate-700/70">
											<Info class="h-4 w-4 text-emerald-400" />
											<span class="font-medium text-slate-300">Beteg tájékoztatás (17. szakasz)</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30 space-y-4">
											{#if fdaData.label.patientMedicationInformation}
												<FdaContentDisplay
													content={fdaData.label.patientMedicationInformation}
													title="Gyógyszer információk betegeknek"
													variant="info"
													compact
													showStats={false}
													maxHeight="300px"
												/>
											{/if}
											{#if fdaData.label.informationForPatients}
												<FdaContentDisplay
													content={fdaData.label.informationForPatients}
													title="Tájékoztató betegek számára"
													variant="info"
													compact
													showStats={false}
													maxHeight="300px"
												/>
											{/if}
										</div>
									</details>
								{/if}

								<!-- Ingredients (important for allergies - auto-expanded) -->
								{#if fdaData.label.activeIngredient || fdaData.label.inactiveIngredient}
									<details open class="border border-emerald-600/50 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-emerald-900/20 border-b border-emerald-600/50 flex items-center gap-2 cursor-pointer hover:bg-emerald-900/30">
											<Pill class="h-4 w-4 text-emerald-400" />
											<span class="font-medium text-emerald-300">Összetevők (allergia ellenőrzéshez)</span>
											<span class="ml-auto text-xs text-emerald-500/70">kattintson az összezáráshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30 space-y-4">
											{#if fdaData.label.activeIngredient}
												<div>
													<h4 class="text-sm font-medium text-emerald-400 mb-2">Hatóanyagok</h4>
													<div class="text-sm text-slate-300 whitespace-pre-wrap bg-slate-800/50 p-3 rounded-lg">
														{fdaData.label.activeIngredient}
													</div>
												</div>
											{/if}
											{#if fdaData.label.inactiveIngredient}
												<div>
													<h4 class="text-sm font-medium text-slate-400 mb-2">Segédanyagok (inaktív összetevők)</h4>
													<div class="text-sm text-slate-400 whitespace-pre-wrap bg-slate-800/50 p-3 rounded-lg max-h-[200px] overflow-y-auto">
														{fdaData.label.inactiveIngredient}
													</div>
												</div>
											{/if}
										</div>
									</details>
								{/if}

								<!-- Disclaimer -->
								<div class="text-xs text-slate-500 border-t border-slate-800 pt-4">
									<p>Adatforrás: U.S. Food and Drug Administration (FDA) drug labeling database. Az információ amerikai gyógyszercímkéből származik és a magyar előírások eltérhetnek. Mindig konzultáljon az aktuális magyarországi betegtájékoztatóval.</p>
								</div>
							{:else if fdaData && !fdaData.found}
								<!-- FDA Not Found - Manual Search -->
								<div class="py-6">
									<div class="text-center mb-6">
										<div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-800 mb-3">
											<ShieldAlert class="h-6 w-6 text-slate-500" />
										</div>
										<p class="text-slate-400">Az automatikus keresés nem talált FDA adatot.</p>
									</div>

									<!-- Manual Search Input with Autocomplete -->
									<div class="max-w-md mx-auto">
										<p class="text-sm text-slate-400 mb-3 text-center">Próbáljon angol gyógyszernévvel keresni:</p>
										<div class="flex gap-2">
											<div class="relative flex-1">
												<input
													type="text"
													bind:value={manualFdaSearch}
													placeholder="pl. aspirin, acetaminophen, ibuprofen..."
													class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500/50"
													oninput={(e) => updateFdaSuggestions(e.currentTarget.value)}
													onfocus={() => manualFdaSearch.length >= 2 && updateFdaSuggestions(manualFdaSearch)}
													onblur={() => setTimeout(() => showFdaSuggestions = false, 200)}
													onkeydown={(e) => e.key === 'Enter' && handleManualFdaSearch()}
												/>
												<!-- Autocomplete Dropdown -->
												{#if showFdaSuggestions && fdaSuggestions.length > 0}
													<div class="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
														{#each fdaSuggestions as suggestion}
															<button
																type="button"
																class="w-full px-3 py-2 text-left text-sm text-white hover:bg-slate-700 transition-colors first:rounded-t-lg last:rounded-b-lg"
																onmousedown={() => selectFdaSuggestion(suggestion)}
															>
																{suggestion}
															</button>
														{/each}
													</div>
												{/if}
											</div>
											<button
												type="button"
												onclick={handleManualFdaSearch}
												disabled={!manualFdaSearch.trim() || manualFdaLoading}
												class="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
											>
												{#if manualFdaLoading}
													<Loader2 class="h-4 w-4 animate-spin" />
												{:else}
													<Search class="h-4 w-4" />
												{/if}
												Keresés
											</button>
										</div>

										<!-- Search Tips -->
										<div class="mt-4 p-3 bg-slate-800/50 rounded-lg">
											<p class="text-xs text-slate-400 font-medium mb-2">Tippek a kereséshez:</p>
											<ul class="text-xs text-slate-500 space-y-1">
												<li>• Használjon angol nevet (aspirin, ibuprofen)</li>
												<li>• Próbálja a hatóanyag angol nevét (acetylsalicylic acid)</li>
												<li>• USA márkaneveknél próbáljon nagybetűt (TYLENOL)</li>
												<li>• Paracetamol helyett acetaminophen</li>
											</ul>
										</div>
									</div>

									<!-- Manual Search Results -->
									{#if manualFdaResults?.found}
										<div class="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
											<div class="flex items-center justify-between mb-3">
												<div class="flex items-center gap-2 text-emerald-400">
													<CheckCircle2 class="h-5 w-5" />
													<span class="font-medium">Találat: {manualFdaSearch}</span>
													{#if fdaMatchedByPairing || !fdaPairingPending}
														<span class="text-xs text-emerald-500/70">(párosítás mentve)</span>
													{/if}
												</div>
												<!-- Save pairing button -->
												{#if fdaPairingPending}
													<button
														type="button"
														onclick={saveFdaPairing}
														class="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm rounded-lg transition-colors flex items-center gap-1.5"
													>
														<CheckCircle2 class="h-4 w-4" />
														Mentés
													</button>
												{/if}
											</div>
											{#if manualFdaResults.label}
												<div class="space-y-3">
													{#if manualFdaResults.label.brandName || manualFdaResults.label.genericName}
														<p class="text-sm text-slate-300">
															<span class="font-medium">{manualFdaResults.label.brandName}</span>
															{#if manualFdaResults.label.genericName}
																<span class="text-slate-400"> ({manualFdaResults.label.genericName})</span>
															{/if}
														</p>
													{/if}
													{#if manualFdaResults.label.indicationsAndUsage}
														<FdaContentDisplay
															content={manualFdaResults.label.indicationsAndUsage}
															title="Indikációk"
															variant="info"
															compact
														/>
													{/if}
													{#if manualFdaResults.label.contraindications}
														<FdaContentDisplay
															content={manualFdaResults.label.contraindications}
															title="Kontraindikációk"
															variant="contraindication"
															compact
														/>
													{/if}
												</div>
											{/if}
										</div>
									{:else if manualFdaResults && !manualFdaResults.found}
										<div class="mt-4 text-center text-sm text-slate-500">
											Nincs találat erre: "{manualFdaSearch}". Próbáljon más kifejezést.
										</div>
									{/if}
								</div>
							{:else}
								<!-- Prompt to load -->
								<div class="text-center py-8">
									<div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-800 mb-3">
										<ShieldAlert class="h-6 w-6 text-red-400" />
									</div>
									<p class="text-slate-300 mb-4">FDA klinikai adatok betöltése</p>
									<button
										type="button"
										class="inline-flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
										onclick={() => selectedDrug && loadFdaData(selectedDrug.name, selectedDrug.activeIngredient, selectedDrug.atcCode, selectedDrug.id)}
									>
										<ShieldAlert class="h-4 w-4" />
										FDA adatok lekérése
									</button>
									<p class="text-xs text-slate-500 mt-3">
										Ellenjavallatok, interakciók és figyelmeztetések az amerikai FDA adatbázisból.
									</p>
								</div>
							{/if}
						</div>

					{:else if activeTab === 'ema'}
						<!-- EMA Tab - EU Drug Data -->
						<div class="space-y-6">
							{#if emaLoading}
								<div class="flex items-center justify-center py-8">
									<Loader2 class="h-6 w-6 animate-spin text-blue-500" />
									<span class="ml-3 text-slate-400">EMA adatok betöltése...</span>
								</div>
							{:else if isMultiIngredientDrug && emaMultiData && emaMultiData.perIngredient.length > 0}
								<!-- Multi-ingredient EMA Display with Tabs -->
								<div class="p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
									<div class="flex items-center gap-2 mb-2">
										<Globe class="h-5 w-5 text-blue-400" />
										<span class="font-medium text-white">EMA EU Adatok - Hatóanyagonként</span>
										<span class="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded border border-blue-500/30">
											{emaMultiData.perIngredient.length} hatóanyag
										</span>
									</div>
									<p class="text-xs text-slate-400">
										Keresési mód: {emaMultiData.searchMethod === 'combination' ? 'kombinált készítmény (ATC)' : emaMultiData.searchMethod === 'per-ingredient' ? 'hatóanyagonként' : 'ATC fallback'}
									</p>
									{#if emaDataTimestamp}
										<p class="text-xs text-slate-500 mt-1">Frissítve: {emaDataTimestamp}</p>
									{/if}
								</div>

								<!-- Aggregated Shortages (show all at top) -->
								{#if emaMultiData.aggregatedShortages && emaMultiData.aggregatedShortages.length > 0}
									{#each emaMultiData.aggregatedShortages as shortage}
										<div class="p-4 bg-red-900/30 border-2 border-red-500/50 rounded-lg">
											<div class="flex items-center gap-2 mb-2">
												<AlertTriangle class="h-5 w-5 text-red-400" />
												<span class="font-bold text-red-400 uppercase">Hiánycikk</span>
												<span class="text-xs text-red-300/70 ml-auto">{shortage.lastUpdated}</span>
											</div>
											<p class="text-red-200 font-medium">{shortage.medicine}</p>
											{#if shortage.formsAffected}
												<p class="text-sm text-red-300/80 mt-1">Érintett formák: {shortage.formsAffected}</p>
											{/if}
										</div>
									{/each}
								{/if}

								<!-- Aggregated Safety Alerts -->
								{#if emaMultiData.aggregatedDhpcs && emaMultiData.aggregatedDhpcs.length > 0}
									<div class="p-4 bg-amber-900/20 border border-amber-700/30 rounded-lg">
										<h4 class="font-medium text-amber-400 mb-3 flex items-center gap-2">
											<AlertTriangle class="h-4 w-4" />
											Biztonsági figyelmeztetések ({emaMultiData.aggregatedDhpcs.length})
										</h4>
										<div class="space-y-2">
											{#each emaMultiData.aggregatedDhpcs.slice(0, 5) as dhpc}
												<a href={dhpc.dhpcUrl} target="_blank" rel="noopener noreferrer"
													class="flex items-center gap-3 p-2 bg-slate-800/50 hover:bg-amber-900/30 rounded-lg transition-colors group">
													<span class="text-amber-300 font-medium text-sm">{dhpc.medicine}</span>
													<span class="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded">{dhpc.dhpcType}</span>
													<ExternalLink class="h-3 w-3 text-slate-500 group-hover:text-amber-400 ml-auto" />
												</a>
											{/each}
										</div>
									</div>
								{/if}

								<!-- Per-Ingredient Tabs -->
								<div class="border-b border-slate-700">
									<nav class="flex gap-1 flex-wrap">
										{#each emaMultiData.perIngredient as ingredient, idx}
											<button
												type="button"
												class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors
													{activeEmaIngredientTab === idx
														? 'text-blue-400 border-blue-500 bg-blue-500/10'
														: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
												onclick={() => activeEmaIngredientTab = idx}
											>
												{ingredient.englishName || ingredient.ingredient}
												{#if ingredient.match?.matched}
													<span class="w-2 h-2 rounded-full bg-green-500"></span>
												{:else}
													<span class="w-2 h-2 rounded-full bg-amber-500"></span>
												{/if}
											</button>
										{/each}
									</nav>
								</div>

								<!-- Selected Ingredient EMA Content -->
								{@const currentEmaIngredient = emaMultiData.perIngredient[activeEmaIngredientTab]}
								{#if currentEmaIngredient?.match?.matched && currentEmaIngredient.match.medicine}
									{@const medicine = currentEmaIngredient.match.medicine}
									<div class="p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
										<h4 class="font-medium text-slate-300 mb-4 flex items-center gap-2">
											<FileText class="h-4 w-4 text-blue-400" />
											EU Engedélyezési Adatok - {currentEmaIngredient.englishName}
										</h4>
										<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
											<div>
												<span class="text-xs text-slate-500">EU gyógyszernév</span>
												<p class="text-white font-medium">{medicine.name}</p>
											</div>
											<div>
												<span class="text-xs text-slate-500">Státusz</span>
												<p class="text-white">
													<span class="inline-flex items-center gap-1.5 {medicine.status === 'Authorised' ? 'text-green-400' : 'text-amber-400'}">
														{#if medicine.status === 'Authorised'}
															<CheckCircle2 class="h-4 w-4" />
														{:else}
															<AlertCircle class="h-4 w-4" />
														{/if}
														{medicine.status}
													</span>
												</p>
											</div>
											{#if medicine.inn}
												<div>
													<span class="text-xs text-slate-500">INN</span>
													<p class="text-blue-400">{medicine.inn}</p>
												</div>
											{/if}
											{#if medicine.atcCode}
												<div>
													<span class="text-xs text-slate-500">ATC kód</span>
													<p class="text-white font-mono">{medicine.atcCode}</p>
												</div>
											{/if}
										</div>
										{#if medicine.therapeuticIndication}
											<div class="mt-4 pt-4 border-t border-slate-700">
												<span class="text-xs text-slate-500">Terápiás javallat</span>
												<p class="text-sm text-slate-300 mt-1 leading-relaxed line-clamp-4">{medicine.therapeuticIndication}</p>
											</div>
										{/if}
										{#if medicine.productUrl}
											<a href={medicine.productUrl} target="_blank" rel="noopener noreferrer"
												class="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm mt-4">
												<Globe class="h-4 w-4" />
												EMA termékoldal
												<ExternalLink class="h-3 w-3" />
											</a>
										{/if}
									</div>
								{:else}
									<!-- Ingredient Not Found - Show Manual Search -->
									<div class="py-6 bg-slate-800/30 rounded-lg">
										<div class="text-center mb-4">
											<Globe class="h-8 w-8 text-slate-500 mx-auto mb-2" />
											<p class="text-slate-400">Nincs EU adat: <span class="text-white font-medium">{currentEmaIngredient?.englishName || currentEmaIngredient?.ingredient}</span></p>
											<p class="text-xs text-slate-500 mt-1">A hatóanyag nem szerepel az EMA központi engedélyezésű gyógyszerei között.</p>
										</div>

										<!-- Manual Search for this Ingredient -->
										<div class="max-w-md mx-auto px-4">
											<p class="text-sm text-slate-400 mb-3 text-center">Próbáljon angol INN névvel keresni:</p>
											<div class="flex gap-2">
												<div class="relative flex-1">
													<input
														type="text"
														value={perIngredientEmaSearch.get(activeEmaIngredientTab) || ''}
														oninput={(e) => {
															perIngredientEmaSearch = new Map(perIngredientEmaSearch.set(activeEmaIngredientTab, e.currentTarget.value));
															updatePerIngredientEmaSuggestions(activeEmaIngredientTab, e.currentTarget.value);
														}}
														placeholder="pl. {currentEmaIngredient?.englishName || 'ibuprofen'}..."
														class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
														onfocus={() => {
															const val = perIngredientEmaSearch.get(activeEmaIngredientTab) || '';
															if (val.length >= 2) updatePerIngredientEmaSuggestions(activeEmaIngredientTab, val);
														}}
														onblur={() => setTimeout(() => showPerIngredientEmaSuggestions = new Map(showPerIngredientEmaSuggestions.set(activeEmaIngredientTab, false)), 200)}
														onkeydown={(e) => e.key === 'Enter' && handlePerIngredientEmaSearch(activeEmaIngredientTab)}
													/>
													<!-- Autocomplete Dropdown -->
													{#if showPerIngredientEmaSuggestions.get(activeEmaIngredientTab) && (perIngredientEmaSuggestions.get(activeEmaIngredientTab) || []).length > 0}
														<div class="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto">
															{#each perIngredientEmaSuggestions.get(activeEmaIngredientTab) || [] as suggestion}
																<button
																	type="button"
																	class="w-full px-3 py-2 text-left hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-0"
																	onmousedown={() => selectPerIngredientEmaSuggestion(activeEmaIngredientTab, suggestion)}
																>
																	<div class="text-sm text-white font-medium">{suggestion.name}</div>
																	<div class="text-xs text-blue-400">{suggestion.inn}</div>
																</button>
															{/each}
														</div>
													{/if}
												</div>
												<button
													type="button"
													onclick={() => handlePerIngredientEmaSearch(activeEmaIngredientTab)}
													disabled={!(perIngredientEmaSearch.get(activeEmaIngredientTab)?.trim()) || perIngredientEmaLoading.get(activeEmaIngredientTab)}
													class="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
												>
													{#if perIngredientEmaLoading.get(activeEmaIngredientTab)}
														<Loader2 class="h-4 w-4 animate-spin" />
													{:else}
														<Search class="h-4 w-4" />
													{/if}
													Keresés
												</button>
											</div>

											<!-- Search Results for this Ingredient -->
											{#if perIngredientEmaResults.get(activeEmaIngredientTab)?.matched}
												{@const result = perIngredientEmaResults.get(activeEmaIngredientTab)}
												<div class="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
													<div class="flex items-center gap-2 text-emerald-400 mb-3">
														<CheckCircle2 class="h-5 w-5" />
														<span class="font-medium">Találat: {perIngredientEmaSearch.get(activeEmaIngredientTab)}</span>
													</div>
													{#if result?.medicine}
														<div class="grid grid-cols-2 gap-3 text-sm">
															<div>
																<span class="text-xs text-slate-500">Gyógyszernév</span>
																<p class="text-white">{result.medicine.name}</p>
															</div>
															<div>
																<span class="text-xs text-slate-500">Státusz</span>
																<p class="{result.medicine.status === 'Authorised' ? 'text-green-400' : 'text-amber-400'}">{result.medicine.status}</p>
															</div>
															{#if result.medicine.inn}
																<div>
																	<span class="text-xs text-slate-500">INN</span>
																	<p class="text-blue-400">{result.medicine.inn}</p>
																</div>
															{/if}
															{#if result.medicine.therapeuticIndication}
																<div class="col-span-2">
																	<span class="text-xs text-slate-500">Terápiás javallat</span>
																	<p class="text-slate-300 text-sm line-clamp-3">{result.medicine.therapeuticIndication}</p>
																</div>
															{/if}
														</div>
														{#if result.medicine.productUrl}
															<a href={result.medicine.productUrl} target="_blank" rel="noopener noreferrer"
																class="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm mt-3">
																<Globe class="h-4 w-4" />
																EMA termékoldal
																<ExternalLink class="h-3 w-3" />
															</a>
														{/if}
													{/if}
												</div>
											{:else if perIngredientEmaResults.get(activeEmaIngredientTab) === null && perIngredientEmaSearch.get(activeEmaIngredientTab) && !perIngredientEmaLoading.get(activeEmaIngredientTab)}
												<div class="mt-3 text-center text-sm text-slate-500">
													Nincs találat. Próbáljon más kifejezést.
												</div>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Disclaimer -->
								<div class="text-xs text-slate-500 border-t border-slate-800 pt-4">
									<p>Adatforrás: European Medicines Agency (EMA) nyilvános adatbázis.</p>
								</div>

							{:else}
								<!-- Header with match status -->
								<div class="p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
									<div class="flex items-center justify-between flex-wrap gap-2">
										<div class="flex items-center gap-2">
											<Globe class="h-5 w-5 text-blue-400" />
											<span class="font-medium text-white">EMA EU Adatok</span>
											{#if emaData?.matched}
												<span class="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded border border-green-500/30">Illeszkedik ({emaData.method})</span>
											{:else}
												<span class="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded border border-amber-500/30">Nincs EU adat</span>
											{/if}
										</div>
										{#if emaDataTimestamp}
											<span class="text-xs text-slate-500">Frissítve: {emaDataTimestamp}</span>
										{/if}
									</div>
									{#if emaData?.searchTerm}
										<p class="text-xs text-slate-400 mt-2">Keresés: <span class="text-blue-400">{emaData.searchTerm}</span></p>
									{/if}
								</div>

								<!-- SHORTAGE ALERT (if active) -->
								{#if emaData?.shortages && emaData.shortages.length > 0}
									{#each emaData.shortages as shortage}
										<div class="p-4 bg-red-900/30 border-2 border-red-500/50 rounded-lg">
											<div class="flex items-center gap-2 mb-3">
												<AlertTriangle class="h-5 w-5 text-red-400" />
												<span class="font-bold text-red-400 uppercase">Hiánycikk</span>
												<span class="text-xs text-red-300/70 ml-auto">{shortage.lastUpdated}</span>
											</div>
											<p class="text-red-200 font-medium mb-2">{shortage.medicine}</p>
											{#if shortage.formsAffected}
												<p class="text-sm text-red-300/80 mb-1">
													<span class="text-slate-400">Érintett formák:</span> {shortage.formsAffected}
												</p>
											{/if}
											{#if shortage.strengthsAffected}
												<p class="text-sm text-red-300/80 mb-1">
													<span class="text-slate-400">Érintett dózisok:</span> {shortage.strengthsAffected}
												</p>
											{/if}
											{#if shortage.expectedResolution}
												<p class="text-sm text-slate-300 mt-2">
													<span class="text-slate-400">Várható megoldás:</span> {shortage.expectedResolution}
												</p>
											{/if}
											<div class="flex items-center gap-4 mt-3">
												{#if shortage.hasAlternatives === true}
													<span class="text-sm text-green-400 flex items-center gap-1">
														<CheckCircle2 class="h-4 w-4" />
														Alternatívák elérhetőek
													</span>
												{:else if shortage.hasAlternatives === false}
													<span class="text-sm text-red-400 flex items-center gap-1">
														<XCircle class="h-4 w-4" />
														Nincs alternatíva
													</span>
												{:else}
													<span class="text-sm text-slate-400">Alternatívák: ismeretlen</span>
												{/if}
												{#if shortage.shortageUrl}
													<a href={shortage.shortageUrl} target="_blank" rel="noopener noreferrer" class="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
														Részletek <ExternalLink class="h-3 w-3" />
													</a>
												{/if}
											</div>
										</div>
									{/each}
								{/if}

								<!-- SAFETY ALERTS (DHPCs) -->
								{#if emaData?.dhpcs && emaData.dhpcs.length > 0}
									<div class="p-4 bg-amber-900/20 border border-amber-700/30 rounded-lg">
										<h4 class="font-medium text-amber-400 mb-3 flex items-center gap-2">
											<AlertTriangle class="h-4 w-4" />
											Biztonsági figyelmeztetések ({emaData.dhpcs.length})
										</h4>
										<div class="space-y-2">
											{#each emaData.dhpcs as dhpc}
												<a
													href={dhpc.dhpcUrl}
													target="_blank"
													rel="noopener noreferrer"
													class="flex items-center gap-3 p-3 bg-slate-800/50 hover:bg-amber-900/30 rounded-lg transition-colors group"
												>
													<div class="flex-1 min-w-0">
														<div class="flex items-center gap-2 flex-wrap">
															<span class="text-amber-300 font-medium">{dhpc.medicine}</span>
															<span class="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded">{dhpc.dhpcType}</span>
														</div>
														{#if dhpc.activeSubstances && dhpc.activeSubstances !== dhpc.medicine}
															<p class="text-xs text-slate-400 mt-1">{dhpc.activeSubstances}</p>
														{/if}
													</div>
													<div class="flex items-center gap-2 flex-shrink-0">
														<span class="text-xs text-slate-500">{dhpc.disseminationDate}</span>
														<ExternalLink class="h-4 w-4 text-slate-500 group-hover:text-amber-400 transition-colors" />
													</div>
												</a>
											{/each}
										</div>
									</div>
								{/if}

								<!-- AUTHORIZATION STATUS -->
								{#if emaData?.medicine}
									<div class="p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
										<h4 class="font-medium text-slate-300 mb-4 flex items-center gap-2">
											<FileText class="h-4 w-4 text-blue-400" />
											EU Engedélyezési Adatok
											{#if emaMatchedByPairing}
												<span class="ml-2 text-xs text-amber-400">📌 Mentett párosítás</span>
											{/if}
										</h4>
										<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
											<div>
												<span class="text-xs text-slate-500">EU gyógyszernév</span>
												<p class="text-white font-medium">{emaData.medicine.name}</p>
											</div>
											<div>
												<span class="text-xs text-slate-500">Státusz</span>
												<p class="text-white">
													<span class="inline-flex items-center gap-1.5 {emaData.medicine.status === 'Authorised' ? 'text-green-400' : 'text-amber-400'}">
														{#if emaData.medicine.status === 'Authorised'}
															<CheckCircle2 class="h-4 w-4" />
														{:else}
															<AlertCircle class="h-4 w-4" />
														{/if}
														{emaData.medicine.status}
													</span>
												</p>
											</div>
											{#if emaData.medicine.inn}
												<div>
													<span class="text-xs text-slate-500">INN (nemzetközi szabadnév)</span>
													<p class="text-blue-400">{emaData.medicine.inn}</p>
												</div>
											{/if}
											{#if emaData.medicine.atcCode}
												<div>
													<span class="text-xs text-slate-500">ATC kód</span>
													<p class="text-white font-mono">{emaData.medicine.atcCode}</p>
												</div>
											{/if}
											{#if emaData.medicine.authorisationDate}
												<div>
													<span class="text-xs text-slate-500">Engedélyezés dátuma</span>
													<p class="text-white">{emaData.medicine.authorisationDate}</p>
												</div>
											{/if}
											{#if emaData.medicine.holder}
												<div>
													<span class="text-xs text-slate-500">Forgalomba hozatali engedély jogosultja</span>
													<p class="text-white text-sm">{emaData.medicine.holder}</p>
												</div>
											{/if}
										</div>

										<!-- Special flags -->
										{#if emaData.medicine.biosimilar || emaData.medicine.orphanMedicine || emaData.medicine.additionalMonitoring || emaData.medicine.genericOrHybrid || emaData.medicine.conditionalApproval}
											<div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-700">
												{#if emaData.medicine.biosimilar}
													<span class="px-2 py-1 text-xs bg-cyan-500/20 text-cyan-400 rounded border border-cyan-500/30">Bioszimiláris</span>
												{/if}
												{#if emaData.medicine.orphanMedicine}
													<span class="px-2 py-1 text-xs bg-violet-500/20 text-violet-400 rounded border border-violet-500/30">Ritka betegségekre</span>
												{/if}
												{#if emaData.medicine.additionalMonitoring}
													<span class="px-2 py-1 text-xs bg-amber-500/20 text-amber-400 rounded border border-amber-500/30">Fokozott felügyelet</span>
												{/if}
												{#if emaData.medicine.genericOrHybrid}
													<span class="px-2 py-1 text-xs bg-slate-500/20 text-slate-400 rounded border border-slate-500/30">Generikus/Hibrid</span>
												{/if}
												{#if emaData.medicine.conditionalApproval}
													<span class="px-2 py-1 text-xs bg-amber-500/20 text-amber-400 rounded border border-amber-500/30">Feltételes engedély</span>
												{/if}
											</div>
										{/if}

										<!-- Therapeutic indication -->
										{#if emaData.medicine.therapeuticIndication}
											<div class="mt-4 pt-4 border-t border-slate-700">
												<span class="text-xs text-slate-500">Terápiás javallat</span>
												<p class="text-sm text-slate-300 mt-1 leading-relaxed line-clamp-6">{emaData.medicine.therapeuticIndication}</p>
											</div>
										{/if}

										<!-- Link to EMA page -->
										{#if emaData.medicine.productUrl}
											<div class="mt-4 pt-4 border-t border-slate-700">
												<a
													href={emaData.medicine.productUrl}
													target="_blank"
													rel="noopener noreferrer"
													class="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm"
												>
													<Globe class="h-4 w-4" />
													EMA termékoldal megtekintése
													<ExternalLink class="h-3 w-3" />
												</a>
											</div>
										{/if}
									</div>
								{/if}

								<!-- External links section (always show) -->
								{@const searchTerm = emaEnglishIngredient || selectedDrug?.activeIngredient || ''}
								{#if searchTerm}
									<details class="border border-slate-700 rounded-lg overflow-hidden">
										<summary class="px-4 py-3 bg-slate-800/50 border-b border-slate-700 flex items-center gap-2 cursor-pointer hover:bg-slate-700/50">
											<ExternalLink class="h-4 w-4 text-slate-400" />
											<span class="font-medium text-slate-300">Külső EMA linkek</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 space-y-3">
											<a
												href="https://www.adrreports.eu/en/search_subst.html#{encodeURIComponent(searchTerm)}"
												target="_blank"
												rel="noopener noreferrer"
												class="flex items-center gap-3 p-3 bg-amber-900/20 border border-amber-700/30 rounded-lg hover:bg-amber-900/30 transition-colors group"
											>
												<AlertTriangle class="h-5 w-5 text-amber-400" />
												<div class="flex-1">
													<div class="font-medium text-amber-300">Mellékhatások (EudraVigilance)</div>
													<div class="text-xs text-slate-400">Bejelentett mellékhatások az EU-ban</div>
												</div>
												<ExternalLink class="h-4 w-4 text-slate-500 group-hover:text-amber-400 transition-colors" />
											</a>
											<a
												href="https://www.ema.europa.eu/en/search?search_api_views_fulltext={encodeURIComponent(searchTerm)}"
												target="_blank"
												rel="noopener noreferrer"
												class="flex items-center gap-3 p-3 bg-blue-900/20 border border-blue-700/30 rounded-lg hover:bg-blue-900/30 transition-colors group"
											>
												<FileText class="h-5 w-5 text-blue-400" />
												<div class="flex-1">
													<div class="font-medium text-blue-300">EMA Keresés</div>
													<div class="text-xs text-slate-400">Hivatalos EU dokumentumok keresése</div>
												</div>
												<ExternalLink class="h-4 w-4 text-slate-500 group-hover:text-blue-400 transition-colors" />
											</a>
										</div>
									</details>
								{/if}

								<!-- Manual EMA Search (when not matched) -->
								{#if !emaData?.matched && !emaMultiData}
									<div class="mt-4 p-4 bg-slate-800/50 rounded-lg">
										<p class="text-sm text-slate-400 mb-3">Próbáljon angol gyógyszernévvel (INN) keresni:</p>
										<div class="relative">
											<div class="flex gap-2">
												<div class="flex-1 relative">
													<input
														type="text"
														bind:value={manualEmaSearch}
														placeholder="pl. ibuprofen, omeprazole..."
														class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
														onkeydown={(e) => e.key === 'Enter' && handleManualEmaSearch()}
														oninput={(e) => updateEmaSuggestions(e.currentTarget.value)}
														onfocus={() => manualEmaSearch.length >= 2 && updateEmaSuggestions(manualEmaSearch)}
														onblur={() => setTimeout(() => showEmaSuggestions = false, 200)}
													/>
													<!-- Autocomplete dropdown -->
													{#if showEmaSuggestions && emaSuggestions.length > 0}
														<div class="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto">
															{#each emaSuggestions as suggestion}
																<button
																	type="button"
																	class="w-full px-3 py-2 text-left hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-0"
																	onmousedown={() => selectEmaSuggestion(suggestion)}
																>
																	<div class="text-sm text-white font-medium">{suggestion.name}</div>
																	<div class="text-xs text-blue-400">{suggestion.inn}</div>
																</button>
															{/each}
														</div>
													{/if}
												</div>
												<button
													type="button"
													onclick={handleManualEmaSearch}
													disabled={!manualEmaSearch.trim() || manualEmaLoading}
													class="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
												>
													{#if manualEmaLoading}
														<Loader2 class="h-4 w-4 animate-spin" />
													{:else}
														<Search class="h-4 w-4" />
													{/if}
													Keresés
												</button>
											</div>
										</div>

										<!-- Manual EMA Search Results -->
										{#if manualEmaResults?.matched}
											<div class="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
												<div class="flex items-center justify-between mb-3">
													<div class="flex items-center gap-2 text-emerald-400">
														<CheckCircle2 class="h-5 w-5" />
														<span class="font-medium">Találat: {manualEmaSearch}</span>
														{#if emaMatchedByPairing || !emaPairingPending}
															<span class="text-xs text-emerald-500/70">(párosítás mentve)</span>
														{/if}
													</div>
													<!-- Save pairing button -->
													{#if emaPairingPending}
														<button
															type="button"
															onclick={saveEmaPairing}
															class="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm rounded-lg transition-colors flex items-center gap-1.5"
														>
															<CheckCircle2 class="h-4 w-4" />
															Mentés
														</button>
													{/if}
												</div>
												{#if manualEmaResults.medicine}
													<div class="grid grid-cols-2 gap-3 text-sm">
														<div>
															<span class="text-xs text-slate-500">Gyógyszernév</span>
															<p class="text-white">{manualEmaResults.medicine.name}</p>
														</div>
														<div>
															<span class="text-xs text-slate-500">Státusz</span>
															<p class="{manualEmaResults.medicine.status === 'Authorised' ? 'text-green-400' : 'text-amber-400'}">{manualEmaResults.medicine.status}</p>
														</div>
														{#if manualEmaResults.medicine.inn}
															<div>
																<span class="text-xs text-slate-500">INN</span>
																<p class="text-blue-400">{manualEmaResults.medicine.inn}</p>
															</div>
														{/if}
														{#if manualEmaResults.medicine.therapeuticIndication}
															<div class="col-span-2">
																<span class="text-xs text-slate-500">Terápiás javallat</span>
																<p class="text-slate-300 text-sm line-clamp-3">{manualEmaResults.medicine.therapeuticIndication}</p>
															</div>
														{/if}
													</div>
												{/if}
											</div>
										{:else if manualEmaResults === null && manualEmaSearch && !manualEmaLoading}
											<!-- This case is when search returned no results -->
										{/if}
									</div>
								{/if}

								<!-- Footer info -->
								<div class="text-xs text-slate-500 pt-2 border-t border-slate-800">
									<p>Adatforrás: European Medicines Agency (EMA) nyilvános adatbázis.</p>
									{#if !emaData?.matched && !manualEmaResults?.matched}
										<p class="mt-1 text-amber-500/70">Ez a gyógyszer nem található az EMA központi engedélyezésű gyógyszerei között. Ez nem jelenti, hogy nem engedélyezett - lehet nemzeti engedélyezésű.</p>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
						</div>
					{/key}
				</div>
			</div>
		{:else}
			<!-- Empty State -->
			<div class="text-center py-20">
				<div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 mb-4">
					<Search class="h-8 w-8 text-slate-500" />
				</div>
				<h2 class="text-xl font-semibold text-white mb-2">Keressen egy gyógyszert</h2>
				<p class="text-slate-400 max-w-md mx-auto">
					Használja a keresőt a gyógyszer neve, hatóanyaga vagy ATC kódja alapján a teljes NEAK adatbázisban.
				</p>
			</div>
		{/if}
	</main>

	<!-- Footer -->
	<footer class="mt-auto py-6 px-4 border-t border-slate-800">
		<div class="max-w-4xl mx-auto text-center text-sm text-slate-500">
			<p class="mb-1">
				<span class="text-slate-400">HDD - Hungarian Drug Database</span>
			</p>
			<p>
				Made by <span class="text-cyan-400">Dr. Zsolaj</span> ·
				Data sources: <span class="text-slate-400">NEAK</span>,
				<span class="text-slate-400">OGYÉI</span>,
				<span class="text-slate-400">EMA</span>,
				<span class="text-slate-400">FDA</span>
			</p>
		</div>
	</footer>
</div>

<!-- Drug Info Modal -->
<DrugInfoModal
	drug={modalDrug}
	open={showInfoModal}
	onClose={closeInfoModal}
/>

<style>
	/* Hide scrollbar but allow scrolling */
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}

	/* Ensure tabs can scroll on mobile */
	.tabs-scroll-container {
		display: flex;
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
		scroll-behavior: smooth;
		touch-action: pan-x;
	}
	.tabs-scroll-container > * {
		flex-shrink: 0;
	}

	/* Galaxy Brutalist BNO Code Cards */
	:global(.bno-code-card) {
		transition: all 0.15s ease;
	}

	:global(.bno-code-card:hover) {
		transform: translate(-2px, -2px);
		box-shadow: 5px 5px 0 rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
		border-color: rgba(139, 92, 246, 0.5) !important;
	}

	:global(.bno-code-card.off-label:hover) {
		border-color: rgba(245, 158, 11, 0.6) !important;
		box-shadow: 5px 5px 0 rgba(245, 158, 11, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
	}

	/* Galaxy Eligibility Cards */
	:global(.eligibility-card) {
		transition: all 0.15s ease;
	}

	:global(.eligibility-card:hover) {
		transform: translate(-2px, -2px);
		box-shadow: 5px 5px 0 rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
	}

	/* Boxed Warning Styling */
	:global(.boxed-warning-content) {
		font-size: 0.9375rem;
		line-height: 1.75;
	}

	:global(.boxed-warning-content .boxed-paragraph) {
		color: rgb(252, 165, 165); /* red-300 */
		margin-bottom: 1rem;
	}

	:global(.boxed-warning-content .boxed-subsection) {
		display: block;
		margin: 1.25rem 0 0.75rem 0;
		padding: 0.5rem 0.75rem;
		background: rgba(239, 68, 68, 0.15);
		border-left: 3px solid rgb(239, 68, 68);
		border-radius: 0 0.25rem 0.25rem 0;
	}

	:global(.boxed-warning-content .boxed-section-number) {
		color: rgb(248, 113, 113); /* red-400 */
		font-weight: 700;
		font-size: 1.125rem;
		font-family: ui-monospace, monospace;
		margin-right: 0.5rem;
	}

	:global(.boxed-warning-content .boxed-section-title) {
		color: rgb(254, 202, 202); /* red-200 */
		font-weight: 600;
		font-size: 1.125rem;
	}

	:global(.boxed-warning-content .boxed-keyword) {
		background: rgba(239, 68, 68, 0.35);
		color: rgb(254, 202, 202);
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		font-weight: 700;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.025em;
	}

	:global(.boxed-warning-content .boxed-action) {
		color: rgb(134, 239, 172); /* green-300 */
		font-weight: 600;
	}

	:global(.boxed-warning-content .boxed-ref) {
		color: rgb(147, 197, 253); /* blue-300 */
		font-weight: 500;
		font-family: ui-monospace, monospace;
		font-size: 0.875rem;
	}

	:global(.boxed-warning-content .boxed-see-ref) {
		color: rgb(147, 197, 253);
		font-style: italic;
		font-size: 0.875rem;
	}

	:global(.boxed-warning-content .boxed-value) {
		color: rgb(251, 191, 36); /* amber-400 */
		font-weight: 600;
		font-family: ui-monospace, monospace;
		background: rgba(251, 191, 36, 0.1);
		padding: 0.125rem 0.25rem;
		border-radius: 0.125rem;
	}

	:global(.boxed-warning-content .boxed-list-item) {
		display: block;
		padding-left: 1.5rem;
		margin: 0.5rem 0;
		position: relative;
		color: rgb(252, 165, 165);
	}

	:global(.boxed-warning-content .boxed-list-number) {
		color: rgb(248, 113, 113);
		font-weight: 700;
		font-family: ui-monospace, monospace;
		margin-right: 0.5rem;
	}

	:global(.boxed-warning-content .boxed-bullet-item) {
		display: block;
		padding-left: 1rem;
		margin: 0.5rem 0;
		color: rgb(252, 165, 165);
	}

	:global(.boxed-warning-content .boxed-bullet-item::before) {
		content: '';
	}
</style>
