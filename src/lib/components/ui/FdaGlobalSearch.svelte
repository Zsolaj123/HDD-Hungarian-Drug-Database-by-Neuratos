<script lang="ts">
	/**
	 * FdaGlobalSearch.svelte
	 *
	 * Floating global search component for FDA and EMA content on the drugs page.
	 * Features:
	 * - Floating button in bottom-right corner (only visible on FDA/EMA tabs)
	 * - Expandable search bar
	 * - Searches across FDA and EMA content sections
	 * - Highlights matches with neon styling
	 * - Keyboard navigation between matches
	 */

	import { Search, X, ChevronUp, ChevronDown } from 'lucide-svelte';
	import { slide, fade } from 'svelte/transition';
	import { onMount, onDestroy } from 'svelte';

	// Props
	interface Props {
		visible?: boolean;
		contentType?: 'fda' | 'ema' | 'both';
	}

	let { visible = true, contentType = 'both' }: Props = $props();

	// State
	let isOpen = $state(false);
	let searchQuery = $state('');
	let currentMatchIndex = $state(0);
	let totalMatches = $state(0);
	let inputRef = $state<HTMLInputElement | null>(null);
	let allMarks: HTMLElement[] = $state([]);

	// Escape regex special characters
	function escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	// Toggle search panel
	function toggleSearch() {
		isOpen = !isOpen;
		if (isOpen) {
			setTimeout(() => inputRef?.focus(), 100);
		} else {
			clearSearch();
		}
	}

	// Clear search
	function clearSearch() {
		searchQuery = '';
		clearHighlights();
		currentMatchIndex = 0;
		totalMatches = 0;
		allMarks = [];
	}

	// Clear all highlights from the page
	function clearHighlights() {
		// Remove all existing marks
		const marks = document.querySelectorAll('mark.fda-global-highlight');
		marks.forEach((mark) => {
			const parent = mark.parentNode;
			if (parent) {
				parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
				parent.normalize();
			}
		});
	}

	// Highlight text in a text node
	function highlightTextNode(textNode: Text, regex: RegExp): number {
		const text = textNode.nodeValue || '';
		if (!text.trim()) return 0;

		// Use exec loop for proper match positions
		const fragment = document.createDocumentFragment();
		let lastIndex = 0;
		let matchCount = 0;
		let match: RegExpExecArray | null;

		// Reset regex lastIndex
		regex.lastIndex = 0;

		while ((match = regex.exec(text)) !== null) {
			const matchStart = match.index;
			const matchText = match[0];

			// Add text before match
			if (matchStart > lastIndex) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchStart)));
			}

			// Add highlighted match
			const mark = document.createElement('mark');
			mark.className = 'fda-global-highlight';
			mark.textContent = matchText;
			fragment.appendChild(mark);
			matchCount++;

			lastIndex = matchStart + matchText.length;

			// Prevent infinite loop for zero-length matches
			if (matchText.length === 0) {
				regex.lastIndex++;
			}
		}

		// Only replace if we found matches
		if (matchCount > 0) {
			// Add remaining text
			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}
			textNode.parentNode?.replaceChild(fragment, textNode);
		}

		return matchCount;
	}

	// Walk through text nodes and highlight matches
	function highlightContent(element: Element, regex: RegExp): number {
		let matchCount = 0;
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				// Skip script, style, and already highlighted content
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				const tagName = parent.tagName.toLowerCase();
				if (tagName === 'script' || tagName === 'style' || tagName === 'mark') {
					return NodeFilter.FILTER_REJECT;
				}
				// Skip if parent or ancestor has certain classes
				if (parent.closest('.fda-search-bar') || parent.closest('button')) {
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		const textNodes: Text[] = [];
		let node;
		while ((node = walker.nextNode())) {
			textNodes.push(node as Text);
		}

		// Process in reverse to avoid issues with node replacement
		for (let i = textNodes.length - 1; i >= 0; i--) {
			matchCount += highlightTextNode(textNodes[i], regex);
		}

		return matchCount;
	}

	// Perform search
	function performSearch() {
		clearHighlights();
		currentMatchIndex = 0;
		totalMatches = 0;
		allMarks = [];

		if (!searchQuery.trim()) return;

		const regex = new RegExp(`(${escapeRegex(searchQuery)})`, 'gi');
		let total = 0;

		// Build selectors based on content type
		const selectors: string[] = [];

		if (contentType === 'fda' || contentType === 'both') {
			selectors.push('[data-fda-content]', '.fda-content-display');
		}

		if (contentType === 'ema' || contentType === 'both') {
			selectors.push('[data-ema-content]', '[data-clinical-content="ema"]');
		}

		// Search all matching containers
		const containers = document.querySelectorAll(selectors.join(', '));
		const processedContainers = new Set<Element>();

		containers.forEach((container) => {
			if (!processedContainers.has(container)) {
				processedContainers.add(container);
				total += highlightContent(container, regex);
			}
		});

		totalMatches = total;
		allMarks = Array.from(document.querySelectorAll('mark.fda-global-highlight'));

		// Navigate to first match
		if (totalMatches > 0) {
			navigateToMatch(0);
		}
	}

	// Navigate to a specific match
	function navigateToMatch(index: number) {
		if (allMarks.length === 0) return;

		// Remove current highlight from previous match
		allMarks.forEach((mark) => mark.classList.remove('fda-global-highlight-current'));

		// Update index with wrapping
		if (index < 0) index = allMarks.length - 1;
		if (index >= allMarks.length) index = 0;
		currentMatchIndex = index;

		// Highlight current match
		const currentMark = allMarks[index];
		if (currentMark) {
			currentMark.classList.add('fda-global-highlight-current');

			// Find parent section and expand if collapsed
			const parentSection = currentMark.closest('[data-section-collapsed="true"]');
			if (parentSection) {
				// Try to find and click the expand button
				const expandButton = parentSection.querySelector('[data-section-toggle]');
				if (expandButton instanceof HTMLElement) {
					expandButton.click();
				}
			}

			// Scroll into view
			currentMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	// Navigate to next/previous match
	function nextMatch() {
		navigateToMatch(currentMatchIndex + 1);
	}

	function prevMatch() {
		navigateToMatch(currentMatchIndex - 1);
	}

	// Handle keyboard events
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (searchQuery) {
				clearSearch();
			} else {
				toggleSearch();
			}
		} else if (e.key === 'Enter') {
			if (e.shiftKey) {
				prevMatch();
			} else {
				if (totalMatches === 0) {
					performSearch();
				} else {
					nextMatch();
				}
			}
		}
	}

	// Watch for search query changes with debounce
	let searchTimeout: ReturnType<typeof setTimeout>;
	$effect(() => {
		if (searchQuery) {
			clearTimeout(searchTimeout);
			searchTimeout = setTimeout(performSearch, 300);
		} else {
			clearHighlights();
			totalMatches = 0;
			allMarks = [];
		}
	});

	// Global keyboard shortcut (Ctrl+F override)
	function handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
			// Check if we're in an FDA content area
			const activeElement = document.activeElement;
			const fdaArea = document.querySelector('[data-fda-content], .fda-content-display');
			if (fdaArea) {
				e.preventDefault();
				if (!isOpen) toggleSearch();
				setTimeout(() => inputRef?.focus(), 100);
			}
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleGlobalKeydown);
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleGlobalKeydown);
		clearHighlights();
		clearTimeout(searchTimeout);
	});
