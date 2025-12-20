<script lang="ts">
	/**
	 * IndicationSkeleton - Animated skeleton loader for drug indications tab
	 * Galaxy-inspired dark theme with smooth pulse animation
	 */

	interface Props {
		bnoCount?: number;
		eligibilityCount?: number;
	}

	let { bnoCount = 4, eligibilityCount = 3 }: Props = $props();
</script>

<div class="indication-skeleton">
	<!-- BNO Codes Section -->
	<div class="section-header">
		<div class="h-5 w-32 bg-slate-700/60 rounded animate-pulse"></div>
	</div>

	<div class="bno-grid">
		{#each Array(bnoCount) as _, i}
			<div
				class="bno-card"
				style="animation-delay: {i * 100}ms"
			>
				<div class="bno-code-line">
					<div class="h-4 w-16 bg-emerald-500/20 rounded"></div>
					<div class="h-3 w-8 bg-slate-600/40 rounded"></div>
				</div>
				<div class="h-3 w-full bg-slate-700/40 rounded mt-2"></div>
				<div class="h-3 w-3/4 bg-slate-700/30 rounded mt-1"></div>
			</div>
		{/each}
	</div>

	<!-- Indications Section -->
	<div class="section-header mt-6">
		<div class="h-5 w-28 bg-slate-700/60 rounded animate-pulse"></div>
	</div>

	<div class="indication-list">
		{#each Array(2) as _, i}
			<div
				class="indication-card"
				style="animation-delay: {(bnoCount + i) * 100}ms"
			>
				<div class="flex items-center gap-2 mb-2">
					<div class="h-5 w-20 bg-blue-500/20 rounded-full"></div>
					<div class="h-4 w-12 bg-amber-500/15 rounded"></div>
				</div>
				<div class="h-3 w-full bg-slate-700/40 rounded"></div>
				<div class="h-3 w-5/6 bg-slate-700/30 rounded mt-1"></div>
			</div>
		{/each}
	</div>

	<!-- Eligibility Section -->
	<div class="section-header mt-6">
		<div class="h-5 w-36 bg-slate-700/60 rounded animate-pulse"></div>
	</div>

	<div class="eligibility-list">
		{#each Array(eligibilityCount) as _, i}
			<div
				class="eligibility-card"
				style="animation-delay: {(bnoCount + 2 + i) * 100}ms"
			>
				<div class="flex items-center gap-3">
					<!-- Icon placeholder -->
					<div class="h-8 w-8 bg-slate-600/50 rounded-lg"></div>

					<!-- Content -->
					<div class="flex-1">
						<div class="flex items-center gap-2">
							<div class="h-4 w-24 bg-slate-700/50 rounded"></div>
							<div class="h-4 w-16 bg-violet-500/20 rounded-full"></div>
						</div>
						<div class="h-3 w-32 bg-slate-700/30 rounded mt-1"></div>
					</div>

					<!-- Time badge placeholder -->
					{#if i === 0}
						<div class="h-6 w-16 bg-cyan-500/15 rounded-full"></div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.indication-skeleton {
		padding: 0.5rem;
	}

	.section-header {
		margin-bottom: 0.75rem;
	}

	/* BNO Grid */
	.bno-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	@media (max-width: 640px) {
		.bno-grid {
			grid-template-columns: 1fr;
		}
	}

	.bno-card {
		padding: 0.875rem;
		background: linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8));
		border: 1px solid rgba(100, 116, 139, 0.2);
		border-radius: 0.625rem;
		animation: pulse 2s ease-in-out infinite;
	}

	.bno-code-line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Indication Cards */
	.indication-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.indication-card {
		padding: 0.875rem;
		background: linear-gradient(135deg, rgba(30, 41, 59, 0.5), rgba(15, 23, 42, 0.7));
		border: 1px solid rgba(100, 116, 139, 0.15);
		border-radius: 0.5rem;
		animation: pulse 2s ease-in-out infinite;
	}

	/* Eligibility Cards */
	.eligibility-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.eligibility-card {
		padding: 0.75rem 1rem;
		background: linear-gradient(135deg, rgba(30, 41, 59, 0.4), rgba(15, 23, 42, 0.6));
		border: 1px solid rgba(100, 116, 139, 0.1);
		border-radius: 0.5rem;
		animation: pulse 2s ease-in-out infinite;
	}

	/* Pulse animation with stagger */
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	/* Tailwind-style utility overrides for skeleton elements */
	.indication-skeleton :global(.animate-pulse) {
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
</style>
