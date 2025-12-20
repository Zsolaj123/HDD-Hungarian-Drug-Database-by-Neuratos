<script lang="ts">
	/**
	 * Clinical Badge Component
	 *
	 * Reusable inline warning badge with hover tooltip for clinical warnings.
	 * Supports multiple severity levels with color coding.
	 */

	import { fade, scale } from 'svelte/transition';
	import {
		AlertTriangle,
		AlertCircle,
		Info,
		Ban,
		Sparkles,
		type Icon
	} from 'lucide-svelte';

	// Props
	interface Props {
		severity: 'critical' | 'high' | 'moderate' | 'info' | 'special';
		label: string;
		tooltip?: string;
		icon?: typeof Icon;
		compact?: boolean;
		onclick?: () => void;
	}

	let {
		severity,
		label,
		tooltip,
		icon,
		compact = false,
		onclick
	}: Props = $props();

	// State
	let showTooltip = $state(false);
	let tooltipRef = $state<HTMLDivElement | null>(null);

	// Severity-based styling
	const severityStyles = {
		critical: {
			bg: 'bg-red-500/20',
			border: 'border-red-500/40',
			text: 'text-red-400',
			icon: Ban,
			iconClass: 'text-red-400'
		},
		high: {
			bg: 'bg-amber-500/20',
			border: 'border-amber-500/40',
			text: 'text-amber-400',
			icon: AlertTriangle,
			iconClass: 'text-amber-400'
		},
		moderate: {
			bg: 'bg-yellow-500/20',
			border: 'border-yellow-500/40',
			text: 'text-yellow-400',
			icon: AlertCircle,
			iconClass: 'text-yellow-400'
		},
		info: {
			bg: 'bg-blue-500/20',
			border: 'border-blue-500/40',
			text: 'text-blue-400',
			icon: Info,
			iconClass: 'text-blue-400'
		},
		special: {
			bg: 'bg-amber-400/20',
			border: 'border-amber-400/50',
			text: 'text-amber-300',
			icon: Sparkles,
			iconClass: 'text-amber-300'
		}
	};

	const style = $derived(severityStyles[severity]);
	const IconComponent = $derived(icon || style.icon);

	function handleMouseEnter() {
		if (tooltip) {
			showTooltip = true;
		}
	}

	function handleMouseLeave() {
		showTooltip = false;
	}

	function handleClick(e: MouseEvent) {
		if (onclick) {
			e.stopPropagation();
			onclick();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (onclick) {
				onclick();
			}
		}
	}
</script>

<div class="relative inline-flex">
	<!-- Badge Button -->
	<button
		type="button"
		class="inline-flex items-center gap-1.5 rounded-full border transition-all duration-150
			{style.bg} {style.border} {style.text}
			{compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}
			{onclick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
			focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-slate-900 focus:ring-blue-500"
		onmouseenter={handleMouseEnter}
		onmouseleave={handleMouseLeave}
		onclick={handleClick}
		onkeydown={handleKeydown}
		aria-describedby={tooltip ? 'tooltip' : undefined}
	>
		<svelte:component this={IconComponent} class="h-3.5 w-3.5 {style.iconClass}" />
		{#if !compact || label.length <= 12}
			<span class="font-medium">{label}</span>
		{:else}
			<span class="font-medium" title={label}>{label.slice(0, 10)}...</span>
		{/if}
	</button>

	<!-- Tooltip -->
	{#if showTooltip && tooltip}
		<div
			bind:this={tooltipRef}
			id="tooltip"
			role="tooltip"
			class="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2
				bg-slate-800 border border-slate-600 rounded-lg shadow-xl
				text-sm text-slate-200 max-w-xs whitespace-pre-wrap"
			transition:fade={{ duration: 150 }}
		>
			<div class="text-left leading-relaxed">{tooltip}</div>
			<!-- Arrow -->
			<div
				class="absolute top-full left-1/2 -translate-x-1/2 -mt-px
					border-4 border-transparent border-t-slate-600"
			></div>
		</div>
	{/if}
</div>
