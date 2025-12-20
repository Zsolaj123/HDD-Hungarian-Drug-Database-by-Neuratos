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
	import { openFdaService, type OpenFdaSearchResult } from '$lib/services/openfda-service';
	import { specialtyService } from '$lib/services/specialty-service';
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
		Shield
	} from 'lucide-svelte';
	import { fade, slide } from 'svelte/transition';

	// ============================================================================
	// State
	// ============================================================================

	let selectedDrug = $state<Drug | null>(null);
	let activeTab = $state<'basic' | 'dosage' | 'packaging' | 'regulatory' | 'indications' | 'fda'>('basic');
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

	async function loadFdaData(brandName: string, genericName?: string) {
		fdaLoading = true;
		fdaData = null;
		try {
			// Extract brand name from full drug name (e.g., "TECFIDERA 120 MG..." -> "TECFIDERA")
			const cleanBrand = brandName.split(/\s+\d/)[0].trim();
			// Use translation-aware method for Hungarian→English ingredient lookup
			fdaData = await openFdaService.getDrugLabelWithTranslation(cleanBrand, genericName);
		} catch (error) {
			console.error('Failed to load FDA data:', error);
			fdaData = null;
		}
		fdaLoading = false;
	}

	async function handleDrugSelect(drug: Drug | SimplifiedDrug | DrugSummaryLight) {
		// Fetch full drug details from the database
		isLoading = true;
		drugIndications = null; // Reset indications
		fdaData = null; // Reset FDA data
		try {
			const fullDrug = await drugService.getFullDrugDetails(drug.id);
			if (fullDrug) {
				selectedDrug = fullDrug;
				// Update URL without navigation
				const url = new URL(window.location.href);
				url.searchParams.set('id', fullDrug.id);
				window.history.pushState({}, '', url.toString());
				// Load indications in background
				loadDrugIndications(fullDrug.id);
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
	<title>{selectedDrug ? selectedDrug.name : 'Gyógyszer Adatbázis'} | Doctor App</title>
</svelte:head>

<div class="min-h-screen bg-slate-950">
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
	<main class="max-w-7xl mx-auto px-4 py-6">
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
							{#if selectedDrug.brandName && selectedDrug.brandName !== selectedDrug.name}
								<p class="text-slate-400 mt-1">{selectedDrug.brandName}</p>
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

				<!-- Tabs -->
				<div class="border-b border-slate-800">
					<nav class="flex overflow-x-auto">
						<button
							type="button"
							class="flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'basic'
									? 'text-blue-400 border-blue-500 bg-blue-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => activeTab = 'basic'}
						>
							<Info class="h-4 w-4" />
							Alapadatok
						</button>
						<button
							type="button"
							class="flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'dosage'
									? 'text-blue-400 border-blue-500 bg-blue-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => activeTab = 'dosage'}
						>
							<Pill class="h-4 w-4" />
							Adagolás
						</button>
						<button
							type="button"
							class="flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'packaging'
									? 'text-blue-400 border-blue-500 bg-blue-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => activeTab = 'packaging'}
						>
							<Package class="h-4 w-4" />
							Kiszerelés
						</button>
						<button
							type="button"
							class="flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'regulatory'
									? 'text-blue-400 border-blue-500 bg-blue-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => activeTab = 'regulatory'}
						>
							<FileText class="h-4 w-4" />
							Szabályozás
						</button>
						<button
							type="button"
							class="flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'indications'
									? 'text-emerald-400 border-emerald-500 bg-emerald-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => activeTab = 'indications'}
						>
							<Stethoscope class="h-4 w-4" />
							Indikációk
							{#if drugIndications?.bnoCodes && drugIndications.bnoCodes.length > 0}
								<span class="px-1.5 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded">
									{drugIndications.bnoCodes.length}
								</span>
							{/if}
						</button>
						<button
							type="button"
							class="flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
								{activeTab === 'fda'
									? 'text-red-400 border-red-500 bg-red-500/5'
									: 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800/50'}"
							onclick={() => {
								activeTab = 'fda';
								if (selectedDrug && !fdaData && !fdaLoading) {
									loadFdaData(selectedDrug.name, selectedDrug.activeIngredient);
								}
							}}
						>
							<ShieldAlert class="h-4 w-4" />
							FDA Klinikai
							{#if fdaData?.found}
								<span class="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
									FDA
								</span>
							{/if}
						</button>
					</nav>
				</div>

				<!-- Tab Content -->
				<div class="p-6 relative overflow-hidden min-h-[200px]">
					{#key activeTab}
						<div in:fade={{ duration: 200, delay: 80 }} out:fade={{ duration: 80 }}>
					{#if activeTab === 'basic'}
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<!-- Hatóanyag -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<FlaskConical class="h-3.5 w-3.5" />
									<span>Hatóanyag</span>
								</div>
								<p class="text-base text-blue-400 font-semibold">{selectedDrug.activeIngredient || '-'}</p>
							</div>
							<!-- ATC kód -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<Tag class="h-3.5 w-3.5" />
									<span>ATC kód</span>
								</div>
								<p class="text-base text-white font-mono">{selectedDrug.atcCode || '-'}</p>
							</div>
							<!-- Beviteli mód -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<Info class="h-3.5 w-3.5" />
									<span>Beviteli mód</span>
								</div>
								<p class="text-base text-white">{getRouteLabel(selectedDrug.route)}</p>
							</div>
							<!-- Gyógyszerforma -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<Package class="h-3.5 w-3.5" />
									<span>Gyógyszerforma</span>
								</div>
								<p class="text-base text-white">{selectedDrug.form || '-'}</p>
							</div>
							<!-- Gyártó -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<Building2 class="h-3.5 w-3.5" />
									<span>Gyártó</span>
								</div>
								<p class="text-base text-white">{selectedDrug.manufacturer || '-'}</p>
							</div>
							<!-- Alap név -->
							{#if selectedDrug.baseName}
								<div>
									<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
										<Pill class="h-3.5 w-3.5" />
										<span>Alap név</span>
									</div>
									<p class="text-base text-white">{selectedDrug.baseName}</p>
								</div>
							{/if}
						</div>
					{:else if activeTab === 'dosage'}
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<!-- Dózis -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<Pill class="h-3.5 w-3.5" />
									<span>Dózis</span>
								</div>
								<p class="text-xl text-blue-400 font-semibold">{selectedDrug.dosage || '-'}</p>
							</div>
							<!-- DDD -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<Calendar class="h-3.5 w-3.5" />
									<span>DDD (Napi dózis)</span>
								</div>
								<p class="text-base text-white">{formatDDD(selectedDrug.ddd)}</p>
							</div>
							<!-- Beviteli mód -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<Info class="h-3.5 w-3.5" />
									<span>Beviteli mód</span>
								</div>
								<p class="text-base text-white">{getRouteLabel(selectedDrug.route)}</p>
							</div>
							<!-- Gyógyszerforma -->
							{#if selectedDrug.form}
								<div>
									<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
										<Package class="h-3.5 w-3.5" />
										<span>Gyógyszerforma</span>
									</div>
									<p class="text-base text-white">{selectedDrug.form}</p>
								</div>
							{/if}
						</div>
					{:else if activeTab === 'packaging'}
						<div class="space-y-6">
							{#if selectedDrug.packSizes && selectedDrug.packSizes.length > 0}
								<div>
									<h3 class="text-sm font-medium text-slate-400 mb-3">Elérhető kiszerelések ({selectedDrug.packSizes.length})</h3>
									<div class="flex flex-wrap gap-2">
										{#each selectedDrug.packSizes as packSize}
											<span class="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300">
												{packSize}
											</span>
										{/each}
									</div>
								</div>
							{:else if selectedDrug.packSize}
								<div>
									<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
										<Package class="h-3.5 w-3.5" />
										<span>Kiszerelés</span>
									</div>
									<p class="text-base text-white">{selectedDrug.packSize}</p>
								</div>
							{/if}
							{#if selectedDrug.eanCode}
								<div>
									<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
										<Tag class="h-3.5 w-3.5" />
										<span>EAN kód</span>
									</div>
									<p class="text-base text-white font-mono">{selectedDrug.eanCode}</p>
								</div>
							{/if}
							{#if selectedDrug.productCode}
								<div>
									<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
										<Tag class="h-3.5 w-3.5" />
										<span>Termékkód</span>
									</div>
									<p class="text-base text-white font-mono">{selectedDrug.productCode}</p>
								</div>
							{/if}
						</div>
					{:else if activeTab === 'regulatory'}
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							{#if selectedDrug.tttCode}
								<div>
									<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
										<Tag class="h-3.5 w-3.5" />
										<span>TTT kód</span>
									</div>
									<p class="text-base text-white font-mono">{selectedDrug.tttCode}</p>
								</div>
							{/if}
							{#if selectedDrug.tttCodes && selectedDrug.tttCodes.length > 1}
								<div class="md:col-span-2">
									<h3 class="text-sm font-medium text-slate-400 mb-2">Összes TTT kód ({selectedDrug.tttCodes.length})</h3>
									<div class="flex flex-wrap gap-2">
										{#each selectedDrug.tttCodes as code}
											<span class="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs font-mono text-slate-300">
												{code}
											</span>
										{/each}
									</div>
								</div>
							{/if}
							<!-- Vénykötelesség -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<FileText class="h-3.5 w-3.5" />
									<span>Vénykötelesség</span>
								</div>
								<p class="text-base text-white">{getPrescriptionLabel(selectedDrug.prescriptionRequired)}</p>
							</div>
							<!-- Forgalmazási státusz -->
							<div>
								<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
									<CheckCircle2 class="h-3.5 w-3.5" />
									<span>Forgalmazási státusz</span>
								</div>
								<p class="text-base text-white">{getMarketLabel(selectedDrug.inMarket)}</p>
							</div>
							{#if selectedDrug.validFrom}
								<div>
									<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
										<Calendar class="h-3.5 w-3.5" />
										<span>Érvényesség kezdete</span>
									</div>
									<p class="text-base text-white">{selectedDrug.validFrom}</p>
								</div>
							{/if}
							{#if selectedDrug.validUntil}
								<div>
									<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
										<Calendar class="h-3.5 w-3.5" />
										<span>Érvényesség vége</span>
									</div>
									<p class="text-base text-white">{selectedDrug.validUntil}</p>
								</div>
							{/if}
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
								<div class="text-center py-8">
									<div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-800 mb-3">
										<Stethoscope class="h-6 w-6 text-slate-500" />
									</div>
									<p class="text-slate-400">Ehhez a gyógyszerhez nem találhatók engedélyezett indikációk az adatbázisban.</p>
									<p class="text-xs text-slate-500 mt-2">Ez nem jelenti, hogy a gyógyszer nem használható - csak az EU támogatási rendszerben nincs bejegyezve.</p>
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
							{:else if fdaData?.found && fdaData.label}
								<!-- FDA Data Header -->
								<div class="p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
									<div class="flex items-center gap-2 mb-2">
										<ShieldAlert class="h-5 w-5 text-red-400" />
										<span class="text-sm font-medium text-white">FDA Drug Label - USA</span>
									</div>
									<div class="text-xs text-slate-400">
										<p>Keresve: {fdaData.searchedBy === 'brand_name' ? 'márkanév' : 'hatóanyag'}</p>
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
									<div class="border-2 border-red-500 rounded-lg overflow-hidden">
										<div class="px-4 py-2 bg-red-500/20 border-b border-red-500 flex items-center gap-2">
											<Ban class="h-5 w-5 text-red-400" />
											<span class="font-semibold text-red-400">BOXED WARNING (Fekete dobozos figyelmeztetés)</span>
										</div>
										<div class="p-4 bg-red-500/5">
											<p class="text-sm text-red-300 whitespace-pre-wrap leading-relaxed">{fdaData.label.boxedWarning}</p>
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

								<!-- Special Populations (collapsible) -->
								{#if fdaData.label.pregnancy || fdaData.label.pediatricUse || fdaData.label.geriatricUse}
									<details class="border border-slate-600 rounded-lg overflow-hidden">
										<summary class="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex items-center gap-2 cursor-pointer hover:bg-slate-700/70">
											<Info class="h-4 w-4 text-slate-400" />
											<span class="font-medium text-slate-300">Speciális populációk</span>
											<span class="ml-auto text-xs text-slate-500">kattintson a kibontáshoz</span>
										</summary>
										<div class="p-4 bg-slate-800/30 space-y-4 max-h-96 overflow-y-auto">
											{#if fdaData.label.pregnancy}
												<FdaContentDisplay
													content={fdaData.label.pregnancy}
													title="Terhesség"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.pediatricUse}
												<FdaContentDisplay
													content={fdaData.label.pediatricUse}
													title="Gyermekek"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
											{#if fdaData.label.geriatricUse}
												<FdaContentDisplay
													content={fdaData.label.geriatricUse}
													title="Idősek"
													variant="info"
													compact
													showStats={false}
													maxHeight="200px"
												/>
											{/if}
										</div>
									</details>
								{/if}

								<!-- Disclaimer -->
								<div class="text-xs text-slate-500 border-t border-slate-800 pt-4">
									<p>Adatforrás: U.S. Food and Drug Administration (FDA) drug labeling database. Az információ amerikai gyógyszercímkéből származik és a magyar előírások eltérhetnek. Mindig konzultáljon az aktuális magyarországi betegtájékoztatóval.</p>
								</div>
							{:else if fdaData && !fdaData.found}
								<!-- FDA Not Found -->
								<div class="text-center py-8">
									<div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-800 mb-3">
										<ShieldAlert class="h-6 w-6 text-slate-500" />
									</div>
									<p class="text-slate-400">Az FDA adatbázisban nem található ez a gyógyszer.</p>
									<p class="text-xs text-slate-500 mt-2">
										Az FDA adatbázis amerikai gyógyszereket tartalmaz.
										Európai/magyar gyógyszerek nem mindig találhatók meg.
									</p>
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
										onclick={() => selectedDrug && loadFdaData(selectedDrug.name, selectedDrug.activeIngredient)}
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
</div>

<!-- Drug Info Modal -->
<DrugInfoModal
	drug={modalDrug}
	open={showInfoModal}
	onClose={closeInfoModal}
/>

<style>
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
</style>
