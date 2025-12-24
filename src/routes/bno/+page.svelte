<script lang="ts">
	/**
	 * BNO (ICD-10) Code Lookup Page
	 *
	 * Hungarian ICD-10 diagnosis codes database from NEAK
	 * Contains 23,664 codes covering all disease classifications
	 * Now with configurable disease group checklists
	 */

	import { onMount } from 'svelte';
	import {
		bnoService,
		BNO_CHAPTERS,
		MS_BNO_CODES,
		type BnoCode
	} from '$lib/services/bno-database-service';
	import { indicationService, type BnoDrugEntry } from '$lib/services/indication-service';
	import { szervrendszerService, type OrganSystem } from '$lib/services/szervrendszer-service';
	import SzervrendszerBrowser from '$lib/components/ui/SzervrendszerBrowser.svelte';
	import {
		Search,
		ArrowLeft,
		FileText,
		Tag,
		Loader2,
		X,
		BookOpen,
		Brain,
		Copy,
		Check,
		Pill,
		ExternalLink,
		AlertCircle,
		Activity,
		ChevronDown,
		ChevronUp,
		ArrowDownCircle
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { fade, slide } from 'svelte/transition';

	// State
	let searchQuery = $state('');
	let results = $state<BnoCode[]>([]);
	let selectedCode = $state<BnoCode | null>(null);
	let isLoading = $state(false);
	let isInitialized = $state(false);
	let totalCodes = $state(0);
	let searchTimeMs = $state(0);
	let showChapters = $state(false);
	let copiedCode = $state<string | null>(null);

	// Drugs for BNO state
	let drugsForBno = $state<BnoDrugEntry | null>(null);
	let drugsLoading = $state(false);

	// Szervrendszer filter state
	let activeSystemFilter = $state<{ systemId: string; subgroupId?: string } | null>(null);
	let systemFilteredResults = $state<BnoCode[]>([]);
	let systemFilterLoading = $state(false);
	let showSzervrendszerFilter = $state(false); // Collapsed by default for mobile

	// Debounce timer
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(async () => {
		try {
			await bnoService.initialize();
			const stats = await bnoService.getStatistics();
			totalCodes = stats.totalCodes;
			isInitialized = true;
		} catch (error) {
			console.error('[BNO] Failed to initialize:', error);
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
			results = await bnoService.search(query, { limit: 50 });
		} catch (error) {
			console.error('[BNO] Search error:', error);
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
		selectedCode = null;
		debouncedSearch(searchQuery);
	}

	async function loadDrugsForBno(bnoCode: string) {
		drugsLoading = true;
		drugsForBno = null;
		try {
			drugsForBno = await indicationService.getDrugsForBno(bnoCode);
		} catch (error) {
			console.error('[BNO] Failed to load drugs:', error);
			drugsForBno = null;
		}
		drugsLoading = false;
	}

	function selectCode(code: BnoCode) {
		selectedCode = code;
		results = [];
		// Load drugs for this BNO code
		loadDrugsForBno(code.code);
	}

	function clearSelection() {
		selectedCode = null;
		searchQuery = '';
		results = [];
		drugsForBno = null;
	}

	function handleBack() {
		goto('/');
	}

	async function copyToClipboard(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			copiedCode = code;
			setTimeout(() => {
				copiedCode = null;
			}, 2000);
		} catch (error) {
			console.error('Failed to copy:', error);
		}
	}

	function selectMsCode(ms: (typeof MS_BNO_CODES)[0]) {
		searchQuery = ms.code;
		performSearch(ms.code);
	}

	async function handleSystemFilter(systemId: string, subgroupId?: string) {
		activeSystemFilter = { systemId, subgroupId };
		systemFilterLoading = true;
		systemFilteredResults = [];

		try {
			if (subgroupId) {
				// Filter by subgroup
				systemFilteredResults = await szervrendszerService.getCodesForSubgroup(systemId, subgroupId);
			} else {
				// Filter by entire system (limited to first 100 for performance)
				const codes = await szervrendszerService.getCodesForOrganSystem(systemId);
				systemFilteredResults = codes.slice(0, 100);
			}
		} catch (error) {
			console.error('[BNO] System filter error:', error);
			systemFilteredResults = [];
		}

		systemFilterLoading = false;
	}

	function clearSystemFilter() {
		activeSystemFilter = null;
		systemFilteredResults = [];
	}
</script>

<svelte:head>
	<title>BNO Kódok | neuratos workstation</title>
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
						<FileText class="h-5 w-5 text-emerald-400" />
						BNO Kódok
					</h1>
					<p class="text-sm text-slate-400">
						ICD-10 diagnózis kódok ({totalCodes.toLocaleString('hu-HU')} kód)
					</p>
				</div>

				<div class="flex items-center gap-2">
					<button
						type="button"
						class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
						onclick={() => (showChapters = !showChapters)}
					>
						<BookOpen class="h-4 w-4" />
						<span class="text-sm">Fejezetek</span>
					</button>
				</div>
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
					placeholder="Keresés BNO kód vagy diagnózis alapján..."
					autocomplete="off"
					spellcheck="false"
					class="w-full pl-10 pr-10 py-3 bg-slate-800/50 border border-slate-600 rounded-lg
						text-white placeholder-slate-400
						focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent
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

			<!-- Chapters Panel -->
			{#if showChapters}
				<div
					class="mt-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700 max-h-64 overflow-y-auto"
					transition:slide={{ duration: 200 }}
				>
					<h3 class="text-sm font-medium text-slate-400 mb-3">BNO-10 Fejezetek</h3>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
						{#each Object.entries(BNO_CHAPTERS) as [code, description]}
							<button
								type="button"
								class="text-left p-2 rounded hover:bg-slate-700/50 text-slate-300 truncate"
								onclick={() => {
									searchQuery = code;
									performSearch(code);
									showChapters = false;
								}}
							>
								<span class="font-mono text-emerald-400">{code}</span>
								<span class="text-slate-400 ml-2">{description.split('(')[0]}</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Status Bar -->
			{#if isInitialized && !selectedCode && results.length === 0 && searchQuery.length < 2}
				<div class="mt-2 text-xs text-slate-500 flex items-center gap-2">
					<FileText class="h-3 w-3" />
					<span>{totalCodes.toLocaleString('hu-HU')} BNO kód (ICD-10 HU)</span>
				</div>
			{/if}
		</div>
	</header>

	<!-- Main Content -->
	<main class="max-w-7xl mx-auto px-4 py-6">
		<!-- Search Results -->
		{#if results.length > 0}
			<div
				class="rounded-xl overflow-hidden"
				style="
					background: linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%);
					border: 1px solid rgba(100, 116, 139, 0.3);
					box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.3);
				"
				transition:fade={{ duration: 150 }}
			>
				<div
					class="px-4 py-2.5 border-b border-slate-700/50 flex justify-between items-center"
					style="background: rgba(30, 41, 59, 0.6);"
				>
					<span class="text-xs font-semibold text-slate-300">{results.length} találat</span>
					<span class="text-xs text-slate-500 font-mono">{searchTimeMs}ms</span>
				</div>
				<ul class="max-h-[60vh] overflow-y-auto">
					{#each results as code, i (code.id)}
						<li
							role="button"
							tabindex="0"
							class="bno-result-item w-full px-4 py-3.5 text-left transition-all duration-150 cursor-pointer"
							style="
								background: {i % 2 === 0 ? 'rgba(30, 41, 59, 0.3)' : 'transparent'};
								border-bottom: 1px solid rgba(100, 116, 139, 0.15);
							"
							onclick={() => selectCode(code)}
							onkeydown={(e) => e.key === 'Enter' && selectCode(code)}
						>
							<div class="flex items-start justify-between gap-3">
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<span class="font-mono text-emerald-400 bg-emerald-500/15 px-2.5 py-1 rounded-lg text-sm font-semibold border border-emerald-500/30">
											{code.code}
										</span>
										<span class="text-xs text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded-lg border border-slate-600/30">
											{bnoService.getChapterInfo(code.chapter).split('(')[0].trim()}
										</span>
									</div>
									<div class="mt-2 text-sm text-slate-200 line-clamp-2 leading-relaxed">
										{code.description}
									</div>
								</div>
								<button
									type="button"
									class="p-2 rounded-lg hover:bg-slate-700/80 text-slate-400 hover:text-emerald-400 transition-all duration-150"
									onclick={(e) => {
										e.stopPropagation();
										copyToClipboard(code.code);
									}}
									title="Kód másolása"
								>
									{#if copiedCode === code.code}
										<Check class="h-4 w-4 text-emerald-400" />
									{:else}
										<Copy class="h-4 w-4" />
									{/if}
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- Selected Code Details -->
		{#if selectedCode}
			<div
				class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden"
				transition:fade={{ duration: 200 }}
			>
				<div class="px-6 py-5 border-b border-slate-800 bg-slate-800/30">
					<div class="flex items-start justify-between gap-4">
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-3">
								<span
									class="text-2xl font-mono font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-lg"
								>
									{selectedCode.code}
								</span>
								<button
									type="button"
									class="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-emerald-400 transition-colors"
									onclick={() => copyToClipboard(selectedCode!.code)}
									title="Kód másolása"
								>
									{#if copiedCode === selectedCode.code}
										<Check class="h-5 w-5 text-emerald-400" />
									{:else}
										<Copy class="h-5 w-5" />
									{/if}
								</button>
							</div>
							<h2 class="text-xl font-semibold text-white mt-3">{selectedCode.description}</h2>
							<p class="text-sm text-slate-400 mt-2">
								{bnoService.getChapterInfo(selectedCode.chapter)}
							</p>
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

				<div class="p-6 space-y-6">
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="p-4 bg-slate-800/50 rounded-lg">
							<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
								<Tag class="h-3.5 w-3.5" />
								<span>Fejezet</span>
							</div>
							<p class="text-base text-white">{selectedCode.chapter}</p>
						</div>
						<div class="p-4 bg-slate-800/50 rounded-lg">
							<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
								<FileText class="h-3.5 w-3.5" />
								<span>Kód hossza</span>
							</div>
							<p class="text-base text-white">{selectedCode.code.length} karakter</p>
						</div>
					</div>

					<!-- Drugs for this BNO Code -->
					<div class="border-t border-slate-800 pt-6">
						<h3 class="text-sm font-medium text-slate-400 mb-4 flex items-center gap-2">
							<Pill class="h-4 w-4 text-blue-400" />
							Engedélyezett gyógyszerek ehhez az indikációhoz
						</h3>

						{#if drugsLoading}
							<div class="flex items-center gap-3 py-4">
								<Loader2 class="h-5 w-5 animate-spin text-blue-500" />
								<span class="text-slate-400">Gyógyszerek keresése...</span>
							</div>
						{:else if drugsForBno && drugsForBno.drugs.length > 0}
							<div class="space-y-2">
								<p class="text-xs text-slate-500 mb-3">
									{drugsForBno.drugs.length} gyógyszer található ehhez a diagnózishoz
								</p>
								<div class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-2">
									{#each drugsForBno.drugs as drug}
										<a
											href="/drugs?id={drug.drugId}"
											class="flex items-center justify-between gap-3 p-3 bg-slate-800/50 border rounded-lg transition-colors
												{drug.offLabel
													? 'border-amber-500/30 hover:bg-amber-500/10'
													: 'border-slate-700 hover:bg-slate-800'}"
										>
											<div class="flex-1 min-w-0">
												<p class="text-sm text-white font-medium truncate">{drug.drugName}</p>
												<p class="text-xs text-slate-500 font-mono">{drug.tttCode}</p>
												{#if drug.offLabel}
													<span class="inline-flex items-center gap-1 mt-1 text-xs text-amber-400">
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
						{:else}
							<div class="text-center py-6">
								<div class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-800 mb-2">
									<Pill class="h-5 w-5 text-slate-500" />
								</div>
								<p class="text-sm text-slate-400">
									Ehhez a BNO kódhoz nem tartozik engedélyezett gyógyszer az NEAK adatbázisban.
								</p>
								<p class="text-xs text-slate-500 mt-1">
									Ez nem jelenti, hogy nincs kezelési lehetőség - csak az EU támogatási rendszerben nincs bejegyzés.
								</p>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- Empty State -->
		{#if !selectedCode && results.length === 0 && searchQuery.length < 2}
			<div class="space-y-8">
				<!-- Szervrendszer Browser - Collapsible -->
				<div class="bg-slate-900/50 rounded-xl border border-slate-800 overflow-hidden">
					<button
						type="button"
						class="w-full flex items-center justify-between p-4 hover:bg-slate-800/30 transition-colors"
						onclick={() => showSzervrendszerFilter = !showSzervrendszerFilter}
					>
						<h3 class="text-sm font-medium text-slate-400 flex items-center gap-2">
							<Activity class="h-4 w-4 text-violet-400" />
							Szervrendszer szerinti szűrés
							{#if activeSystemFilter}
								<span class="px-2 py-0.5 text-xs bg-violet-500/20 text-violet-400 rounded-full">
									Aktív
								</span>
							{/if}
						</h3>
						{#if showSzervrendszerFilter}
							<ChevronUp class="h-5 w-5 text-slate-400" />
						{:else}
							<ChevronDown class="h-5 w-5 text-slate-400" />
						{/if}
					</button>
					{#if showSzervrendszerFilter}
						<div class="p-4 pt-0 border-t border-slate-800" transition:slide={{ duration: 200 }}>
							<SzervrendszerBrowser
								onSystemFilter={handleSystemFilter}
								onClearFilter={clearSystemFilter}
								selectedSystemId={activeSystemFilter?.systemId ?? null}
								showDrugCounts={true}
							/>
						</div>
					{/if}
				</div>

				<!-- Visual cue pointing to results -->
				{#if activeSystemFilter && systemFilteredResults.length > 0}
					<div class="flex justify-center -my-2 relative z-10" transition:fade={{ duration: 150 }}>
						<div class="flex flex-col items-center text-violet-400 animate-bounce">
							<span class="text-xs font-medium mb-1">Találatok lent</span>
							<ArrowDownCircle class="h-6 w-6" />
						</div>
					</div>
				{/if}

				<!-- System Filtered Results -->
				{#if activeSystemFilter}
					<div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden" transition:slide={{ duration: 200 }}>
						<div class="px-4 py-2 bg-slate-800/50 border-b border-slate-700 flex justify-between items-center">
							<span class="text-xs text-slate-400">
								{#if systemFilterLoading}
									<Loader2 class="h-3 w-3 animate-spin inline mr-1" />
									Kódok betöltése...
								{:else}
									{systemFilteredResults.length} kód ebben a szervrendszerben
								{/if}
							</span>
							<button
								type="button"
								class="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
								onclick={clearSystemFilter}
							>
								<X class="h-3 w-3" />
								Szűrő törlése
							</button>
						</div>
						{#if !systemFilterLoading && systemFilteredResults.length > 0}
							<ul class="max-h-[40vh] overflow-y-auto divide-y divide-slate-800">
								{#each systemFilteredResults as code (code.id)}
									<li
										role="button"
										tabindex="0"
										class="w-full px-4 py-3 text-left hover:bg-slate-800/50 transition-colors cursor-pointer"
										onclick={() => selectCode(code)}
										onkeydown={(e) => e.key === 'Enter' && selectCode(code)}
									>
										<div class="flex items-start justify-between gap-3">
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2">
													<span class="font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
														{code.code}
													</span>
												</div>
												<div class="mt-1 text-sm text-slate-300 line-clamp-2">
													{code.description}
												</div>
											</div>
											<button
												type="button"
												class="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-emerald-400 transition-colors"
												onclick={(e) => {
													e.stopPropagation();
													copyToClipboard(code.code);
												}}
												title="Kód másolása"
											>
												{#if copiedCode === code.code}
													<Check class="h-4 w-4 text-emerald-400" />
												{:else}
													<Copy class="h-4 w-4" />
												{/if}
											</button>
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}

				<!-- General Empty State -->
				{#if !activeSystemFilter}
					<div class="text-center py-8">
						<div
							class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-800 mb-3"
						>
							<Search class="h-6 w-6 text-slate-500" />
						</div>
						<h2 class="text-lg font-semibold text-white mb-1">Keressen egy BNO kódot</h2>
						<p class="text-sm text-slate-400 max-w-md mx-auto">
							Keresés BNO kód vagy diagnózis szöveg alapján, vagy szűrjön szervrendszer szerint.
						</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- No Results -->
		{#if !isLoading && searchQuery.length >= 2 && results.length === 0 && !selectedCode}
			<div class="text-center py-12">
				<p class="text-slate-400">Nincs találat: "{searchQuery}"</p>
				<p class="text-slate-500 text-sm mt-2">Próbáljon BNO kódra vagy diagnózis szövegre keresni</p>
			</div>
		{/if}
	</main>
</div>

<style>
	/* Galaxy Brutalist BNO Result Items */
	:global(.bno-result-item:hover) {
		background: rgba(59, 130, 246, 0.1) !important;
		transform: translateX(4px);
	}

	:global(.bno-result-item:focus) {
		outline: 2px solid rgba(59, 130, 246, 0.5);
		outline-offset: -2px;
		background: rgba(59, 130, 246, 0.1) !important;
	}
</style>