</script>

<!-- Floating Search Button & Panel - Only visible on FDA/EMA tabs -->
{#if visible}
<div class="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex flex-col items-end gap-2 sm:gap-3" transition:fade={{ duration: 200 }}>
	<!-- Search Panel (appears above button) -->
	{#if isOpen}
		<div
			class="fda-search-bar bg-slate-900/95 backdrop-blur-sm border border-cyan-500/30 rounded-xl shadow-2xl shadow-cyan-500/10 p-2 sm:p-3 max-w-[calc(100vw-2rem)] sm:max-w-none"
			transition:slide={{ duration: 200 }}
		>
			<div class="flex flex-wrap sm:flex-nowrap items-center gap-2">
				<!-- Search Input -->
				<div class="relative flex-1 min-w-0">
					<Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400" />
					<input
						bind:this={inputRef}
						bind:value={searchQuery}
						onkeydown={handleKeydown}
						type="text"
						placeholder={contentType === 'fda' ? 'Keresés FDA...' : contentType === 'ema' ? 'Keresés EMA...' : 'Keresés FDA/EMA...'}
						class="pl-9 pr-8 py-2.5 w-full sm:w-64 bg-slate-800/80 border border-slate-600/50 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
					/>
					{#if searchQuery}
						<button
							type="button"
							class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors p-1"
							onclick={clearSearch}
							aria-label="Törlés"
						>
							<X class="w-4 h-4" />
						</button>
					{/if}
				</div>

				<!-- Match Counter & Navigation Row -->
				<div class="flex items-center gap-2 shrink-0">
					<!-- Match Counter -->
					{#if totalMatches > 0}
						<span class="text-xs text-cyan-400 font-mono whitespace-nowrap">
							{currentMatchIndex + 1}/{totalMatches}
						</span>
					{:else if searchQuery.length > 0}
						<span class="text-xs text-slate-500 whitespace-nowrap">
							0
						</span>
					{/if}

					<!-- Navigation Arrows -->
					{#if totalMatches > 1}
						<div class="flex gap-1">
							<button
								type="button"
								class="p-2 sm:p-1.5 rounded-md bg-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 active:bg-slate-600 transition-colors touch-manipulation"
								onclick={prevMatch}
								aria-label="Előző találat"
							>
								<ChevronUp class="w-5 h-5 sm:w-4 sm:h-4" />
							</button>
							<button
								type="button"
								class="p-2 sm:p-1.5 rounded-md bg-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 active:bg-slate-600 transition-colors touch-manipulation"
								onclick={nextMatch}
								aria-label="Következő találat"
							>
								<ChevronDown class="w-5 h-5 sm:w-4 sm:h-4" />
							</button>
						</div>
					{/if}
				</div>
			</div>

			<!-- Keyboard hints (hidden on mobile) -->
			<div class="hidden sm:flex mt-2 gap-3 text-[10px] text-slate-600">
				<span>Enter: következő</span>
				<span>Shift+Enter: előző</span>
				<span>Esc: bezárás</span>
			</div>
		</div>
	{/if}

	<!-- Floating Search Button with Glow -->
	<button
		type="button"
		class="search-fab group p-3.5 sm:p-4 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white active:scale-95 sm:hover:scale-110 transition-all duration-200 touch-manipulation {isOpen ? 'is-open' : ''}"
		onclick={toggleSearch}
		aria-label={contentType === 'fda' ? 'FDA keresés' : contentType === 'ema' ? 'EMA keresés' : 'FDA/EMA keresés'}
		title={contentType === 'fda' ? 'Keresés FDA tartalomban (Ctrl+F)' : contentType === 'ema' ? 'Keresés EMA tartalomban (Ctrl+F)' : 'Keresés FDA/EMA tartalomban (Ctrl+F)'}
	>
		{#if isOpen}
			<X class="w-5 h-5 sm:w-6 sm:h-6" />
		{:else}
			<Search class="w-5 h-5 sm:w-6 sm:h-6" />
		{/if}
	</button>
</div>
{/if}

<style>
	/* Floating Action Button with Glow */
	.search-fab {
		position: relative;
		box-shadow:
			0 4px 15px rgba(6, 182, 212, 0.4),
			0 0 30px rgba(6, 182, 212, 0.3),
			0 0 60px rgba(6, 182, 212, 0.15);
		animation: fab-glow 2s ease-in-out infinite;
	}

	.search-fab::before {
		content: '';
		position: absolute;
		inset: -3px;
		border-radius: 50%;
		background: linear-gradient(135deg, rgba(6, 182, 212, 0.6), rgba(59, 130, 246, 0.6));
		z-index: -1;
		animation: fab-ring-pulse 2s ease-in-out infinite;
		opacity: 0.5;
	}

	.search-fab:hover {
		box-shadow:
			0 6px 20px rgba(6, 182, 212, 0.5),
			0 0 40px rgba(6, 182, 212, 0.4),
			0 0 80px rgba(6, 182, 212, 0.2);
	}

	.search-fab.is-open {
		animation: none;
		box-shadow:
			0 4px 15px rgba(6, 182, 212, 0.3),
			0 0 20px rgba(6, 182, 212, 0.2);
	}

	.search-fab.is-open::before {
		animation: none;
		opacity: 0.3;
	}

	@keyframes fab-glow {
		0%, 100% {
			box-shadow:
				0 4px 15px rgba(6, 182, 212, 0.4),
				0 0 30px rgba(6, 182, 212, 0.3),
				0 0 60px rgba(6, 182, 212, 0.15);
		}
		50% {
			box-shadow:
				0 4px 20px rgba(6, 182, 212, 0.6),
				0 0 45px rgba(6, 182, 212, 0.45),
				0 0 80px rgba(6, 182, 212, 0.25);
		}
	}

	@keyframes fab-ring-pulse {
		0%, 100% {
			transform: scale(1);
			opacity: 0.5;
		}
		50% {
			transform: scale(1.1);
			opacity: 0.3;
		}
	}

	/* Global highlight styles */
	:global(mark.fda-global-highlight) {
		background: rgba(34, 211, 238, 0.25);
		color: inherit;
		padding: 0.0625rem 0.1875rem;
		border-radius: 0.1875rem;
		box-shadow: 0 0 6px rgba(34, 211, 238, 0.3);
		transition: all 0.15s ease;
	}

	:global(mark.fda-global-highlight-current) {
		background: rgba(34, 211, 238, 0.5);
		box-shadow: 0 0 12px rgba(34, 211, 238, 0.6), 0 0 20px rgba(34, 211, 238, 0.3);
		outline: 2px solid rgba(34, 211, 238, 0.6);
		animation: highlight-pulse 1.5s ease-in-out infinite;
	}

	@keyframes highlight-pulse {
		0%,
		100% {
			box-shadow: 0 0 12px rgba(34, 211, 238, 0.6), 0 0 20px rgba(34, 211, 238, 0.3);
		}
		50% {
			box-shadow: 0 0 16px rgba(34, 211, 238, 0.8), 0 0 30px rgba(34, 211, 238, 0.4);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.search-fab {
			animation: none;
		}
		.search-fab::before {
			animation: none;
		}
		:global(mark.fda-global-highlight-current) {
			animation: none;
		}
	}
</style>
