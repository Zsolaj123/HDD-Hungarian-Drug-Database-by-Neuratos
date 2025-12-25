<script lang="ts">
	/**
	 * FdaContentDisplay.svelte
	 *
	 * Displays FDA drug label content with structured formatting:
	 * - Collapsible sections with numbered headers
	 * - Summary view with key points
	 * - Highlighted clinical values and drug names
	 * - Reading time indicator
	 * - Severity-based styling
	 */

	import {
		formatFdaContent,
		formatSectionContent,
		getFdaContentStats,
		type FormattedFdaContent,
		type FdaSection
	} from '$lib/utils/fda-text-formatter';
	import {
		ChevronDown,
		ChevronRight,
		ChevronUp,
		Clock,
		AlertTriangle,
		AlertCircle,
		Ban,
		Info,
		FileText,
		List,
		Search,
		X
	} from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { SvelteSet } from 'svelte/reactivity';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		content: string | null;
		title?: string;
		variant?: 'contraindication' | 'interaction' | 'warning' | 'info';
		compact?: boolean;
		maxHeight?: string;
		showStats?: boolean;
		defaultExpanded?: boolean;
	}

	let {
		content,
		title = '',
		variant = 'info',
		compact = false,
		maxHeight = '400px',
		showStats = true,
		defaultExpanded = false
	}: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let formatted = $derived(formatFdaContent(content));
	let stats = $derived(getFdaContentStats(content));
	// User override for view mode (null means use default from compact prop)
	let userViewMode = $state<'summary' | 'sections' | 'full' | null>(null);
	let viewMode = $derived(userViewMode ?? (compact ? 'summary' : 'sections'));
	let expandedSections = new SvelteSet<string>();

	// Search state
	let searchOpen = $state(false);
	let searchQuery = $state('');
	let currentMatchIndex = $state(0);
	let totalMatches = $state(0);
	let searchInputRef = $state<HTMLInputElement | null>(null);
	let contentContainerRef = $state<HTMLDivElement | null>(null);

	// Clinically important sections to expand by default
	const importantSections = [
		'boxed warning',
		'contraindications',
		'warnings',
		'precautions',
		'dosage',
		'drug interactions',
		'adverse reactions'
	];

	// Initialize expanded sections based on defaultExpanded OR smart defaults
	$effect(() => {
		if (formatted) {
			if (defaultExpanded) {
				// Expand all if defaultExpanded is true
				expandedSections.clear();
				for (const section of formatted.sections) {
					expandedSections.add(section.id);
				}
			} else {
				// Smart default: expand clinically important sections
				for (const section of formatted.sections) {
					const titleLower = section.title?.toLowerCase() || '';
					const isImportant = importantSections.some(s => titleLower.includes(s));
					if (isImportant) {
						expandedSections.add(section.id);
					}
				}
			}
		}
	});

	// ============================================================================
	// Variant Styles
	// ============================================================================

	const variantStyles = {
		contraindication: {
			border: 'border-red-500/40',
			bg: 'bg-red-500/5',
			headerBg: 'bg-red-500/10',
			accent: 'text-red-400',
			icon: Ban
		},
		interaction: {
			border: 'border-blue-500/40',
			bg: 'bg-blue-500/5',
			headerBg: 'bg-blue-500/10',
			accent: 'text-blue-400',
			icon: AlertCircle
		},
		warning: {
			border: 'border-amber-500/40',
			bg: 'bg-amber-500/5',
			headerBg: 'bg-amber-500/10',
			accent: 'text-amber-400',
			icon: AlertTriangle
		},
		info: {
			border: 'border-slate-600',
			bg: 'bg-slate-800/30',
			headerBg: 'bg-slate-700/50',
			accent: 'text-slate-400',
			icon: Info
		}
	};

	let style = $derived(variantStyles[variant]);

	// ============================================================================
	// Handlers
	// ============================================================================

	function toggleSection(sectionId: string) {
		if (expandedSections.has(sectionId)) {
			expandedSections.delete(sectionId);
		} else {
			expandedSections.add(sectionId);
		}
	}

	function expandAll() {
		if (formatted) {
			for (const section of formatted.sections) {
				expandedSections.add(section.id);
			}
		}
	}

	function collapseAll() {
		expandedSections.clear();
	}

	// ============================================================================
	// Search Functions
	// ============================================================================

	function escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function toggleSearch() {
		searchOpen = !searchOpen;
		if (searchOpen) {
			// Focus input after it renders
			setTimeout(() => searchInputRef?.focus(), 50);
		} else {
			clearSearch();
		}
	}

	function clearSearch() {
		searchQuery = '';
		currentMatchIndex = 0;
		totalMatches = 0;
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (searchQuery) {
				clearSearch();
			} else {
				searchOpen = false;
			}
		} else if (e.key === 'Enter') {
			if (e.shiftKey) {
				navigateMatch(-1);
			} else {
				navigateMatch(1);
			}
		}
	}

	// Find all matches and expand sections containing them
	$effect(() => {
		if (!searchQuery || !formatted || !contentContainerRef) {
			totalMatches = 0;
			currentMatchIndex = 0;
			return;
		}

		// Count matches and expand sections that contain them
		let count = 0;
		const query = searchQuery.toLowerCase();

		for (const section of formatted.sections) {
			const contentLower = section.content?.toLowerCase() || '';
			const titleLower = section.title?.toLowerCase() || '';

			if (contentLower.includes(query) || titleLower.includes(query)) {
				// Expand section if it has matches
				expandedSections.add(section.id);

				// Count matches in this section
				const regex = new RegExp(escapeRegex(searchQuery), 'gi');
				const contentMatches = section.content?.match(regex) || [];
				const titleMatches = section.title?.match(regex) || [];
				count += contentMatches.length + titleMatches.length;
			}
		}

		totalMatches = count;
		if (currentMatchIndex >= count) {
			currentMatchIndex = count > 0 ? 0 : 0;
		}

		// Scroll to first match after a brief delay for DOM update
		if (count > 0) {
			setTimeout(() => scrollToCurrentMatch(), 100);
		}
	});

	function navigateMatch(direction: 1 | -1) {
		if (totalMatches === 0) return;

		currentMatchIndex = (currentMatchIndex + direction + totalMatches) % totalMatches;
		scrollToCurrentMatch();
	}

	function scrollToCurrentMatch() {
		if (!contentContainerRef) return;

		const highlights = contentContainerRef.querySelectorAll('.search-highlight');
		if (highlights.length === 0) return;

		// Remove current class from all
		highlights.forEach(el => el.classList.remove('search-highlight-current'));

		// Add current class to the current match
		const currentEl = highlights[currentMatchIndex];
		if (currentEl) {
			currentEl.classList.add('search-highlight-current');
			currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	// Function to highlight search matches in text
	function highlightSearchMatches(text: string): string {
		if (!searchQuery || !text) return text;

		const regex = new RegExp(`(${escapeRegex(searchQuery)})`, 'gi');
		return text.replace(regex, '<mark class="search-highlight">$1</mark>');
	}
</script>

{#if content && formatted}
	<div class="fda-content-display border {style.border} rounded-lg overflow-hidden" data-fda-content>
		<!-- Header with stats -->
		{#if showStats || title}
			<div class="px-4 py-3 {style.headerBg} border-b {style.border}">
				<div class="flex items-center justify-between gap-3">
					<div class="flex items-center gap-2">
						{#if style.icon}
							{@const IconComponent = style.icon}
							<IconComponent class="h-4 w-4 {style.accent}" />
						{/if}
						{#if title}
							<span class="font-medium {style.accent}">{title}</span>
						{/if}
					</div>

					<div class="flex items-center gap-3">
						{#if showStats}
							<div class="flex items-center gap-3 text-xs text-slate-500">
								{#if stats.sectionCount > 1}
									<span class="flex items-center gap-1">
										<List class="h-3 w-3" />
										{stats.sectionCount} szakasz
									</span>
								{/if}
								<span class="flex items-center gap-1">
									<Clock class="h-3 w-3" />
									{stats.readTime}
								</span>
							</div>
						{/if}

						<!-- Search Button -->
						<button
							type="button"
							class="search-toggle-btn p-1.5 rounded-md transition-all duration-200 {searchOpen
								? 'bg-cyan-500/20 text-cyan-400'
								: 'text-slate-500 hover:text-cyan-400 hover:bg-slate-700/50'}"
							onclick={toggleSearch}
							aria-label="Keresés a tartalomban"
							title="Keresés a tartalomban"
						>
							<Search class="h-4 w-4" />
						</button>
					</div>
				</div>

				<!-- View mode toggle for non-compact -->
				{#if !compact && formatted.sections.length > 1}
					<div class="flex items-center gap-2 mt-2">
						<button
							type="button"
							class="px-2 py-1 text-xs rounded transition-colors {viewMode === 'summary'
								? 'bg-slate-600 text-white'
								: 'bg-slate-800 text-slate-400 hover:text-white'}"
							onclick={() => (userViewMode = 'summary')}
						>
							Összefoglaló
						</button>
						<button
							type="button"
							class="px-2 py-1 text-xs rounded transition-colors {viewMode === 'sections'
								? 'bg-slate-600 text-white'
								: 'bg-slate-800 text-slate-400 hover:text-white'}"
							onclick={() => (userViewMode = 'sections')}
						>
							Szakaszok
						</button>
						<button
							type="button"
							class="px-2 py-1 text-xs rounded transition-colors {viewMode === 'full'
								? 'bg-slate-600 text-white'
								: 'bg-slate-800 text-slate-400 hover:text-white'}"
							onclick={() => (userViewMode = 'full')}
						>
							Teljes
						</button>

						{#if viewMode === 'sections'}
							<div class="ml-auto flex gap-1">
								<button
									type="button"
									class="px-2 py-1 text-xs text-slate-500 hover:text-slate-300"
									onclick={expandAll}
								>
									Mind
								</button>
								<span class="text-slate-600">|</span>
								<button
									type="button"
									class="px-2 py-1 text-xs text-slate-500 hover:text-slate-300"
									onclick={collapseAll}
								>
									Bezár
								</button>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Expandable Search Bar -->
				{#if searchOpen}
					<div
						class="search-bar-container px-4 py-3 bg-slate-800/80 border-t border-slate-700/50"
						transition:slide={{ duration: 150 }}
						role="search"
					>
						<div class="flex items-center gap-3">
							<!-- Search Input -->
							<div class="flex-1 relative">
								<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
								<input
									bind:this={searchInputRef}
									type="text"
									bind:value={searchQuery}
									onkeydown={handleSearchKeydown}
									placeholder="Keresés..."
									class="w-full pl-10 pr-10 py-2 bg-slate-900/80 border border-slate-600/50 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
								/>
								{#if searchQuery}
									<button
										type="button"
										class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
										onclick={clearSearch}
										aria-label="Keresés törlése"
									>
										<X class="h-4 w-4" />
									</button>
								{/if}
							</div>

							<!-- Match Counter & Navigation -->
							{#if searchQuery}
								<div class="flex items-center gap-2">
									<span class="text-sm text-slate-400 tabular-nums min-w-[3.5rem] text-center">
										{totalMatches > 0 ? `${currentMatchIndex + 1}/${totalMatches}` : '0/0'}
									</span>

									<div class="flex gap-1">
										<button
											type="button"
											class="p-1.5 rounded text-slate-500 hover:text-cyan-400 hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed"
											onclick={() => navigateMatch(-1)}
											disabled={totalMatches === 0}
											aria-label="Előző találat"
											title="Előző találat (Shift+Enter)"
										>
											<ChevronUp class="h-4 w-4" />
										</button>
										<button
											type="button"
											class="p-1.5 rounded text-slate-500 hover:text-cyan-400 hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed"
											onclick={() => navigateMatch(1)}
											disabled={totalMatches === 0}
											aria-label="Következő találat"
											title="Következő találat (Enter)"
										>
											<ChevronDown class="h-4 w-4" />
										</button>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Content -->
		<div
			bind:this={contentContainerRef}
			class="overflow-y-auto {style.bg}"
			style="max-height: {maxHeight};"
		>
			{#if viewMode === 'summary'}
				<!-- Summary View -->
				<div class="p-5 space-y-5">
					<!-- Summary bullets if available (from FDA top section) -->
					{#if formatted.summaryBullets && formatted.summaryBullets.length > 0}
						<div class="space-y-3">
							<p class="text-sm text-slate-500 font-medium uppercase tracking-wide">Áttekintés:</p>
							<ul class="space-y-3">
								{#each formatted.summaryBullets.slice(0, 8) as bullet, index (index)}
									<li class="flex items-start gap-3">
										<span class="fda-summary-bullet mt-1.5 w-2 h-2 rounded-full shrink-0 {variant === 'contraindication' ? 'bg-red-400' : variant === 'warning' ? 'bg-amber-400' : variant === 'interaction' ? 'bg-blue-400' : 'bg-slate-400'}"></span>
										<span class="text-lg text-slate-200 leading-relaxed fda-formatted-content">{@html formatSectionContent(bullet)}</span>
									</li>
								{/each}
							</ul>
						</div>
					{:else}
						<!-- Main summary -->
						<p class="text-lg text-slate-200 leading-relaxed">
							{formatted.summary}
						</p>
					{/if}

					<!-- Key bullet points from content -->
					{#if formatted.bulletPoints.length > 0 && (!formatted.summaryBullets || formatted.summaryBullets.length === 0)}
						<div class="space-y-3">
							<p class="text-sm text-slate-500 font-medium uppercase tracking-wide">Főbb pontok:</p>
							<ul class="space-y-3">
								{#each formatted.bulletPoints.slice(0, 6) as bullet, index (index)}
									<li class="flex items-start gap-3">
										<span class="mt-1.5 w-2 h-2 rounded-full shrink-0 {variant === 'contraindication' ? 'bg-red-400' : variant === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}"></span>
										<span class="text-lg text-slate-200 leading-relaxed">{bullet}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<!-- Show more link -->
					{#if formatted.sections.length > 1}
						<button
							type="button"
							class="text-base {style.accent} hover:underline font-medium mt-2"
							onclick={() => (userViewMode = 'sections')}
						>
							{formatted.sections.length} szakasz megtekintése →
						</button>
					{/if}
				</div>
			{:else if viewMode === 'sections'}
				<!-- Sections View -->
				<div class="divide-y divide-slate-700/50">
					{#each formatted.sections as section (section.id)}
						{#if section.title || section.content}
							<div class="section">
								{#if section.title}
									<button
										type="button"
										class="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-slate-700/30 transition-colors"
										onclick={() => toggleSection(section.id)}
									>
										{#if expandedSections.has(section.id)}
											<ChevronDown class="h-5 w-5 text-slate-500 shrink-0" />
										{:else}
											<ChevronRight class="h-5 w-5 text-slate-500 shrink-0" />
										{/if}
										{#if section.number}
											<span class="text-sm font-mono text-slate-500 shrink-0 bg-slate-700/50 px-2 py-0.5 rounded">
												{section.number}
											</span>
										{/if}
										<span class="text-lg font-medium text-slate-200">
											{#if searchQuery}
												{@html highlightSearchMatches(section.title)}
											{:else}
												{section.title}
											{/if}
										</span>
									</button>
								{/if}

								{#if expandedSections.has(section.id) || !section.title}
									<div
										class="px-5 pb-5 {section.title ? 'pt-2 pl-14' : 'pt-4'}"
										transition:slide={{ duration: 150 }}
									>
										<div
											class="fda-formatted-content text-lg text-slate-300 leading-8"
										>
											{#if searchQuery}
												{@html highlightSearchMatches(formatSectionContent(section.content))}
											{:else}
												{@html formatSectionContent(section.content)}
											{/if}
										</div>
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{:else}
				<!-- Full View -->
				<div class="p-5">
					<div class="fda-formatted-content text-lg text-slate-300 leading-8">
						{#if searchQuery}
							{@html highlightSearchMatches(formatSectionContent(content || ''))}
						{:else}
							{@html formatSectionContent(content || '')}
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{:else}
	<div class="text-center py-4 text-slate-500 text-sm">
		<FileText class="h-5 w-5 mx-auto mb-2 opacity-50" />
		<p>Nincs elérhető információ</p>
	</div>
{/if}

<style>
	/* FDA content styling - enhanced for readability */
	.fda-formatted-content :global(p),
	.fda-formatted-content :global(.fda-paragraph) {
		margin-bottom: 1.25rem;
		line-height: 1.875;
		font-size: 1.125rem; /* 18px */
	}

	.fda-formatted-content :global(p:last-child),
	.fda-formatted-content :global(.fda-paragraph:last-child) {
		margin-bottom: 0;
	}

	/* Section references */
	.fda-formatted-content :global(.fda-ref) {
		color: rgb(148, 163, 184); /* slate-400 */
		font-size: 0.9375rem;
		font-family: ui-monospace, monospace;
		background: rgba(148, 163, 184, 0.1);
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
	}

	.fda-formatted-content :global(.fda-see-ref) {
		color: rgb(96, 165, 250); /* blue-400 */
		font-size: 1.0625rem;
		font-style: italic;
	}

	/* Clinical values - larger and more prominent */
	.fda-formatted-content :global(.fda-value) {
		color: rgb(34, 211, 238); /* cyan-400 */
		font-weight: 600;
		font-size: 1.0625rem;
		font-family: ui-monospace, monospace;
		background: rgba(34, 211, 238, 0.15);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		white-space: nowrap;
	}

	/* Drug names */
	.fda-formatted-content :global(.fda-drug) {
		color: rgb(251, 191, 36); /* amber-400 */
		font-weight: 700;
		font-size: 1.0625rem;
		background: rgba(251, 191, 36, 0.1);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
	}

	/* Warning keywords - prominent red highlight */
	.fda-formatted-content :global(.fda-warning-keyword) {
		background: rgba(239, 68, 68, 0.3); /* red-500/30 */
		color: rgb(252, 165, 165); /* red-300 */
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		font-weight: 700;
		font-size: 1.0625rem;
		text-transform: uppercase;
		letter-spacing: 0.025em;
	}

	/* Action verbs - green highlight for clinical actions */
	.fda-formatted-content :global(.fda-action-verb) {
		color: rgb(134, 239, 172); /* green-300 */
		font-weight: 600;
		font-size: 1.0625rem;
	}

	/* Drug classes - purple highlight */
	.fda-formatted-content :global(.fda-drug-class) {
		color: rgb(192, 132, 252); /* purple-400 */
		font-weight: 600;
		font-size: 1.0625rem;
		font-family: ui-monospace, monospace;
		background: rgba(192, 132, 252, 0.1);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
	}

	/* Table references */
	.fda-formatted-content :global(.fda-table-ref) {
		color: rgb(96, 165, 250); /* blue-400 */
		font-weight: 600;
		font-size: 1rem;
		background: rgba(96, 165, 250, 0.1);
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		display: inline-block;
		margin: 0.25rem 0;
	}

	/* Notes label */
	.fda-formatted-content :global(.fda-notes-label) {
		color: rgb(148, 163, 184); /* slate-400 */
		font-weight: 700;
		font-size: 1rem;
		font-style: italic;
		background: rgba(148, 163, 184, 0.1);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
	}

	/* Key-value pairs */
	.fda-formatted-content :global(.fda-key-value) {
		margin-bottom: 1rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid rgba(71, 85, 105, 0.4);
	}

	.fda-formatted-content :global(.fda-key-term) {
		color: rgb(226, 232, 240); /* slate-200 */
		font-weight: 700;
		font-size: 1.0625rem;
	}

	/* List styling */
	.fda-formatted-content :global(.fda-list) {
		list-style: none;
		padding-left: 0;
		margin: 1.25rem 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.fda-formatted-content :global(.fda-list-item) {
		color: rgb(203, 213, 225); /* slate-300 */
		padding-left: 1.75rem;
		position: relative;
		line-height: 1.875;
		font-size: 1.125rem;
	}

	.fda-formatted-content :global(.fda-list-item::before) {
		content: '•';
		position: absolute;
		left: 0;
		color: rgb(96, 165, 250); /* blue-400 */
		font-weight: 700;
		font-size: 1.5rem;
		line-height: 1.25;
	}

	.fda-formatted-content :global(.fda-numbered-item) {
		color: rgb(203, 213, 225); /* slate-300 */
		padding-left: 0.75rem;
		line-height: 1.875;
		font-size: 1.125rem;
	}

	.fda-formatted-content :global(.fda-list-number) {
		color: rgb(96, 165, 250); /* blue-400 */
		font-weight: 700;
		font-family: ui-monospace, monospace;
		font-size: 1rem;
	}

	/* Drug Interaction Tables */
	.fda-formatted-content :global(.fda-table-container) {
		margin: 1.5rem 0;
		border-radius: 0.5rem;
		overflow: hidden;
		border: 1px solid rgba(96, 165, 250, 0.3);
	}

	.fda-formatted-content :global(.fda-table-header) {
		background: rgba(96, 165, 250, 0.15);
		color: rgb(147, 197, 253); /* blue-300 */
		padding: 0.75rem 1rem;
		font-weight: 600;
		font-size: 1rem;
		border-bottom: 1px solid rgba(96, 165, 250, 0.3);
	}

	.fda-formatted-content :global(.fda-interaction-table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9375rem;
	}

	.fda-formatted-content :global(.fda-interaction-table th) {
		background: rgba(30, 41, 59, 0.8);
		color: rgb(226, 232, 240); /* slate-200 */
		padding: 0.75rem;
		text-align: left;
		font-weight: 600;
		border-bottom: 1px solid rgba(71, 85, 105, 0.5);
	}

	.fda-formatted-content :global(.fda-interaction-table td) {
		padding: 0.75rem;
		border-bottom: 1px solid rgba(71, 85, 105, 0.3);
		color: rgb(203, 213, 225); /* slate-300 */
		vertical-align: top;
		line-height: 1.6;
	}

	.fda-formatted-content :global(.fda-interaction-table tr:last-child td) {
		border-bottom: none;
	}

	.fda-formatted-content :global(.fda-interaction-table tr:hover td) {
		background: rgba(71, 85, 105, 0.2);
	}

	.fda-formatted-content :global(.fda-drug-cell) {
		color: rgb(251, 191, 36); /* amber-400 */
		font-weight: 600;
		white-space: nowrap;
	}

	.fda-formatted-content :global(.fda-examples-cell) {
		color: rgb(148, 163, 184); /* slate-400 */
		font-style: italic;
	}

	/* Adverse Reactions Tables */
	.fda-formatted-content :global(.fda-adverse-table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.fda-formatted-content :global(.fda-adverse-table th) {
		background: rgba(239, 68, 68, 0.15); /* red tint for adverse */
		color: rgb(252, 165, 165); /* red-300 */
		padding: 0.625rem;
		text-align: center;
		font-weight: 600;
		font-size: 0.8rem;
		border-bottom: 1px solid rgba(239, 68, 68, 0.3);
	}

	.fda-formatted-content :global(.fda-adverse-table th:first-child) {
		text-align: left;
	}

	.fda-formatted-content :global(.fda-adverse-table td) {
		padding: 0.5rem 0.625rem;
		border-bottom: 1px solid rgba(71, 85, 105, 0.3);
		color: rgb(203, 213, 225);
		text-align: center;
	}

	.fda-formatted-content :global(.fda-condition-cell) {
		text-align: left !important;
		color: rgb(253, 186, 116); /* amber-300 */
		font-weight: 500;
	}

	.fda-formatted-content :global(.fda-value-cell) {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}

	.fda-formatted-content :global(.fda-adverse-table tr:hover td) {
		background: rgba(239, 68, 68, 0.08);
	}

	/* Pharmacokinetic Tables */
	.fda-formatted-content :global(.fda-pk-table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.fda-formatted-content :global(.fda-pk-table th) {
		background: rgba(34, 197, 94, 0.15); /* green tint for PK */
		color: rgb(134, 239, 172); /* green-300 */
		padding: 0.625rem;
		text-align: center;
		font-weight: 600;
		font-size: 0.8rem;
		border-bottom: 1px solid rgba(34, 197, 94, 0.3);
	}

	.fda-formatted-content :global(.fda-pk-table th:first-child),
	.fda-formatted-content :global(.fda-pk-table th:nth-child(2)) {
		text-align: left;
	}

	.fda-formatted-content :global(.fda-pk-table td) {
		padding: 0.5rem 0.625rem;
		border-bottom: 1px solid rgba(71, 85, 105, 0.3);
		color: rgb(203, 213, 225);
		text-align: center;
	}

	.fda-formatted-content :global(.fda-pk-table td:first-child),
	.fda-formatted-content :global(.fda-pk-table td:nth-child(2)) {
		text-align: left;
	}

	.fda-formatted-content :global(.fda-pk-table .fda-significant) {
		color: rgb(251, 191, 36); /* amber-400 */
		font-weight: 600;
		background: rgba(251, 191, 36, 0.1);
	}

	.fda-formatted-content :global(.fda-pk-table tr:hover td) {
		background: rgba(34, 197, 94, 0.08);
	}

	/* Clinical Studies Summary */
	.fda-formatted-content :global(.fda-clinical-summary) {
		padding: 1rem;
		background: rgba(30, 41, 59, 0.5);
	}

	.fda-formatted-content :global(.fda-clinical-note) {
		color: rgb(148, 163, 184); /* slate-400 */
		font-style: italic;
		margin-bottom: 0.75rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid rgba(71, 85, 105, 0.3);
	}

	.fda-formatted-content :global(.fda-clinical-summary p) {
		margin: 0.5rem 0;
		color: rgb(203, 213, 225);
	}

	.fda-formatted-content :global(.fda-clinical-summary strong) {
		color: rgb(96, 165, 250); /* blue-400 */
	}

	/* Generic Data Tables (universal parser) */
	.fda-formatted-content :global(.fda-data-table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9375rem;
	}

	.fda-formatted-content :global(.fda-data-table th) {
		background: rgba(71, 85, 105, 0.4);
		color: rgb(226, 232, 240); /* slate-200 */
		padding: 0.75rem;
		text-align: left;
		font-weight: 600;
		font-size: 0.875rem;
		border-bottom: 2px solid rgba(96, 165, 250, 0.3);
	}

	.fda-formatted-content :global(.fda-data-table td) {
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid rgba(71, 85, 105, 0.3);
		color: rgb(203, 213, 225); /* slate-300 */
		vertical-align: top;
		line-height: 1.5;
	}

	.fda-formatted-content :global(.fda-data-table tr:last-child td) {
		border-bottom: none;
	}

	.fda-formatted-content :global(.fda-data-table tr:hover td) {
		background: rgba(71, 85, 105, 0.2);
	}

	.fda-formatted-content :global(.fda-label-cell) {
		color: rgb(253, 186, 116); /* amber-300 */
		font-weight: 500;
		min-width: 120px;
	}

	.fda-formatted-content :global(.fda-data-cell) {
		text-align: center;
		font-family: ui-monospace, monospace;
		font-size: 0.875rem;
	}

	/* Aligned Table variant (adverse reactions) */
	.fda-formatted-content :global(.fda-aligned-table .fda-table-header) {
		background: rgba(239, 68, 68, 0.15);
		color: rgb(252, 165, 165);
		border-bottom-color: rgba(239, 68, 68, 0.3);
	}

	.fda-formatted-content :global(.fda-aligned-table .fda-data-table th) {
		background: rgba(239, 68, 68, 0.1);
		text-align: center;
	}

	.fda-formatted-content :global(.fda-aligned-table .fda-data-table th:first-child) {
		text-align: left;
	}

	.fda-formatted-content :global(.fda-aligned-table .fda-data-table tr:hover td) {
		background: rgba(239, 68, 68, 0.08);
	}

	/* Figure References */
	.fda-formatted-content :global(.fda-figure-ref) {
		margin: 1.25rem 0;
		padding: 1rem;
		background: rgba(168, 85, 247, 0.1);
		border: 1px solid rgba(168, 85, 247, 0.3);
		border-radius: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.fda-formatted-content :global(.fda-figure-label) {
		color: rgb(192, 132, 252); /* purple-400 */
		font-weight: 600;
		font-size: 1rem;
	}

	.fda-formatted-content :global(.fda-figure-caption) {
		color: rgb(226, 232, 240); /* slate-200 */
		font-size: 0.9375rem;
	}

	.fda-formatted-content :global(.fda-figure-note) {
		color: rgb(148, 163, 184); /* slate-400 */
		font-size: 0.8125rem;
		font-style: italic;
	}

	/* Subsection headers with section numbers */
	.fda-formatted-content :global(.fda-subsection-header) {
		display: block;
		margin: 1.25rem 0 0.75rem 0;
		padding: 0.5rem 0.75rem;
		background: rgba(71, 85, 105, 0.2);
		border-left: 3px solid rgb(96, 165, 250); /* blue-400 */
		border-radius: 0 0.25rem 0.25rem 0;
	}

	.fda-formatted-content :global(.fda-section-number) {
		color: rgb(96, 165, 250); /* blue-400 */
		font-weight: 700;
		font-size: 1.125rem;
		font-family: ui-monospace, monospace;
		margin-right: 0.5rem;
	}

	.fda-formatted-content :global(.fda-section-title) {
		color: rgb(226, 232, 240); /* slate-200 */
		font-weight: 600;
		font-size: 1.125rem;
		text-transform: capitalize;
	}

	/* Scrollbar styling */
	.fda-content-display ::-webkit-scrollbar {
		width: 10px;
	}

	.fda-content-display ::-webkit-scrollbar-track {
		background: rgba(30, 41, 59, 0.5);
		border-radius: 5px;
	}

	.fda-content-display ::-webkit-scrollbar-thumb {
		background: rgb(71, 85, 105);
		border-radius: 5px;
	}

	.fda-content-display ::-webkit-scrollbar-thumb:hover {
		background: rgb(100, 116, 139);
	}

	/* ============================================
	   Search Highlight Styles (Neon Theme)
	   ============================================ */

	/* Search toggle button glow effect */
	.search-toggle-btn:hover {
		box-shadow: 0 0 8px rgba(34, 211, 238, 0.3);
	}

	.search-toggle-btn:focus {
		outline: none;
		box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.4);
	}

	/* Search bar container */
	.search-bar-container {
		backdrop-filter: blur(8px);
	}

	/* Search highlight - base style */
	:global(.search-highlight) {
		background: rgba(34, 211, 238, 0.25); /* cyan-400/25 */
		color: inherit;
		padding: 0.0625rem 0.1875rem;
		border-radius: 0.1875rem;
		box-shadow: 0 0 6px rgba(34, 211, 238, 0.3);
		transition: all 0.15s ease;
	}

	/* Search highlight - current/active match */
	:global(.search-highlight-current) {
		background: rgba(34, 211, 238, 0.5); /* cyan-400/50 */
		box-shadow: 0 0 12px rgba(34, 211, 238, 0.6), 0 0 20px rgba(34, 211, 238, 0.3);
		outline: 1px solid rgba(34, 211, 238, 0.6);
	}

	/* Ensure highlights are visible in tables */
	.fda-formatted-content :global(td .search-highlight),
	.fda-formatted-content :global(th .search-highlight) {
		display: inline;
	}

	/* Animation for current highlight */
	@keyframes highlight-pulse {
		0%, 100% {
			box-shadow: 0 0 12px rgba(34, 211, 238, 0.6), 0 0 20px rgba(34, 211, 238, 0.3);
		}
		50% {
			box-shadow: 0 0 16px rgba(34, 211, 238, 0.8), 0 0 28px rgba(34, 211, 238, 0.4);
		}
	}

	:global(.search-highlight-current) {
		animation: highlight-pulse 1.5s ease-in-out infinite;
	}

	/* Reduce motion for accessibility */
	@media (prefers-reduced-motion: reduce) {
		:global(.search-highlight-current) {
			animation: none;
		}
	}
</style>
