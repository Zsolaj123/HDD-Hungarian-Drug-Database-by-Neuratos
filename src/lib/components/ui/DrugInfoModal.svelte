<script lang="ts">
	/**
	 * DrugInfoModal.svelte - Clinical-focused drug information modal
	 *
	 * Features:
	 * - Quick clinical overview (dosage, DDD, route)
	 * - Clinical warnings with severity badges
	 * - Contraindications & interactions from FDA
	 * - BNO indications from NEAK
	 * - Egyedi méltányosság (special reimbursement) info
	 * - Prescriber eligibility requirements
	 * - Dark theme with Galaxy UI patterns
	 */

	import type { Drug, SimplifiedDrug } from '$lib/services/drug-database-service';
	import { drugClinicalService, type DrugClinicalData, type ClinicalWarning } from '$lib/services/drug-clinical-service';
	import { ogyeiService, type OgyeiSearchResult } from '$lib/services/ogyei-service';
	import ClinicalBadge from './ClinicalBadge.svelte';
	import FdaContentDisplay from './FdaContentDisplay.svelte';
	import {
		X,
		Pill,
		FlaskConical,
		Package,
		Info,
		ExternalLink,
		AlertTriangle,
		CheckCircle2,
		XCircle,
		ChevronDown,
		ChevronRight,
		Loader2,
		Stethoscope,
		ShieldAlert,
		Sparkles,
		UserCheck,
		Ban,
		Flag,
		Building2,
		Calendar,
		AlertOctagon
	} from 'lucide-svelte';
	import { fade, scale, slide } from 'svelte/transition';
	import { goto } from '$app/navigation';

	// ============================================================================
	// Props
	// ============================================================================

	interface Props {
		drug: Drug | SimplifiedDrug | null;
		open?: boolean;
		onClose?: () => void;
	}

	let { drug, open = false, onClose }: Props = $props();

	// ============================================================================
	// State
	// ============================================================================

	let clinicalData = $state<DrugClinicalData | null>(null);
	let isLoadingClinical = $state(false);

	// OGYÉI data state
	let ogyeiData = $state<OgyeiSearchResult | null>(null);
	let isLoadingOgyei = $state(false);

	// Accordion states
	let showContraindications = $state(false);
	let showInteractions = $state(false);
	let showBnoIndications = $state(false);
	let showReimbursement = $state(false);
	let showPrescriber = $state(false);
	let showOgyei = $state(false);
	let expandedWarning = $state<string | null>(null);

	// ============================================================================
	// Load clinical data when drug changes
	// ============================================================================

	$effect(() => {
		if (open && drug) {
			loadClinicalData();
			loadOgyeiData();
		} else {
			clinicalData = null;
			ogyeiData = null;
			// Reset accordion states
			showContraindications = false;
			showInteractions = false;
			showBnoIndications = false;
			showReimbursement = false;
			showPrescriber = false;
			showOgyei = false;
			expandedWarning = null;
		}
	});

	async function loadClinicalData() {
		if (!drug) return;

		isLoadingClinical = true;
		try {
			clinicalData = await drugClinicalService.getClinicalData(
				drug.id,
				drug.name,
				drug.activeIngredient
			);
		} catch (error) {
			console.error('[DrugInfoModal] Failed to load clinical data:', error);
			clinicalData = null;
		}
		isLoadingClinical = false;
	}

	async function loadOgyeiData() {
		if (!drug) return;

		isLoadingOgyei = true;
		try {
			ogyeiData = await ogyeiService.searchByName(drug.name);
		} catch (error) {
			console.error('[DrugInfoModal] Failed to load OGYÉI data:', error);
			ogyeiData = null;
		}
		isLoadingOgyei = false;
	}

	// ============================================================================
	// Helpers
	// ============================================================================

	function getPrescriptionBadge(required: boolean): { text: string; class: string } {
		return required
			? { text: 'Vényköteles (Rx)', class: 'bg-red-500/20 text-red-400 border-red-500/30' }
			: { text: 'Szabadon kapható (OTC)', class: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
	}

	function getMarketStatusBadge(inMarket: boolean | undefined): { text: string; class: string; icon: typeof CheckCircle2 } {
		if (inMarket === undefined) {
			return { text: 'Ismeretlen', class: 'bg-slate-500/20 text-slate-400 border-slate-500/30', icon: Info };
		}
		return inMarket
			? { text: 'Forgalomban', class: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 }
			: { text: 'Forgalomból kivont', class: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: XCircle };
	}

	function formatDDD(ddd: { amount: string | null; unit: string | null; factor: string | null } | null | undefined): string | null {
		if (!ddd || !ddd.amount || !ddd.unit) return null;
		let result = `${ddd.amount} ${ddd.unit}`;
		if (ddd.factor && ddd.factor !== '1') {
			result += ` (faktor: ${ddd.factor})`;
		}
		return result;
	}

	function getRouteLabel(route: string | undefined): string {
		if (!route) return 'Ismeretlen';
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

	function getWarningBadgeSeverity(warning: ClinicalWarning): 'critical' | 'high' | 'moderate' | 'info' | 'special' {
		if (warning.type === 'reimbursement') return 'special';
		return warning.severity;
	}

	function getOgyeiPrescriptionStyle(code: string): { class: string; icon: typeof Pill } {
		switch (code) {
			case 'V':
				return { class: 'bg-red-500/20 text-red-400 border-red-500/30', icon: Pill };
			case 'Sz':
				return { class: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 };
			case 'I':
				return { class: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: Building2 };
			case 'VN':
				return { class: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: AlertTriangle };
			case 'J':
				return { class: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Info };
			default:
				return { class: 'bg-slate-500/20 text-slate-400 border-slate-500/30', icon: Pill };
		}
	}

	function handleClose() {
		onClose?.();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			handleClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			handleClose();
		}
	}

	function goToFullDetails() {
		if (drug?.id) {
			goto(`/drugs?id=${drug.id}`);
			handleClose();
		}
	}

	function goToBnoCode(code: string) {
		goto(`/bno?q=${encodeURIComponent(code)}`);
		handleClose();
	}

	function toggleWarning(warningId: string) {
		expandedWarning = expandedWarning === warningId ? null : warningId;
	}

	$effect(() => {
		if (open) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && drug}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
		onclick={handleBackdropClick}
		transition:fade={{ duration: 150 }}
		role="dialog"
		aria-modal="true"
		aria-labelledby="drug-info-title"
	>
		<!-- Modal Content -->
		<div
			class="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
			transition:scale={{ duration: 200, start: 0.95 }}
		>
			<!-- Header -->
			<div class="px-6 py-4 border-b border-slate-700 bg-slate-800/50">
				<div class="flex items-start justify-between gap-4">
					<div class="flex-1 min-w-0">
						<h2 id="drug-info-title" class="text-lg font-semibold text-white truncate">
							{drug.name}
						</h2>
						{#if drug.brandName && drug.brandName !== drug.name}
							<p class="text-sm text-slate-400 mt-0.5">{drug.brandName}</p>
						{/if}
					</div>
					<button
						type="button"
						class="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
						onclick={handleClose}
						aria-label="Bezárás"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				<!-- Status Badges -->
				<div class="flex flex-wrap gap-2 mt-3">
					{#if drug}
						{@const prescriptionBadge = getPrescriptionBadge(drug.prescriptionRequired)}
						{@const marketBadge = getMarketStatusBadge('inMarket' in drug ? drug.inMarket : undefined)}
						<span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border {prescriptionBadge.class}">
							{prescriptionBadge.text}
						</span>
						<span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border {marketBadge.class}">
							<svelte:component this={marketBadge.icon} class="h-3 w-3" />
							{marketBadge.text}
						</span>
					{/if}
				</div>

				<!-- Clinical Warning Badges -->
				{#if clinicalData && clinicalData.clinicalWarnings.length > 0}
					<div class="flex flex-wrap gap-2 mt-3">
						{#each clinicalData.clinicalWarnings.slice(0, 4) as warning (warning.id)}
							<ClinicalBadge
								severity={getWarningBadgeSeverity(warning)}
								label={warning.title}
								tooltip={warning.summary}
								compact
								onclick={() => toggleWarning(warning.id)}
							/>
						{/each}
						{#if clinicalData.clinicalWarnings.length > 4}
							<span class="inline-flex items-center px-2 py-0.5 text-xs text-slate-400 bg-slate-800 rounded-full">
								+{clinicalData.clinicalWarnings.length - 4} további
							</span>
						{/if}
					</div>
				{:else if isLoadingClinical}
					<div class="flex items-center gap-2 mt-3 text-xs text-slate-400">
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
						<span>Klinikai adatok betöltése...</span>
					</div>
				{/if}
			</div>

			<!-- Body -->
			<div class="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
				<!-- Clinical Info Grid -->
				<div class="grid grid-cols-2 gap-4">
					<!-- Active Ingredient -->
					<div class="col-span-2">
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
							<FlaskConical class="h-3.5 w-3.5" />
							<span>Hatóanyag</span>
						</div>
						<p class="text-white font-medium">
							{drug.activeIngredient || 'Nem ismert'}
						</p>
					</div>

					<!-- Dosage -->
					<div>
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
							<Pill class="h-3.5 w-3.5" />
							<span>Dózis</span>
						</div>
						<p class="text-blue-400 font-semibold text-lg">
							{drug.dosage || 'Nem ismert'}
						</p>
					</div>

					<!-- Route -->
					<div>
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
							<Info class="h-3.5 w-3.5" />
							<span>Beviteli mód</span>
						</div>
						<p class="text-white">
							{getRouteLabel(drug.route)}
						</p>
					</div>

					<!-- Form & ATC -->
					{#if drug.form}
						<div>
							<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
								<Package class="h-3.5 w-3.5" />
								<span>Gyógyszerforma</span>
							</div>
							<p class="text-slate-300 capitalize">{drug.form}</p>
						</div>
					{/if}

					{#if drug.atcCode}
						<div>
							<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
								<span class="font-mono text-[10px]">ATC</span>
							</div>
							<p class="text-slate-300 font-mono">{drug.atcCode}</p>
						</div>
					{/if}
				</div>

				<!-- DDD (Defined Daily Dose) -->
				{#if 'ddd' in drug && drug.ddd}
					{@const dddValue = formatDDD(drug.ddd)}
					{#if dddValue}
						<div class="p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
							<div class="flex items-center gap-2 text-xs text-blue-400 mb-1">
								<AlertTriangle class="h-3.5 w-3.5" />
								<span>DDD (Defined Daily Dose)</span>
							</div>
							<p class="text-white font-medium">{dddValue}</p>
						</div>
					{/if}
				{/if}

				<!-- ================================================================ -->
				<!-- Clinical Accordions -->
				<!-- ================================================================ -->

				{#if clinicalData}
					<!-- Contraindications (FDA) - Enhanced Display -->
					{#if clinicalData.fdaLabel?.contraindications}
						<FdaContentDisplay
							content={clinicalData.fdaLabel.contraindications}
							title="Ellenjavallatok (FDA)"
							variant="contraindication"
							compact
							maxHeight="200px"
							showStats={false}
						/>
					{/if}

					<!-- Drug Interactions (FDA) - Enhanced Display -->
					{#if clinicalData.fdaLabel?.drugInteractions}
						<FdaContentDisplay
							content={clinicalData.fdaLabel.drugInteractions}
							title="Gyógyszer-interakciók (FDA)"
							variant="interaction"
							compact
							maxHeight="200px"
							showStats={false}
						/>
					{/if}

					<!-- BNO Indications (NEAK) -->
					{#if clinicalData.bnoIndications.length > 0}
						<div class="border border-emerald-500/30 rounded-lg overflow-hidden">
							<button
								type="button"
								class="w-full px-4 py-3 flex items-center justify-between bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors"
								onclick={() => showBnoIndications = !showBnoIndications}
							>
								<div class="flex items-center gap-2">
									<Stethoscope class="h-4 w-4 text-emerald-400" />
									<span class="font-medium text-emerald-400">BNO Indikációk</span>
									<span class="px-1.5 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded">
										{clinicalData.bnoIndications.length}
									</span>
								</div>
								<svelte:component this={showBnoIndications ? ChevronDown : ChevronRight} class="h-4 w-4 text-emerald-400" />
							</button>
							{#if showBnoIndications}
								<div class="px-4 py-3 bg-slate-800/30 max-h-48 overflow-y-auto" transition:slide={{ duration: 200 }}>
									<div class="grid grid-cols-1 gap-2">
										{#each clinicalData.bnoIndications.slice(0, 10) as bno}
											<button
												type="button"
												class="flex items-start gap-2 text-left p-2 rounded hover:bg-slate-700/50 transition-colors"
												onclick={() => goToBnoCode(bno.code)}
											>
												<span class="font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded text-xs">
													{bno.code}
												</span>
												<span class="text-sm text-slate-300 line-clamp-1">{bno.description}</span>
												{#if bno.offLabel}
													<span class="text-xs text-amber-400 shrink-0">Off-label</span>
												{/if}
											</button>
										{/each}
										{#if clinicalData.bnoIndications.length > 10}
											<p class="text-xs text-slate-500 px-2">
												+{clinicalData.bnoIndications.length - 10} további indikáció
											</p>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Egyedi Méltányosság (NEAK) -->
					{#if clinicalData.hasEgyediMeltanyossag}
						{@const egyediPoints = clinicalData.euPointInfo.filter(ep => ep.isEgyediMeltanyossag)}
						<div class="border border-amber-400/40 rounded-lg overflow-hidden">
							<button
								type="button"
								class="w-full px-4 py-3 flex items-center justify-between bg-amber-400/10 hover:bg-amber-400/15 transition-colors"
								onclick={() => showReimbursement = !showReimbursement}
							>
								<div class="flex items-center gap-2">
									<Sparkles class="h-4 w-4 text-amber-300" />
									<span class="font-medium text-amber-300">Egyedi Méltányosság</span>
									{#each egyediPoints as ep}
										<span class="px-1.5 py-0.5 text-xs bg-amber-400/20 text-amber-300 rounded">
											{ep.type}
										</span>
									{/each}
								</div>
								<svelte:component this={showReimbursement ? ChevronDown : ChevronRight} class="h-4 w-4 text-amber-300" />
							</button>
							{#if showReimbursement}
								<div class="px-4 py-3 bg-slate-800/30 space-y-3" transition:slide={{ duration: 200 }}>
									{#each egyediPoints as ep}
										{#if ep.notes}
											<div>
												<p class="text-xs text-amber-400/70 mb-1">Feltételek:</p>
												<p class="text-sm text-slate-300 whitespace-pre-wrap">{ep.notes}</p>
											</div>
										{/if}
										{#each ep.indications as ind}
											{#if ind.description}
												<div>
													<p class="text-xs text-amber-400/70 mb-1">Indikáció:</p>
													<p class="text-sm text-slate-300">{ind.description}</p>
												</div>
											{/if}
										{/each}
									{/each}
								</div>
							{/if}
						</div>
					{/if}

					<!-- Prescriber Eligibility (NEAK) -->
					{#if clinicalData.hasPrescriberRestrictions}
						{@const prescriberPoints = clinicalData.euPointInfo.filter(ep => ep.prescription && ep.prescription.length > 10)}
						<div class="border border-slate-600 rounded-lg overflow-hidden">
							<button
								type="button"
								class="w-full px-4 py-3 flex items-center justify-between bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
								onclick={() => showPrescriber = !showPrescriber}
							>
								<div class="flex items-center gap-2">
									<UserCheck class="h-4 w-4 text-slate-400" />
									<span class="font-medium text-slate-300">Felírási jogosultság</span>
								</div>
								<svelte:component this={showPrescriber ? ChevronDown : ChevronRight} class="h-4 w-4 text-slate-400" />
							</button>
							{#if showPrescriber}
								<div class="px-4 py-3 bg-slate-800/30 max-h-48 overflow-y-auto" transition:slide={{ duration: 200 }}>
									{#each prescriberPoints.slice(0, 2) as ep}
										<p class="text-sm text-slate-400 whitespace-pre-wrap">{ep.prescription}</p>
									{/each}
								</div>
							{/if}
						</div>
					{/if}

					<!-- Eligibility Rules -->
					{#if clinicalData.eligibility.length > 0}
						<div class="text-xs text-slate-500 space-y-1">
							<p class="font-medium">Jogosultsági szabályok:</p>
							{#each clinicalData.eligibility.slice(0, 3) as elig}
								<p>• {elig.category}: {elig.eligible} {#if elig.timeLimit}({elig.timeLimit} nap){/if}</p>
							{/each}
						</div>
					{/if}
				{/if}

				<!-- ================================================================ -->
				<!-- OGYÉI Hungarian Drug Authorization Data -->
				<!-- ================================================================ -->
				{#if ogyeiData?.found}
					<div class="border border-cyan-500/30 rounded-lg overflow-hidden">
						<button
							type="button"
							class="w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r from-cyan-500/10 to-blue-500/10 hover:from-cyan-500/15 hover:to-blue-500/15 transition-colors"
							onclick={() => showOgyei = !showOgyei}
						>
							<div class="flex items-center gap-2">
								<Flag class="h-4 w-4 text-cyan-400" />
								<span class="font-medium text-cyan-300">OGYÉI Magyar Engedélyezés</span>
								<span class="px-1.5 py-0.5 text-xs bg-cyan-500/20 text-cyan-300 rounded">
									{ogyeiData.entries.length} tétel
								</span>
								{#if ogyeiData.hasAnyShortage}
									<span class="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded flex items-center gap-1">
										<AlertOctagon class="h-3 w-3" />
										Hiánycikk
									</span>
								{/if}
							</div>
							<svelte:component this={showOgyei ? ChevronDown : ChevronRight} class="h-4 w-4 text-cyan-400" />
						</button>
						{#if showOgyei}
							<div class="px-4 py-4 bg-slate-800/30 space-y-4" transition:slide={{ duration: 200 }}>
								<!-- Prescription Status -->
								{#if ogyeiData.prescriptionInfo}
									{@const rxStyle = getOgyeiPrescriptionStyle(ogyeiData.prescriptionInfo.code)}
									<div class="flex items-start gap-3 p-3 bg-slate-900/50 rounded-lg border {rxStyle.class}">
										<svelte:component this={rxStyle.icon} class="h-5 w-5 mt-0.5" />
										<div class="flex-1">
											<p class="font-medium">{ogyeiData.prescriptionInfo.label}</p>
											<p class="text-xs text-slate-400 mt-0.5">{ogyeiData.prescriptionInfo.labelEn}</p>
										</div>
										<span class="px-2 py-0.5 text-xs font-mono bg-slate-800 rounded">
											{ogyeiData.prescriptionInfo.code}
										</span>
									</div>
								{/if}

								<!-- Product Shortage Warning -->
								{#if ogyeiData.hasAnyShortage}
									<div class="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
										<div class="flex items-center gap-2 text-red-400 font-medium">
											<AlertOctagon class="h-4 w-4" />
											<span>Termékhiánnyal érintett</span>
										</div>
										<p class="text-sm text-red-300/80 mt-1">
											Egy vagy több kiszerelés jelenleg hiánycikkként szerepel az OGYÉI adatbázisban.
										</p>
									</div>
								{/if}

								<!-- Marketing Authorization Holders -->
								{#if ogyeiData.uniqueMarketingHolders.length > 0}
									<div>
										<div class="flex items-center gap-2 text-xs text-slate-500 mb-2">
											<Building2 class="h-3.5 w-3.5" />
											<span>Forgalomba hozatali engedély jogosultja</span>
										</div>
										<div class="flex flex-wrap gap-2">
											{#each ogyeiData.uniqueMarketingHolders.slice(0, 3) as holder}
												<span class="px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded text-slate-300">
													{holder}
												</span>
											{/each}
											{#if ogyeiData.uniqueMarketingHolders.length > 3}
												<span class="px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded text-slate-400">
													+{ogyeiData.uniqueMarketingHolders.length - 3} további
												</span>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Pack Sizes from OGYÉI -->
								{#if ogyeiData.uniquePackSizes.length > 0}
									<div>
										<div class="flex items-center gap-2 text-xs text-slate-500 mb-2">
											<Package class="h-3.5 w-3.5" />
											<span>Engedélyezett kiszerelések ({ogyeiData.uniquePackSizes.length})</span>
										</div>
										<div class="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
											{#each ogyeiData.uniquePackSizes.slice(0, 12) as packSize}
												<span class="px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-300">
													{packSize}
												</span>
											{/each}
											{#if ogyeiData.uniquePackSizes.length > 12}
												<span class="px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-400">
													+{ogyeiData.uniquePackSizes.length - 12} további
												</span>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Registration Info (first entry) -->
								{#if ogyeiData.entries[0]?.registrationDate}
									<div class="flex items-center gap-3 text-sm text-slate-400">
										<Calendar class="h-4 w-4" />
										<span>Első regisztráció: {ogyeiData.entries[0].registrationDate}</span>
									</div>
								{/if}

								<!-- Active Ingredient from OGYÉI -->
								{#if ogyeiData.entries[0]?.activeIngredient && ogyeiData.entries[0].activeIngredient !== drug?.activeIngredient}
									<div class="text-xs text-slate-500">
										<span class="font-medium">INN (OGYÉI): </span>
										<span>{ogyeiData.entries[0].activeIngredient}</span>
									</div>
								{/if}

								<!-- OGYÉI Source -->
								<div class="pt-2 border-t border-slate-700 text-xs text-slate-500">
									<p>Adatforrás: OGYÉI - Országos Gyógyszerészeti és Élelmezés-egészségügyi Intézet</p>
									<a
										href="https://ogyei.gov.hu/drug_database/"
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 mt-1"
									>
										ogyei.gov.hu/drug_database
										<ExternalLink class="h-3 w-3" />
									</a>
								</div>
							</div>
						{/if}
					</div>
				{:else if isLoadingOgyei}
					<div class="flex items-center gap-2 text-xs text-slate-400 p-3 bg-slate-800/30 rounded-lg">
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
						<span>OGYÉI adatok betöltése...</span>
					</div>
				{/if}

				<!-- Pack Sizes -->
				{#if 'packSizes' in drug && drug.packSizes && drug.packSizes.length > 0}
					<div>
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-2">
							<Package class="h-3.5 w-3.5" />
							<span>Elérhető kiszerelések ({drug.packSizes.length})</span>
						</div>
						<div class="flex flex-wrap gap-2">
							{#each drug.packSizes.slice(0, 6) as packSize}
								<span class="px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-300">
									{packSize}
								</span>
							{/each}
							{#if drug.packSizes.length > 6}
								<span class="px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-400">
									+{drug.packSizes.length - 6} további
								</span>
							{/if}
						</div>
					</div>
				{:else if drug.packSize}
					<div>
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-2">
							<Package class="h-3.5 w-3.5" />
							<span>Kiszerelés</span>
						</div>
						<span class="px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-300">
							{drug.packSize}
						</span>
					</div>
				{/if}

				<!-- Manufacturer -->
				{#if drug.manufacturer}
					<div>
						<div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
							<span>Gyártó</span>
						</div>
						<p class="text-slate-400 text-sm">{drug.manufacturer}</p>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="px-6 py-4 border-t border-slate-700 bg-slate-800/30 flex justify-between items-center gap-3">
				<button
					type="button"
					class="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
					onclick={handleClose}
				>
					Bezárás
				</button>
				<button
					type="button"
					class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex items-center gap-2"
					onclick={goToFullDetails}
				>
					<span>Teljes részletek</span>
					<ExternalLink class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>
{/if}
