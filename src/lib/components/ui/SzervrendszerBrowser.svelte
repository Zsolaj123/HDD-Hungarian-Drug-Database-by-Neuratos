<script lang="ts">
	/**
	 * SzervrendszerBrowser - Organ System Browser Component
	 *
	 * Visual grid of organ systems with Galaxy styling.
	 * Supports filtering, expansion, and subgroup navigation.
	 */

	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import {
		szervrendszerService,
		type OrganSystem,
		type OrganSystemStats
	} from '$lib/services/szervrendszer-service';
	import {
		Brain,
		Heart,
		Utensils,
		Bone,
		Droplet,
		Wind,
		Target,
		Bug,
		Scan,
		Sparkles,
		Eye,
		Droplets,
		ChevronDown,
		ChevronUp,
		X,
		Pill
	} from 'lucide-svelte';

	// Props
	interface Props {
		onCodeSelect?: (code: string) => void;
		onSystemFilter?: (systemId: string, subgroupId?: string) => void;
		onClearFilter?: () => void;
		showDrugCounts?: boolean;
		compact?: boolean;
		selectedSystemId?: string | null;
	}

	let {
		onCodeSelect,
		onSystemFilter,
		onClearFilter,
		showDrugCounts = true,
		compact = false,
		selectedSystemId = null
	}: Props = $props();

	// State
	let organSystems = $state<OrganSystem[]>([]);
	let stats = $state<Map<string, OrganSystemStats>>(new Map());
	let expandedSystemIds = $state<string[]>([]);
	let isLoading = $state(true);
	let statsLoading = $state(false);

	// Icon mapping
	const iconMap: Record<string, typeof Brain> = {
		Brain,
		Heart,
		Utensils,
		Bone,
		Droplet,
		Wind,
		Target,
		Bug,
		Scan,
		Sparkles,
		Eye,
		Droplets
	};

	// Initialize
	onMount(async () => {
		await szervrendszerService.initialize();
		organSystems = szervrendszerService.getAllOrganSystems();
		isLoading = false;

		// Load stats in background
		if (showDrugCounts) {
			statsLoading = true;
			stats = await szervrendszerService.getSystemStats();
			statsLoading = false;
		}
	});

	// Functions
	function toggleSystem(systemId: string) {
		if (expandedSystemIds.includes(systemId)) {
			expandedSystemIds = expandedSystemIds.filter(id => id !== systemId);
		} else {
			expandedSystemIds = [...expandedSystemIds, systemId];
		}
	}

	function handleSystemClick(system: OrganSystem) {
		if (system.subgroups.length > 0) {
			toggleSystem(system.id);
		} else {
			onSystemFilter?.(system.id);
		}
	}

	function handleSubgroupClick(systemId: string, subgroupId: string) {
		onSystemFilter?.(systemId, subgroupId);
	}

	function getIcon(iconName: string) {
		return iconMap[iconName] || Brain;
	}

	function getSystemStats(systemId: string) {
		return stats.get(systemId);
	}
</script>

