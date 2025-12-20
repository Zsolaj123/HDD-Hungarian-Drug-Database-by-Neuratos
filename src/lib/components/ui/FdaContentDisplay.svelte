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
		Clock,
		AlertTriangle,
		AlertCircle,
		Ban,
		Info,
		FileText,
		List
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
	let viewMode = $state<'summary' | 'sections' | 'full'>(compact ? 'summary' : 'sections');
	let expandedSections = $state(new SvelteSet<string>());

	// Initialize expanded sections based on defaultExpanded
	$effect(() => {
		if (defaultExpanded && formatted) {
			expandedSections.clear();
			for (const section of formatted.sections) {
				expandedSections.add(section.id);
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
</script>

{#if content && formatted}
	<div class="fda-content-display border {style.border} rounded-lg overflow-hidden">
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
				</div>

				<!-- View mode toggle for non-compact -->
				{#if !compact && formatted.sections.length > 1}
					<div class="flex items-center gap-2 mt-2">
						<button
							type="button"
							class="px-2 py-1 text-xs rounded transition-colors {viewMode === 'summary'
								? 'bg-slate-600 text-white'
								: 'bg-slate-800 text-slate-400 hover:text-white'}"
							onclick={() => (viewMode = 'summary')}
						>
							Összefoglaló
						</button>
						<button
							type="button"
							class="px-2 py-1 text-xs rounded transition-colors {viewMode === 'sections'
								? 'bg-slate-600 text-white'
								: 'bg-slate-800 text-slate-400 hover:text-white'}"
							onclick={() => (viewMode = 'sections')}
						>
							Szakaszok
						</button>
						<button
							type="button"
							class="px-2 py-1 text-xs rounded transition-colors {viewMode === 'full'
								? 'bg-slate-600 text-white'
								: 'bg-slate-800 text-slate-400 hover:text-white'}"
							onclick={() => (viewMode = 'full')}
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
			</div>
		{/if}

		<!-- Content -->
		<div
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
							onclick={() => (viewMode = 'sections')}
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
											{section.title}
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
											{@html formatSectionContent(section.content)}
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
						{@html formatSectionContent(content || '')}
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
</style>
