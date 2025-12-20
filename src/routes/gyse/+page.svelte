<script lang="ts">
	/**
	 * GYSE (Gyógyászati Segédeszközök) Browser Page
	 *
	 * Hungarian Medical Aids Database from NEAK
	 * Contains 3,309 items: wheelchairs, prosthetics, glucose meters, etc.
	 */

	import { onMount } from 'svelte';
	import { gyseService, type GyseItem } from '$lib/services/gyse-database-service';
	import {
		Search,
		ArrowLeft,
		Accessibility,
		Package,
		Building2,
		Tag,
		Banknote,
		CheckCircle2,
		XCircle,
		Loader2,
		X,
		Filter
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { fade, slide } from 'svelte/transition';

	// State
	let searchQuery = $state('');
	let results = $state<GyseItem[]>([]);
	let selectedItem = $state<GyseItem | null>(null);
	let isLoading = $state(false);
	let isInitialized = $state(false);
	let totalItems = $state(0);
	let inMarketCount = $state(0);
	let searchTimeMs = $state(0);
	let showFilters = $state(false);
	let filterInMarket = $state(false);

	// Debounce timer
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(async () => {
		try {
			await gyseService.initialize();
			const stats = await gyseService.getStatistics();
			totalItems = stats.totalItems;
			inMarketCount = stats.inMarket;
			isInitialized = true;
		} catch (error) {
			console.error('[GYSE] Failed to initialize:', error);
		}
	});

	async function performSearch(query: string) {
		if (!query || query.length < 2) {
			results = [];
			return;
		}

		const startTime = performance.now();
		isLoading = true;

		try {
			results = await gyseService.search(query, {
				limit: 50,
				inMarketOnly: filterInMarket
			});
		} catch (error) {
			console.error('[GYSE] Search error:', error);
			results = [];
		}

		searchTimeMs = Math.round(performance.now() - startTime);
		isLoading = false;
	}

	function debouncedSearch(query: string) {
		if (debounceTimer) clearTimeout(debounceTimer);

		if (!query || query.length < 2) {
			results = [];
			isLoading = false;
			return;
		}

		isLoading = true;
		debounceTimer = setTimeout(() => {
			performSearch(query);
		}, 150);
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;
		selectedItem = null;
		debouncedSearch(searchQuery);
	}

	function selectItem(item: GyseItem) {
		selectedItem = item;
		results = [];
	}

	function clearSelection() {
		selectedItem = null;
		searchQuery = '';
		results = [];
	}

	function handleBack() {
		goto('/');
	}

	function formatPrice(price: number): string {
		return price.toLocaleString('hu-HU') + ' Ft';
	}
</script>

<svelte:head>
	<title>GYSE Adatbázis | neuratos workstation</title>
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
					<h1 class="text-xl font-semibold text-white flex items-center gap-2">
						<Accessibility class="h-5 w-5 text-cyan-400" />
						GYSE Adatbázis
					</h1>
					<p class="text-sm text-slate-400">
						Gyógyászati Segédeszközök - NEAK ({totalItems.toLocaleString('hu-HU')} tétel)
					</p>
				</div>

				<button
					type="button"
					class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
					onclick={() => (showFilters = !showFilters)}
				>
					<Filter class="h-4 w-4" />
					<span class="text-sm">Szűrők</span>
				</button>
			</div>

			<!-- Search Input -->
			<div class="mt-4 relative">
				<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
					{#if isLoading}
						<Loader2 class="h-5 w-5 text-slate-400 animate-spin" />
					{:else}
						<Search class="h-5 w-5 text-slate-400" />
					{/if}
				</div>

				<input
					type="text"
					value={searchQuery}
					placeholder="Keresés név, ISO kód vagy TTT kód alapján..."
					autocomplete="off"
					spellcheck="false"
					class="w-full pl-10 pr-10 py-3 bg-slate-800/50 border border-slate-600 rounded-lg
						text-white placeholder-slate-400
						focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent
						transition-all duration-200"
					oninput={handleInput}
				/>

				{#if searchQuery}
					<button
						type="button"
						class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
						onclick={() => {
							searchQuery = '';
							results = [];
						}}
					>
						<X class="h-5 w-5" />
					</button>
				{/if}
			</div>

			<!-- Filters Panel -->
			{#if showFilters}
				<div
					class="mt-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700"
					transition:slide={{ duration: 200 }}
				>
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							bind:checked={filterInMarket}
							onchange={() => debouncedSearch(searchQuery)}
							class="w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
						/>
						<span class="text-sm text-slate-300">Csak forgalomban lévők</span>
					</label>
				</div>
			{/if}

			<!-- Status Bar -->
			{#if isInitialized && !selectedItem && results.length === 0 && searchQuery.length < 2}
				<div class="mt-2 text-xs text-slate-500 flex items-center gap-2">
					<Accessibility class="h-3 w-3" />
					<span>{totalItems.toLocaleString('hu-HU')} segédeszköz</span>
					<span class="text-slate-600">|</span>
					<span class="text-emerald-500">{inMarketCount.toLocaleString('hu-HU')} forgalomban</span>
				</div>
			{/if}
		</div>
	</header>

	<!-- Main Content -->
	<main class="max-w-7xl mx-auto px-4 py-6">
		<!-- Search Results -->
		{#if results.length > 0}
			<div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden" transition:fade={{ duration: 150 }}>
				<div class="px-4 py-2 bg-slate-800/50 border-b border-slate-700 flex justify-between text-xs text-slate-400">
					<span>{results.length} találat</span>
					<span>{searchTimeMs}ms</span>
				</div>
				<ul class="max-h-[60vh] overflow-y-auto divide-y divide-slate-800">
					{#each results as item (item.id)}
						<li>
							<button
								type="button"
								class="w-full px-4 py-3 text-left hover:bg-slate-800/50 transition-colors"
								onclick={() => selectItem(item)}
							>
								<div class="flex items-start justify-between gap-3">
									<div class="flex-1 min-w-0">
										<div class="font-medium text-white truncate">{item.name}</div>
										<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
											{#if item.isoCode}
												<span class="font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded">
													{item.isoCode}
												</span>
											{/if}
											{#if item.packSize}
												<span>· {item.packSize}</span>
											{/if}
										</div>
									</div>
									<div class="flex flex-col items-end gap-1">
										<span
											class="px-2 py-0.5 text-xs font-medium rounded border
												{item.inMarket
												? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
												: 'bg-amber-500/20 text-amber-400 border-amber-500/30'}"
										>
											{item.inMarket ? 'Forgalomban' : 'Kivont'}
										</span>
										{#if item.supportPercent > 0}
											<span class="text-xs text-cyan-400">{item.supportPercent}% TB</span>
										{/if}
									</div>
								</div>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- Selected Item Details -->
		{#if selectedItem}
			<div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden" transition:fade={{ duration: 200 }}>
				<!-- Header -->
				<div class="px-6 py-5 border-b border-slate-800 bg-slate-800/30">
					<div class="flex items-start justify-between gap-4">
						<div class="flex-1 min-w-0">
							<h2 class="text-2xl font-bold text-white">{selectedItem.name}</h2>
							{#if selectedItem.brandName}
								<p class="text-slate-400 mt-1">{selectedItem.brandName}</p>
							{/if}

							<!-- Status Badges -->
							<div class="flex flex-wrap gap-2 mt-3">
								<span
									class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border
										{selectedItem.inMarket
										? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
										: 'bg-amber-500/20 text-amber-400 border-amber-500/30'}"
								>
									{#if selectedItem.inMarket}
										<CheckCircle2 class="h-3 w-3" />
									{:else}
										<XCircle class="h-3 w-3" />
									{/if}
									{selectedItem.inMarket ? 'Forgalomban' : 'Forgalomból kivont'}
								</span>
								{#if selectedItem.supportPercent > 0}
									<span
										class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
									>
										{selectedItem.supportPercent}% TB támogatás
									</span>
								{/if}
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

				<!-- Details Grid -->
				<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
					<!-- Identification -->
					<div>
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
							<Tag class="h-3.5 w-3.5" />
							<span>TTT kód</span>
						</div>
						<p class="text-base text-white font-mono">{selectedItem.tttCode || '-'}</p>
					</div>

					<div>
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
							<Tag class="h-3.5 w-3.5" />
							<span>ISO kód</span>
						</div>
						<p class="text-base text-white font-mono">{selectedItem.isoCode || '-'}</p>
					</div>

					<div>
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
							<Package class="h-3.5 w-3.5" />
							<span>Kiszerelés</span>
						</div>
						<p class="text-base text-white">{selectedItem.packSize || '-'}</p>
					</div>

					<div>
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
							<Building2 class="h-3.5 w-3.5" />
							<span>Gyártó</span>
						</div>
						<p class="text-base text-white">{selectedItem.manufacturer || '-'}</p>
					</div>

					{#if selectedItem.distributor}
						<div>
							<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
								<Building2 class="h-3.5 w-3.5" />
								<span>Forgalmazó</span>
							</div>
							<p class="text-base text-white">{selectedItem.distributor}</p>
						</div>
					{/if}

					<!-- Pricing Section -->
					<div class="md:col-span-2 pt-4 border-t border-slate-800">
						<h3 class="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
							<Banknote class="h-4 w-4" />
							Árképzés és támogatás
						</h3>
						<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
							<div class="p-3 bg-slate-800/50 rounded-lg">
								<div class="text-xs text-slate-500">Bruttó ár</div>
								<div class="text-lg font-semibold text-white">{formatPrice(selectedItem.grossPrice)}</div>
							</div>
							<div class="p-3 bg-slate-800/50 rounded-lg">
								<div class="text-xs text-slate-500">Nettó ár</div>
								<div class="text-lg font-semibold text-white">{formatPrice(selectedItem.netPrice)}</div>
							</div>
							<div class="p-3 bg-cyan-900/30 rounded-lg border border-cyan-500/30">
								<div class="text-xs text-cyan-400">TB támogatás</div>
								<div class="text-lg font-semibold text-cyan-300">{selectedItem.supportPercent}%</div>
							</div>
							<div class="p-3 bg-slate-800/50 rounded-lg">
								<div class="text-xs text-slate-500">Térítési díj</div>
								<div class="text-lg font-semibold text-white">{formatPrice(selectedItem.patientFee)}</div>
							</div>
						</div>
					</div>

					<!-- EU Support if available -->
					{#if selectedItem.euSupportPercent > 0}
						<div class="md:col-span-2 pt-4 border-t border-slate-800">
							<h3 class="text-sm font-medium text-slate-400 mb-3">EU támogatás</h3>
							<div class="grid grid-cols-2 md:grid-cols-3 gap-4">
								<div class="p-3 bg-blue-900/30 rounded-lg border border-blue-500/30">
									<div class="text-xs text-blue-400">EU támogatás</div>
									<div class="text-lg font-semibold text-blue-300">{selectedItem.euSupportPercent}%</div>
								</div>
								<div class="p-3 bg-slate-800/50 rounded-lg">
									<div class="text-xs text-slate-500">EU térítési díj</div>
									<div class="text-lg font-semibold text-white">{formatPrice(selectedItem.euPatientFee)}</div>
								</div>
								{#if selectedItem.euPoints}
									<div class="p-3 bg-slate-800/50 rounded-lg">
										<div class="text-xs text-slate-500">EU pontok</div>
										<div class="text-lg font-semibold text-white">{selectedItem.euPoints}</div>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Empty State -->
		{#if !selectedItem && results.length === 0 && searchQuery.length < 2}
			<div class="text-center py-20">
				<div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 mb-4">
					<Search class="h-8 w-8 text-slate-500" />
				</div>
				<h2 class="text-xl font-semibold text-white mb-2">Keressen egy segédeszközt</h2>
				<p class="text-slate-400 max-w-md mx-auto">
					Keresés név, ISO kód vagy TTT kód alapján a teljes NEAK GYSE adatbázisban.
				</p>

				<!-- Quick Categories -->
				<div class="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
					<div class="p-4 bg-slate-900/50 rounded-lg border border-slate-800">
						<h4 class="font-medium text-white mb-2">Mozgáskorlátozottak</h4>
						<p class="text-sm text-slate-400">Kerekesszékek, járókeretek, protézisek</p>
					</div>
					<div class="p-4 bg-slate-900/50 rounded-lg border border-slate-800">
						<h4 class="font-medium text-white mb-2">Diagnosztika</h4>
						<p class="text-sm text-slate-400">Vércukormérők, vérnyomásmérők</p>
					</div>
					<div class="p-4 bg-slate-900/50 rounded-lg border border-slate-800">
						<h4 class="font-medium text-white mb-2">Egyéb eszközök</h4>
						<p class="text-sm text-slate-400">Hallókészülékek, inkontinencia termékek</p>
					</div>
				</div>
			</div>
		{/if}

		<!-- No Results -->
		{#if !isLoading && searchQuery.length >= 2 && results.length === 0 && !selectedItem}
			<div class="text-center py-12">
				<p class="text-slate-400">Nincs találat: "{searchQuery}"</p>
				<p class="text-slate-500 text-sm mt-2">Próbáljon ISO kódra vagy TTT kódra keresni</p>
			</div>
		{/if}
	</main>
</div>
