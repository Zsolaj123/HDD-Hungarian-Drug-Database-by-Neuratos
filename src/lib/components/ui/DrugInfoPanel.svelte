<script lang="ts">
	/**
	 * DrugInfoPanel.svelte - Full drug information display
	 *
	 * Features:
	 * - Full drug details from PUPHAX (55 fields)
	 * - Active ingredient with alternative brand names
	 * - ATC classification
	 * - Prescription and reimbursement status
	 * - DDD (Defined Daily Dose) information
	 * - Collapsible sections
	 * - Loading state for lazy-loaded data
	 * - Galaxy-inspired dark theme
	 */

	import type { ExtendedDrug, DrugSummaryLight } from '$lib/services/puphax-api-service';
	import {
		puphaxService,
		formatDrugWithStrength,
		getPrescriptionLabel,
		getReimbursementLabel,
		formatDDD,
		formatPrice,
		formatSupportPercent
	} from '$lib/services/puphax-api-service';
	import {
		Pill,
		ChevronDown,
		ChevronUp,
		Loader2,
		AlertCircle,
		Beaker,
		Tag,
		Package,
		Calendar,
		DollarSign,
		Info,
		FlaskConical,
		Layers,
		X
	} from 'lucide-svelte';
	import { slide, fade } from 'svelte/transition';

	// ============================================================================
	// Types
	// ============================================================================

	interface Section {
		id: string;
		label: string;
		icon: typeof Pill;
		expanded: boolean;
	}

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		/** Drug ID to load details for */
		drugId?: string;
		/** Pre-loaded drug summary (light data) */
		drugSummary?: DrugSummaryLight | null;
		/** Pre-loaded extended drug data */
		extendedDrug?: ExtendedDrug | null;
		/** Alternative drugs with same active ingredient */
		alternatives?: DrugSummaryLight[];
		/** Show close button */
		showClose?: boolean;
		/** Compact mode (fewer sections) */
		compact?: boolean;
		/** Close callback */
		onclose?: () => void;
		/** Custom class */
		class?: string;
	}

	let {
		drugId,
		drugSummary = null,
		extendedDrug = null,
		alternatives = [],
		showClose = false,
		compact = false,
		onclose,
		class: className = ''
	}: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let loading = $state(false);
	let error = $state<string | null>(null);
	let loadedDrug = $state<ExtendedDrug | null>(null);
	let loadingAlternatives = $state(false);
	let loadedAlternatives = $state<DrugSummaryLight[]>([]);

	// Section collapse state
	let sections = $state<Section[]>([
		{ id: 'basic', label: 'Alapadatok', icon: Info, expanded: true },
		{ id: 'composition', label: 'Összetétel', icon: FlaskConical, expanded: true },
		{ id: 'dosage', label: 'Adagolás', icon: Beaker, expanded: !compact },
		{ id: 'packaging', label: 'Kiszerelés', icon: Package, expanded: !compact },
		{ id: 'reimbursement', label: 'Támogatás', icon: DollarSign, expanded: !compact },
		{ id: 'alternatives', label: 'Alternatívák', icon: Layers, expanded: false }
	]);

	// Derived: Combine prop data with loaded data
	const drug = $derived(extendedDrug ?? loadedDrug);
	const altDrugs = $derived(alternatives.length > 0 ? alternatives : loadedAlternatives);

	// ============================================================================
	// Effects
	// ============================================================================

	// Track drugId changes and load details
	let previousDrugId = $state<string | undefined>(undefined);

	$effect(() => {
		if (drugId && drugId !== previousDrugId && !extendedDrug) {
			previousDrugId = drugId;
			loadDrugDetails(drugId);
		}
	});

	// ============================================================================
	// Data Loading
	// ============================================================================

	async function loadDrugDetails(id: string) {
		loading = true;
		error = null;

		try {
			const details = await puphaxService.getDrugDetails(id);
			if (details) {
				loadedDrug = details;
				// Load alternatives if we have active ingredient
				if (details.activeIngredient && alternatives.length === 0) {
					loadAlternatives(details.activeIngredient, details.id);
				}
			} else {
				error = 'Nem sikerült betölteni a gyógyszer adatait';
			}
		} catch (e) {
			console.error('[DrugInfoPanel] Load error:', e);
			error = 'Hiba történt az adatok betöltésekor';
		} finally {
			loading = false;
		}
	}

	async function loadAlternatives(activeIngredient: string, currentDrugId?: string) {
		if (!activeIngredient) return;

		loadingAlternatives = true;
		try {
			const alts = await puphaxService.getAlternatives(activeIngredient, 10);
			// Filter out current drug
			loadedAlternatives = alts.filter((a) => a.id !== currentDrugId);
		} catch (e) {
			console.error('[DrugInfoPanel] Alternatives error:', e);
		} finally {
			loadingAlternatives = false;
		}
	}

	// ============================================================================
	// Handlers
	// ============================================================================

	function toggleSection(sectionId: string) {
		sections = sections.map((s) => (s.id === sectionId ? { ...s, expanded: !s.expanded } : s));
	}

	function isSectionExpanded(sectionId: string): boolean {
		return sections.find((s) => s.id === sectionId)?.expanded ?? false;
	}

	// ============================================================================
	// Derived
	// ============================================================================

	const displayDrug = $derived(drug || drugSummary);
	const hasExtendedData = $derived(!!drug);
	const ddd = $derived(drug ? formatDDD(drug) : null);