{#if isLoading}
	<div class="szervrendszer-loading">
		<div class="loading-grid">
			{#each Array(6) as _}
				<div class="loading-card animate-pulse"></div>
			{/each}
		</div>
	</div>
{:else}
	<div class="szervrendszer-browser" class:compact>
		<!-- Selected filter indicator -->
		{#if selectedSystemId}
			{@const selectedSystem = organSystems.find((s) => s.id === selectedSystemId)}
			{#if selectedSystem}
				<div class="active-filter" transition:slide={{ duration: 200 }}>
					<div class="filter-content">
						<svelte:component
							this={getIcon(selectedSystem.icon)}
							class="h-4 w-4"
							style="color: {selectedSystem.color}"
						/>
						<span class="filter-label">Szűrő: {selectedSystem.name}</span>
					</div>
					<button class="clear-filter" onclick={() => onClearFilter?.()}>
						<X class="h-4 w-4" />
					</button>
				</div>
			{/if}
		{/if}

		<!-- Organ system grid -->
		<div class="szervrendszer-grid">
			{#each organSystems as system}
				{@const systemStats = getSystemStats(system.id)}
				{@const isExpanded = expandedSystemIds.includes(system.id)}
				{@const isSelected = selectedSystemId === system.id}
				{@const IconComponent = getIcon(system.icon)}

				<button
					class="organ-card"
					class:expanded={isExpanded}
					class:selected={isSelected}
					style="--accent-color: {system.color}"
					onclick={() => handleSystemClick(system)}
				>
					<div class="organ-icon" style="background: {system.color}20">
						<IconComponent class="h-6 w-6" style="color: {system.color}" />
					</div>

					<span class="organ-name">{system.name}</span>

					{#if showDrugCounts && systemStats}
						<div class="organ-stats">
							<span class="stat-item code-count">
								{systemStats.codeCount} kód
							</span>
							<span class="stat-item drug-count">
								<Pill class="h-3 w-3" />
								{systemStats.drugCount}
							</span>
						</div>
					{:else if statsLoading}
						<div class="organ-stats">
							<span class="stat-loading animate-pulse"></span>
						</div>
					{/if}

					{#if system.subgroups.length > 0}
						<div class="expand-indicator">
							{#if isExpanded}
								<ChevronUp class="h-4 w-4 text-slate-400" />
							{:else}
								<ChevronDown class="h-4 w-4 text-slate-400" />
							{/if}
						</div>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Expanded subgroups -->
		{#if expandedSystemIds.length > 0}
			<div class="subgroups-container" transition:slide={{ duration: 200 }}>
				{#each expandedSystemIds as systemId}
					{@const system = organSystems.find((s) => s.id === systemId)}
					{#if system?.subgroups.length}
						<div class="subgroup-section" style="--accent-color: {system.color}">
							<h4 class="subgroup-header">
								<svelte:component
									this={getIcon(system.icon)}
									class="h-4 w-4"
									style="color: {system.color}"
								/>
								{system.name} - Alcsoportok
							</h4>
							<div class="subgroup-chips">
								{#each [...system.subgroups].sort((a, b) => a.priority - b.priority) as subgroup}
									{@const subStats = getSystemStats(systemId)?.subgroupStats.get(subgroup.id)}
									<button
										class="subgroup-chip"
										onclick={() => handleSubgroupClick(systemId, subgroup.id)}
									>
										<span class="subgroup-name">{subgroup.name}</span>
										<span class="subgroup-codes">{subgroup.codes[0]}</span>
										{#if subStats}
											<span class="subgroup-drug-count">
												<Pill class="h-2.5 w-2.5" />
												{subStats.drugCount}
											</span>
										{/if}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.szervrendszer-browser {
		width: 100%;
	}

	/* Loading state */
	.szervrendszer-loading {
		padding: 0.5rem;
	}

	.loading-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
	}

	@media (max-width: 768px) {
		.loading-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.loading-card {
		height: 5rem;
		background: linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8));
		border-radius: 0.75rem;
	}

	/* Active filter indicator */
	.active-filter {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.75rem;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05));
		border: 1px solid rgba(59, 130, 246, 0.3);
		border-radius: 0.5rem;
	}

	.filter-content {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.filter-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(147, 197, 253);
	}

	.clear-filter {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		background: transparent;
		border: none;
		border-radius: 0.25rem;
		color: rgb(148, 163, 184);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.clear-filter:hover {
		background: rgba(239, 68, 68, 0.2);
		color: rgb(252, 165, 165);
	}

	/* Organ system grid */
	.szervrendszer-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
	}

	@media (max-width: 1024px) {
		.szervrendszer-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.szervrendszer-grid {
			grid-template-columns: 1fr;
		}
	}

	.compact .szervrendszer-grid {
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}

	/* Organ card - Galaxy brutalist style */
	.organ-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem;
		background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9));
		border: 1px solid rgba(100, 116, 139, 0.3);
		border-radius: 0.75rem;
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: center;
	}

	.organ-card:hover {
		transform: translateY(-2px);
		border-color: var(--accent-color, rgba(100, 116, 139, 0.5));
		box-shadow: 0 4px 20px color-mix(in srgb, var(--accent-color, #64748b) 20%, transparent);
	}

	.organ-card.selected {
		border-color: var(--accent-color);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 30%, transparent);
	}

	.organ-card.expanded {
		border-color: var(--accent-color);
	}

	.compact .organ-card {
		padding: 0.625rem;
		gap: 0.375rem;
	}

	.organ-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.625rem;
	}

	.compact .organ-icon {
		width: 2rem;
		height: 2rem;
	}

	.organ-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: rgb(226, 232, 240);
		line-height: 1.25;
	}

	.compact .organ-name {
		font-size: 0.75rem;
	}

	.organ-stats {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.stat-item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.6875rem;
		padding: 0.125rem 0.375rem;
		border-radius: 9999px;
	}

	.code-count {
		background: rgba(100, 116, 139, 0.2);
		color: rgb(148, 163, 184);
	}

	.drug-count {
		background: rgba(16, 185, 129, 0.15);
		color: rgb(52, 211, 153);
	}

	.stat-loading {
		width: 3rem;
		height: 1rem;
		background: rgba(100, 116, 139, 0.3);
		border-radius: 9999px;
	}

	.expand-indicator {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
	}

	/* Subgroups */
	.subgroups-container {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.subgroup-section {
		padding: 0.875rem;
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent-color, #64748b) 8%, rgba(30, 41, 59, 0.6)),
			rgba(15, 23, 42, 0.8)
		);
		border: 1px solid color-mix(in srgb, var(--accent-color, #64748b) 30%, transparent);
		border-radius: 0.625rem;
	}

	.subgroup-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.625rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: rgb(203, 213, 225);
	}

	.subgroup-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.subgroup-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		background: rgba(30, 41, 59, 0.6);
		border: 1px solid rgba(100, 116, 139, 0.3);
		border-radius: 0.375rem;
		font-size: 0.75rem;
		color: rgb(226, 232, 240);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.subgroup-chip:hover {
		background: rgba(51, 65, 85, 0.8);
		border-color: var(--accent-color);
	}

	.subgroup-name {
		font-weight: 500;
	}

	.subgroup-codes {
		font-family: ui-monospace, monospace;
		font-size: 0.6875rem;
		padding: 0.0625rem 0.25rem;
		background: rgba(100, 116, 139, 0.2);
		color: rgb(148, 163, 184);
		border-radius: 0.25rem;
	}

	.subgroup-drug-count {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		font-size: 0.625rem;
		padding: 0.0625rem 0.25rem;
		background: rgba(16, 185, 129, 0.15);
		color: rgb(52, 211, 153);
		border-radius: 0.25rem;
	}

	/* Animation */
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.animate-pulse {
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
</style>