</script>

<div class="drug-info-panel {className}" class:compact>
	<!-- Header -->
	<div class="panel-header">
		<div class="header-content">
			<div class="drug-icon">
				<Pill class="h-5 w-5" />
			</div>
			<div class="header-text">
				{#if displayDrug}
					<h3 class="drug-name">{formatDrugWithStrength(displayDrug)}</h3>
					{#if displayDrug.manufacturer}
						<p class="manufacturer">{displayDrug.manufacturer}</p>
					{/if}
				{:else if loading}
					<div class="skeleton-text w-48 h-5"></div>
					<div class="skeleton-text w-32 h-4 mt-1"></div>
				{:else}
					<p class="no-drug">Nincs kiválasztott gyógyszer</p>
				{/if}
			</div>
		</div>

		<div class="header-badges">
			{#if displayDrug}
				<span
					class="badge"
					class:prescription={displayDrug.prescriptionRequired}
					class:otc={!displayDrug.prescriptionRequired}
				>
					{displayDrug.prescriptionRequired ? 'Rx' : 'OTC'}
				</span>
				{#if displayDrug.reimbursable !== undefined}
					<span class="badge" class:reimbursable={displayDrug.reimbursable}>
						{displayDrug.reimbursable ? 'TB' : 'NTB'}
					</span>
				{/if}
			{/if}

			{#if showClose}
				<button type="button" class="close-btn" onclick={onclose} aria-label="Bezárás">
					<X class="h-4 w-4" />
				</button>
			{/if}
		</div>
	</div>

	<!-- Loading State -->
	{#if loading}
		<div class="loading-state" transition:fade={{ duration: 150 }}>
			<Loader2 class="h-6 w-6 animate-spin" />
			<span>Adatok betöltése...</span>
		</div>
	{/if}

	<!-- Error State -->
	{#if error}
		<div class="error-state" transition:fade={{ duration: 150 }}>
			<AlertCircle class="h-5 w-5" />
			<span>{error}</span>
		</div>
	{/if}

	<!-- Content -->
	{#if displayDrug && !loading}
		<div class="panel-content">
			<!-- Basic Info Section -->
			<div class="section">
				<button
					type="button"
					class="section-header"
					onclick={() => toggleSection('basic')}
					aria-expanded={isSectionExpanded('basic')}
				>
					<div class="section-title">
						<Info class="h-4 w-4" />
						<span>Alapadatok</span>
					</div>
					{#if isSectionExpanded('basic')}
						<ChevronUp class="h-4 w-4" />
					{:else}
						<ChevronDown class="h-4 w-4" />
					{/if}
				</button>

				{#if isSectionExpanded('basic')}
					<div class="section-content" transition:slide={{ duration: 150 }}>
						<div class="info-grid">
							<div class="info-item">
								<span class="info-label">Gyógyszer neve</span>
								<span class="info-value">{displayDrug.name}</span>
							</div>
							{#if displayDrug.atcCode}
								<div class="info-item">
									<span class="info-label">ATC kód</span>
									<span class="info-value font-mono">{displayDrug.atcCode}</span>
								</div>
							{/if}
							{#if displayDrug.productForm}
								<div class="info-item">
									<span class="info-label">Gyógyszerforma</span>
									<span class="info-value">{displayDrug.productForm}</span>
								</div>
							{/if}
							<div class="info-item">
								<span class="info-label">Státusz</span>
								<span class="info-value">{getPrescriptionLabel(displayDrug)}</span>
							</div>
							{#if displayDrug.reimbursable !== undefined}
								<div class="info-item">
									<span class="info-label">Támogatás</span>
									<span class="info-value">{getReimbursementLabel(displayDrug)}</span>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<!-- Composition Section -->
			<div class="section">
				<button
					type="button"
					class="section-header"
					onclick={() => toggleSection('composition')}
					aria-expanded={isSectionExpanded('composition')}
				>
					<div class="section-title">
						<FlaskConical class="h-4 w-4" />
						<span>Összetétel</span>
					</div>
					{#if isSectionExpanded('composition')}
						<ChevronUp class="h-4 w-4" />
					{:else}
						<ChevronDown class="h-4 w-4" />
					{/if}
				</button>

				{#if isSectionExpanded('composition')}
					<div class="section-content" transition:slide={{ duration: 150 }}>
						<div class="info-grid">
							<div class="info-item full-width">
								<span class="info-label">Hatóanyag</span>
								<span class="info-value highlight">{displayDrug.activeIngredient}</span>
							</div>
							{#if displayDrug.strength}
								<div class="info-item">
									<span class="info-label">Hatáserősség</span>
									<span class="info-value">{displayDrug.strength}</span>
								</div>
							{/if}
							{#if drug?.activeIngredients && drug.activeIngredients.length > 1}
								<div class="info-item full-width">
									<span class="info-label">Összes hatóanyag</span>
									<span class="info-value">{drug.activeIngredients.join(', ')}</span>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<!-- Dosage Section (Extended data only) -->
			{#if hasExtendedData && !compact}
				<div class="section">
					<button
						type="button"
						class="section-header"
						onclick={() => toggleSection('dosage')}
						aria-expanded={isSectionExpanded('dosage')}
					>
						<div class="section-title">
							<Beaker class="h-4 w-4" />
							<span>Adagolás</span>
						</div>
						{#if isSectionExpanded('dosage')}
							<ChevronUp class="h-4 w-4" />
						{:else}
							<ChevronDown class="h-4 w-4" />
						{/if}
					</button>

					{#if isSectionExpanded('dosage')}
						<div class="section-content" transition:slide={{ duration: 150 }}>
							<div class="info-grid">
								{#if ddd}
									<div class="info-item">
										<span class="info-label">Napi dózis (DDD)</span>
										<span class="info-value highlight">{ddd}</span>
									</div>
								{/if}
								{#if drug?.adagMod}
									<div class="info-item">
										<span class="info-label">Beviteli mód</span>
										<span class="info-value">{drug.adagMod}</span>
									</div>
								{/if}
								{#if drug?.adagMenny && drug?.adagEgys}
									<div class="info-item">
										<span class="info-label">Egyszeri adag</span>
										<span class="info-value">{drug.adagMenny} {drug.adagEgys}</span>
									</div>
								{/if}
								{#if drug?.hatoMenny && drug?.hatoEgys}
									<div class="info-item">
										<span class="info-label">Hatóanyag mennyiség</span>
										<span class="info-value">{drug.hatoMenny} {drug.hatoEgys}</span>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Packaging Section (Extended data only) -->
			{#if hasExtendedData && !compact}
				<div class="section">
					<button
						type="button"
						class="section-header"
						onclick={() => toggleSection('packaging')}
						aria-expanded={isSectionExpanded('packaging')}
					>
						<div class="section-title">
							<Package class="h-4 w-4" />
							<span>Kiszerelés</span>
						</div>
						{#if isSectionExpanded('packaging')}
							<ChevronUp class="h-4 w-4" />
						{:else}
							<ChevronDown class="h-4 w-4" />
						{/if}
					</button>

					{#if isSectionExpanded('packaging')}
						<div class="section-content" transition:slide={{ duration: 150 }}>
							<div class="info-grid">
								{#if displayDrug.packSize}
									<div class="info-item">
										<span class="info-label">Kiszerelés</span>
										<span class="info-value">{displayDrug.packSize}</span>
									</div>
								{/if}
								{#if drug?.kiszMenny && drug?.kiszEgys}
									<div class="info-item">
										<span class="info-label">Mennyiség</span>
										<span class="info-value">{drug.kiszMenny} {drug.kiszEgys}</span>
									</div>
								{/if}
								{#if drug?.gyForma}
									<div class="info-item">
										<span class="info-label">Forma</span>
										<span class="info-value">{drug.gyForma}</span>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Reimbursement Section (Extended data only) -->
			{#if hasExtendedData && drug?.price !== undefined && !compact}
				<div class="section">
					<button
						type="button"
						class="section-header"
						onclick={() => toggleSection('reimbursement')}
						aria-expanded={isSectionExpanded('reimbursement')}
					>
						<div class="section-title">
							<DollarSign class="h-4 w-4" />
							<span>Támogatás</span>
						</div>
						{#if isSectionExpanded('reimbursement')}
							<ChevronUp class="h-4 w-4" />
						{:else}
							<ChevronDown class="h-4 w-4" />
						{/if}
					</button>

					{#if isSectionExpanded('reimbursement')}
						<div class="section-content" transition:slide={{ duration: 150 }}>
							<div class="info-grid">
								<div class="info-item">
									<span class="info-label">Ár</span>
									<span class="info-value">{formatPrice(drug.price)}</span>
								</div>
								{#if drug.supportPercent !== undefined}
									<div class="info-item">
										<span class="info-label">Támogatás mértéke</span>
										<span class="info-value highlight"
											>{formatSupportPercent(drug.supportPercent)}</span
										>
									</div>
								{/if}
								{#if drug.validFrom}
									<div class="info-item">
										<span class="info-label">Érvényes</span>
										<span class="info-value">{drug.validFrom}</span>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Alternatives Section -->
			{#if (altDrugs.length > 0 || loadingAlternatives) && !compact}
				<div class="section">
					<button
						type="button"
						class="section-header"
						onclick={() => toggleSection('alternatives')}
						aria-expanded={isSectionExpanded('alternatives')}
					>
						<div class="section-title">
							<Layers class="h-4 w-4" />
							<span>Generikus alternatívák</span>
							{#if altDrugs.length > 0}
								<span class="count-badge">{altDrugs.length}</span>
							{/if}
						</div>
						{#if isSectionExpanded('alternatives')}
							<ChevronUp class="h-4 w-4" />
						{:else}
							<ChevronDown class="h-4 w-4" />
						{/if}
					</button>

					{#if isSectionExpanded('alternatives')}
						<div class="section-content" transition:slide={{ duration: 150 }}>
							{#if loadingAlternatives}
								<div class="loading-inline">
									<Loader2 class="h-4 w-4 animate-spin" />
									<span>Alternatívák keresése...</span>
								</div>
							{:else}
								<div class="alternatives-list">
									{#each altDrugs as alt}
										<div class="alternative-item">
											<span class="alt-name">{alt.name}</span>
											{#if alt.strength}
												<span class="alt-strength">{alt.strength}</span>
											{/if}
											{#if alt.manufacturer}
												<span class="alt-manufacturer">{alt.manufacturer}</span>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Empty State -->
	{#if !displayDrug && !loading && !error}
		<div class="empty-state">
			<Pill class="h-8 w-8" />
			<p>Válasszon ki egy gyógyszert a részletek megtekintéséhez</p>
		</div>
	{/if}
</div>

<style>
	.drug-info-panel {
		display: flex;
		flex-direction: column;
		background: rgba(15, 23, 42, 0.95);
		border: 1px solid rgba(71, 85, 105, 0.5);
		border-radius: 16px;
		overflow: hidden;
	}

	.drug-info-panel.compact {
		border-radius: 12px;
	}

	/* Header */
	.panel-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 20px;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%);
		border-bottom: 1px solid rgba(71, 85, 105, 0.3);
	}

	.compact .panel-header {
		padding: 16px;
	}

	.header-content {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		flex: 1;
		min-width: 0;
	}

	.drug-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		background: rgba(59, 130, 246, 0.2);
		border: 1px solid rgba(59, 130, 246, 0.4);
		border-radius: 12px;
		color: #3b82f6;
		flex-shrink: 0;
	}

	.header-text {
		flex: 1;
		min-width: 0;
	}

	.drug-name {
		font-size: 18px;
		font-weight: 700;
		color: #f1f5f9;
		margin: 0;
		line-height: 1.3;
	}

	.manufacturer {
		font-size: 13px;
		color: #94a3b8;
		margin: 4px 0 0 0;
	}

	.no-drug {
		font-size: 14px;
		color: #64748b;
		margin: 0;
	}

	.header-badges {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.badge {
		padding: 4px 10px;
		font-size: 11px;
		font-weight: 700;
		border-radius: 6px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.badge.prescription {
		background: rgba(239, 68, 68, 0.2);
		color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.4);
	}

	.badge.otc {
		background: rgba(16, 185, 129, 0.2);
		color: #10b981;
		border: 1px solid rgba(16, 185, 129, 0.4);
	}

	.badge.reimbursable {
		background: rgba(59, 130, 246, 0.2);
		color: #3b82f6;
		border: 1px solid rgba(59, 130, 246, 0.4);
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: rgba(71, 85, 105, 0.4);
		border: 1px solid rgba(71, 85, 105, 0.6);
		border-radius: 8px;
		color: #94a3b8;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.close-btn:hover {
		background: rgba(239, 68, 68, 0.2);
		border-color: rgba(239, 68, 68, 0.4);
		color: #ef4444;
	}

	/* Loading & Error States */
	.loading-state,
	.error-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 40px 20px;
		text-align: center;
	}

	.loading-state {
		color: #3b82f6;
	}

	.error-state {
		color: #ef4444;
	}

	.empty-state {
		color: #64748b;
	}

	.loading-state span,
	.error-state span,
	.empty-state p {
		font-size: 14px;
		margin: 0;
	}

	/* Content */
	.panel-content {
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		max-height: 500px;
	}

	.compact .panel-content {
		max-height: 300px;
	}

	/* Sections */
	.section {
		border-bottom: 1px solid rgba(71, 85, 105, 0.3);
	}

	.section:last-child {
		border-bottom: none;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 14px 20px;
		background: transparent;
		border: none;
		color: #94a3b8;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.compact .section-header {
		padding: 12px 16px;
	}

	.section-header:hover {
		background: rgba(59, 130, 246, 0.1);
		color: #e2e8f0;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.section-title :global(svg) {
		color: #3b82f6;
	}

	.count-badge {
		padding: 2px 8px;
		font-size: 11px;
		background: rgba(59, 130, 246, 0.2);
		color: #3b82f6;
		border-radius: 10px;
	}

	.section-content {
		padding: 0 20px 16px;
	}

	.compact .section-content {
		padding: 0 16px 12px;
	}

	/* Info Grid */
	.info-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
	}

	.info-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.info-item.full-width {
		grid-column: 1 / -1;
	}

	.info-label {
		font-size: 11px;
		font-weight: 600;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.info-value {
		font-size: 14px;
		color: #f1f5f9;
	}

	.info-value.font-mono {
		font-family: 'Fira Code', 'JetBrains Mono', monospace;
	}

	.info-value.highlight {
		color: #3b82f6;
		font-weight: 600;
	}

	/* Loading Inline */
	.loading-inline {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #64748b;
		font-size: 13px;
	}

	/* Alternatives List */
	.alternatives-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.alternative-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		background: rgba(51, 65, 85, 0.4);
		border: 1px solid rgba(71, 85, 105, 0.4);
		border-radius: 8px;
	}

	.alt-name {
		font-size: 13px;
		font-weight: 500;
		color: #e2e8f0;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.alt-strength {
		font-size: 12px;
		color: #3b82f6;
		font-weight: 600;
	}

	.alt-manufacturer {
		font-size: 11px;
		color: #64748b;
	}

	/* Skeleton */
	.skeleton-text {
		background: linear-gradient(
			90deg,
			rgba(71, 85, 105, 0.3) 25%,
			rgba(71, 85, 105, 0.5) 50%,
			rgba(71, 85, 105, 0.3) 75%
		);
		background-size: 200% 100%;
		animation: skeleton-shimmer 1.5s infinite;
		border-radius: 4px;
	}

	@keyframes skeleton-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	/* Animation */
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.animate-spin {
		animation: spin 1s linear infinite;
	}

	/* Responsive */
	@media (max-width: 480px) {
		.panel-header {
			flex-direction: column;
			gap: 12px;
		}

		.header-badges {
			align-self: flex-start;
		}

		.info-grid {
			grid-template-columns: 1fr;
		}

		.info-item.full-width {
			grid-column: 1;
		}

		.alternative-item {
			flex-wrap: wrap;
		}

		.alt-name {
			flex-basis: 100%;
		}
	}

	/* Reduced Motion */
	@media (prefers-reduced-motion: reduce) {
		.section-header,
		.close-btn {
			transition: none;
		}

		.skeleton-text {
			animation: none;
		}

		.animate-spin {
			animation: none;
		}
	}
</style>
