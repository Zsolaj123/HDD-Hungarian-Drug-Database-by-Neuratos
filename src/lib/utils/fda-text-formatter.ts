/**
 * FDA Text Formatter Utility
 *
 * Parses and structures FDA drug label text for better readability.
 * Handles section headers, bullet points, clinical values, and cross-references.
 *
 * Enhanced with:
 * - Better line break detection
 * - Inline bullet point splitting
 * - Key-value parsing
 * - Warning keyword highlighting
 * - Action verb highlighting (Monitor, Avoid, Discontinue)
 * - Table and Notes block detection
 * - Summary extraction from top
 * - Drug class highlighting (Class I, Class III/IV)
 */

export interface FdaSection {
	id: string;
	number: string;
	title: string;
	content: string;
	isSubsection: boolean;
	highlights: FdaHighlight[];
	isSummary?: boolean;
}

export interface FdaHighlight {
	type: 'warning' | 'drug' | 'condition' | 'value' | 'reference' | 'action';
	text: string;
	context?: string;
}

export interface FormattedFdaContent {
	summary: string;
	summaryBullets: string[];
	sections: FdaSection[];
	bulletPoints: string[];
	keyValuePairs: KeyValuePair[];
	hasSubsections: boolean;
	hasTables: boolean;
	wordCount: number;
}

export interface KeyValuePair {
	key: string;
	value: string;
}

// Patterns for detecting content structure
// Updated to support 1, 2, or 3 level section numbers (e.g., 5, 5.1, 5.1.1)
const SECTION_HEADER_PATTERN = /^(\d+(?:\.\d+)?(?:\.\d+)?)\s+([A-Z][A-Za-z\s]+?)(?:\s|$)/gm;
const SUBSECTION_PATTERN = /(\d+(?:\.\d+)?(?:\.\d+)?)\s+([A-Z][A-Za-z\s,]+?)(?:\n|:)/g;
const BULLET_PATTERN = /(?:^|\n)[\u2022\u2023\u25E6\u2043\u2219•]\s*(.+?)(?=\n|$)/g;
const REFERENCE_PATTERN = /\[see\s+([^\]]+)\]/gi;
// Updated to support 3-level section references like (5.1.1) and (5.1.1, 12.3.2)
const SECTION_REF_PATTERN = /\(\s*(\d+(?:\.\d+)?(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?(?:\.\d+)?)*)\s*\)/g;
const CLINICAL_VALUE_PATTERN = /(<|>|≤|≥|±)?\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:x\s*10\s*\d*\s*\/L|mg(?:\/(?:day|kg|mL))?|mL|%|mcg|IU|kg|g\/dL|cells\/mm3|mmol\/L|msec|months|weeks|days|hours|years|fold)/gi;

// Generic drug name pattern - matches uppercase words that look like drug/brand names
// Matches: 2+ uppercase letters, optionally followed by more uppercase words
// Examples: OCREVUS, DIMETHYL FUMARATE, COPAXONE 40
const GENERIC_DRUG_PATTERN = /\b[A-Z]{2,}(?:\s+[A-Z0-9]+)*\b/g;

// Words to skip - common non-drug uppercase words in FDA labels
const SKIP_WORDS = new Set([
	// Common English words
	'THE', 'AND', 'FOR', 'WITH', 'NOT', 'BUT', 'ARE', 'WAS', 'HAS', 'HAD', 'HAVE', 'BEEN', 'WERE',
	'FROM', 'INTO', 'OVER', 'UPON', 'THIS', 'THAT', 'THESE', 'THOSE', 'SOME', 'SUCH', 'THAN',
	'ONLY', 'ALSO', 'VERY', 'MOST', 'MAY', 'CAN', 'WILL', 'SHOULD', 'COULD', 'WOULD', 'MUST',
	// Medical/FDA label common words
	'FDA', 'USP', 'NDA', 'BLA', 'IND', 'NDC', 'OTC', 'PRN', 'TID', 'BID', 'QID', 'QHS', 'PO', 'IV', 'IM', 'SC', 'SQ',
	'WARNINGS', 'WARNING', 'CAUTION', 'CAUTIONS', 'NOTE', 'NOTES', 'SEE', 'ALSO', 'REFER',
	'SECTION', 'SECTIONS', 'TABLE', 'TABLES', 'FIGURE', 'FIGURES', 'APPENDIX',
	'DOSAGE', 'DOSE', 'DOSES', 'ADMINISTRATION', 'INDICATION', 'INDICATIONS',
	'CONTRAINDICATION', 'CONTRAINDICATIONS', 'CONTRAINDICATED',
	'ADVERSE', 'REACTION', 'REACTIONS', 'EFFECT', 'EFFECTS', 'SIDE',
	'DRUG', 'DRUGS', 'INTERACTION', 'INTERACTIONS', 'PRECAUTION', 'PRECAUTIONS',
	'PATIENT', 'PATIENTS', 'CLINICAL', 'STUDIES', 'STUDY', 'TRIAL', 'TRIALS',
	'PHARMACOLOGY', 'PHARMACOKINETICS', 'PHARMACODYNAMICS', 'TOXICOLOGY',
	'PREGNANCY', 'LACTATION', 'NURSING', 'PEDIATRIC', 'GERIATRIC', 'RENAL', 'HEPATIC',
	'SPECIAL', 'POPULATIONS', 'USE', 'USES', 'USING', 'TREATMENT', 'THERAPY',
	'MECHANISM', 'ACTION', 'ABSORPTION', 'DISTRIBUTION', 'METABOLISM', 'EXCRETION', 'ELIMINATION',
	'INFORMATION', 'DESCRIPTION', 'STORAGE', 'HANDLING', 'SUPPLIED', 'HOW',
	'OVERDOSAGE', 'OVERDOSE', 'DEPENDENCE', 'ABUSE', 'WITHDRAWAL',
	// Units and measurements
	'MG', 'ML', 'MCG', 'IU', 'UNIT', 'UNITS', 'DAILY', 'WEEKLY', 'MONTHLY', 'ONCE', 'TWICE',
	// Common FDA terms
	'BOXED', 'BLACK', 'BOX', 'IMPORTANT', 'RISK', 'RISKS', 'SERIOUS', 'SEVERE', 'FATAL',
	'MONITOR', 'MONITORING', 'AVOID', 'DISCONTINUE', 'REDUCE', 'INCREASE', 'ADJUST',
	'BASELINE', 'HISTORY', 'PRIOR', 'BEFORE', 'AFTER', 'DURING', 'WHILE',
	// Study-related
	'PLACEBO', 'CONTROL', 'CONTROLLED', 'RANDOMIZED', 'DOUBLE', 'BLIND', 'BLINDED', 'OPEN', 'LABEL',
	'PRIMARY', 'SECONDARY', 'ENDPOINT', 'ENDPOINTS', 'OUTCOME', 'OUTCOMES', 'EFFICACY', 'SAFETY',
	'RELAPSE', 'RELAPSES', 'REMISSION', 'PROGRESSION', 'DISABILITY', 'EDSS',
	// Conditions
	'INFECTION', 'INFECTIONS', 'INFUSION', 'INFUSIONS', 'INJECTION', 'INJECTIONS',
	'HEPATITIS', 'PML', 'HERPES', 'MALIGNANCY', 'MALIGNANCIES', 'CANCER', 'CARDIOVASCULAR'
]);

/**
 * Check if a word is likely a drug name (not a common FDA label word)
 */
function isDrugName(word: string): boolean {
	if (SKIP_WORDS.has(word.toUpperCase())) return false;
	// Must be at least 3 characters
	if (word.length < 3) return false;
	// Should not be all numbers
	if (/^\d+$/.test(word)) return false;
	return true;
}

/**
 * Create dynamic regex pattern for specific drug name
 * This allows highlighting the specific drug being viewed
 */
export function createDrugNamePattern(drugName: string): RegExp {
	if (!drugName) return GENERIC_DRUG_PATTERN;
	// Escape special regex characters and create pattern
	const escaped = drugName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`\\b${escaped}\\b`, 'gi');
}

// New patterns for enhanced parsing
const INLINE_BULLET_PATTERN = /\s*[•·]\s*/g;
const SEMICOLON_LIST_PATTERN = /;\s+(?=[A-Z])/g;
const KEY_VALUE_PATTERN = /^([A-Z][A-Za-z\s]+):\s*(.+)$/gm;
const WARNING_KEYWORDS_PATTERN =
	/\b(DO NOT|MUST NOT|SHOULD NOT|WARNING|CAUTION|CONTRAINDICATED|DISCONTINUE|IMMEDIATELY|FATAL|DEATH|LIFE-THREATENING|BLACK BOX|SERIOUS|SEVERE|PERMANENT|IRREVERSIBLE)\b/gi;
const NUMBERED_LIST_PATTERN = /(?:^|\n)\s*(\d+)\.\s+/g;
const DASH_LIST_PATTERN = /(?:^|\n)\s*[-–—]\s+(.+?)(?=\n|$)/g;

// Action verbs that indicate required clinical actions
const ACTION_VERB_PATTERN =
	/\b(Monitor|Avoid|Consider|Obtain|Discontinue|Withhold|Administer|Evaluate|Assess|Check|Measure|Test|Perform|Initiate|Resume|Delay|Suspend|Reduce|Increase|Adjust|Recommend)\b/g;

// Drug classification patterns
const DRUG_CLASS_PATTERN =
	/\bClass\s+(?:I[abA]|II[abc]?|III|IV|V)(?:\s*\/\s*(?:I[abA]|II[abc]?|III|IV|V))?\b/gi;

// Table detection
const TABLE_PATTERN = /Table\s+\d+[:\.]?\s*[A-Z][^.]+/gi;

// Generic table patterns - detect columnar data
const PIPE_TABLE_PATTERN = /^.*\|.*\|.*$/gm;
const TAB_SEPARATED_PATTERN = /^[^\t]+\t[^\t]+\t[^\t]+$/gm;
const PERCENTAGE_ROW_PATTERN = /^([A-Z][A-Za-z\s]+)\s+(\d+(?:\.\d+)?%?)\s+(\d+(?:\.\d+)?%?)/gm;
// Updated to match both uppercase N and lowercase n (N=50, n=50)
const N_EQUALS_HEADER_PATTERN = /[Nn]\s*=\s*\d+/g;

// Figure reference pattern
const FIGURE_PATTERN = /Figure\s+(\d+)[:\.]?\s*([^\n]+)?/gi;

// Drug interaction table pattern - detects the repeating structure
const DRUG_INTERACTION_TABLE_PATTERN = /Table\s+\d+:\s*([^\n]+)\s+((?:[A-Z][A-Za-z\s,()]+(?:Clinical Impact:|Intervention:|Examples:)[^]*?)+)/gi;

// Individual drug interaction row pattern
const INTERACTION_ROW_PATTERN = /([A-Z][A-Za-z\s,()/-]+?)(?=Clinical Impact:)\s*Clinical Impact:\s*([^]*?)(?=Intervention:)\s*Intervention:\s*([^]*?)(?=Examples:|(?=[A-Z][A-Za-z\s,()/-]+Clinical Impact:)|$)(?:Examples:\s*([^]*?))?(?=(?:[A-Z][A-Za-z\s,()/-]+Clinical Impact:)|$)/g;

// Notes block detection
const NOTES_PATTERN = /Notes?:\s*/gi;

// Summary bullet pattern - short lines ending with section references (supports 1-3 level sections)
const SUMMARY_BULLET_PATTERN = /^[A-Z][^.]+\.\s*\(\s*\d+(?:\.\d+)?(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?(?:\.\d+)?)*\s*\)$/gm;

/**
 * Extract summary bullets from the top of FDA content
 * These are short lines at the top that end with section references like (5.1) or (5.1.1)
 */
function extractSummaryBullets(text: string): string[] {
	const bullets: string[] = [];
	const lines = text.split('\n');

	// Find consecutive lines at top that match summary pattern
	for (const line of lines) {
		const trimmed = line.trim();

		// Skip empty lines and main section headers
		if (!trimmed || /^\d+\s+[A-Z]+/.test(trimmed)) continue;

		// Check if this looks like a summary bullet (ends with reference like (5.1), (5.1.1) or contains colon)
		// Updated to support 1, 2, or 3 level section references
		if (/\(\s*\d+(?:\.\d+)?(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?(?:\.\d+)?)*\s*\)\s*$/.test(trimmed)) {
			bullets.push(trimmed);
		} else if (trimmed.includes(':') && trimmed.length < 200) {
			// Also capture colon-separated summary items like "Herpes infections: Life-threatening..."
			const beforeRef = trimmed.replace(/\(\s*\d+(?:\.\d+)?(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?(?:\.\d+)?)*\s*\)\s*$/, '').trim();
			if (beforeRef.includes(':')) {
				bullets.push(trimmed);
			}
		}

		// Stop when we hit a subsection header (1, 2, or 3 level)
		if (/^\d+(?:\.\d+)?(?:\.\d+)?\s+[A-Z]/.test(trimmed)) break;

		// Stop after collecting enough bullets or hitting long content
		if (bullets.length >= 10 || trimmed.length > 300) break;
	}

	return bullets;
}

/**
 * Extract the first meaningful paragraph as summary
 */
function extractSummary(text: string, maxLength = 300): string {
	// Remove section headers
	let clean = text.replace(/^\d+(?:\.\d+)?\s+[A-Z][A-Za-z\s]+\n?/g, '');

	// Get first sentence or up to first paragraph break
	const firstPara = clean.split(/\n\n/)[0];
	const firstSentence = firstPara.match(/^[^.!?]+[.!?]/)?.[0] || firstPara;

	if (firstSentence.length <= maxLength) {
		return firstSentence.trim();
	}

	return firstSentence.substring(0, maxLength).trim() + '...';
}

/**
 * Detect if content has table data
 */
function hasTableContent(text: string): boolean {
	return TABLE_PATTERN.test(text);
}

/**
 * Parse section headers and content
 */
function parseSections(text: string): FdaSection[] {
	const sections: FdaSection[] = [];
	const lines = text.split('\n');

	let currentSection: FdaSection | null = null;
	let contentBuffer: string[] = [];

	for (const line of lines) {
		// Check for section header (e.g., "5.1 Anaphylaxis", "5.1.1 Risk Factors")
		// Updated to support 1, 2, or 3 level sections
		const headerMatch = line.match(/^(\d+(?:\.\d+)?(?:\.\d+)?)\s+([A-Z][A-Za-z\s,()-]+)$/);

		if (headerMatch) {
			// Save previous section
			if (currentSection) {
				currentSection.content = contentBuffer.join('\n').trim();
				currentSection.highlights = extractHighlights(currentSection.content);
				sections.push(currentSection);
			}

			const [, number, title] = headerMatch;
			currentSection = {
				id: `section-${number.replace('.', '-')}`,
				number,
				title: title.trim(),
				content: '',
				isSubsection: number.includes('.'),
				highlights: []
			};
			contentBuffer = [];
		} else if (currentSection) {
			contentBuffer.push(line);
		} else {
			// Content before any section header
			contentBuffer.push(line);
		}
	}

	// Save last section
	if (currentSection) {
		currentSection.content = contentBuffer.join('\n').trim();
		currentSection.highlights = extractHighlights(currentSection.content);
		sections.push(currentSection);
	} else if (contentBuffer.length > 0) {
		// No sections found, treat entire text as one section
		const content = contentBuffer.join('\n').trim();
		sections.push({
			id: 'section-main',
			number: '',
			title: '',
			content,
			isSubsection: false,
			highlights: extractHighlights(content)
		});
	}

	return sections;
}

/**
 * Extract bullet points from text
 * Enhanced to handle inline bullets, semicolon lists, and dash lists
 */
function extractBulletPoints(text: string): string[] {
	const bullets: string[] = [];
	const seen = new Set<string>();

	// Look for actual bullet points (• or similar)
	const bulletMatches = text.matchAll(BULLET_PATTERN);
	for (const match of bulletMatches) {
		if (match[1]) {
			const item = match[1].trim();
			if (!seen.has(item.toLowerCase())) {
				bullets.push(item);
				seen.add(item.toLowerCase());
			}
		}
	}

	// Look for dash-prefixed items
	const dashMatches = text.matchAll(DASH_LIST_PATTERN);
	for (const match of dashMatches) {
		if (match[1]) {
			const item = match[1].trim();
			if (!seen.has(item.toLowerCase())) {
				bullets.push(item);
				seen.add(item.toLowerCase());
			}
		}
	}

	// Split inline bullet patterns (text • text • text)
	if (text.includes('•') || text.includes('·')) {
		const parts = text.split(INLINE_BULLET_PATTERN).filter((p) => p.trim().length > 10);
		for (const part of parts) {
			const item = part.trim().replace(/^[,;]\s*/, '').replace(/[,;]\s*$/, '');
			if (item.length > 10 && item.length < 200 && !seen.has(item.toLowerCase())) {
				bullets.push(item);
				seen.add(item.toLowerCase());
			}
		}
	}

	return bullets.slice(0, 15); // Limit to 15 items
}

/**
 * Extract key-value pairs from text (e.g., "Dosage: 240 mg twice daily")
 */
function extractKeyValuePairs(text: string): KeyValuePair[] {
	const pairs: KeyValuePair[] = [];
	const matches = text.matchAll(KEY_VALUE_PATTERN);

	for (const match of matches) {
		if (match[1] && match[2]) {
			pairs.push({
				key: match[1].trim(),
				value: match[2].trim()
			});
		}
	}

	return pairs.slice(0, 20); // Limit to 20 pairs
}

/**
 * Format adverse reactions tables into HTML tables
 * Enhanced to handle multiple table formats:
 * - N = XXX headers with percentage data: "X (X.X%)"
 * - Tables with just numbers: "50 200"
 * - Tables with percentage only: "45%"
 * - Contraindication tables with text descriptions
 */
function formatAdverseReactionsTables(text: string): string {
	let result = text;

	// Find all table sections - stop at next table or ANY section header (1-3 level)
	const tablePattern = /Table\s+(\d+):\s*([^]*?)(?=Table\s+\d+:|\d+(?:\.\d+)+\s+[A-Z]|$)/gi;
	let match;

	while ((match = tablePattern.exec(text)) !== null) {
		const tableNum = match[1];
		const tableContent = match[2];

		// Extract title
		const titleMatch = tableContent.match(/^([^]*?)(?=Intent-to-treat|Number of Patients|\sN\s*=|\n\s*[A-Z][a-z]+\s+\d)/i);
		const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ').substring(0, 100) : tableContent.split('\n')[0].trim();

		// Try multiple parsing strategies
		let rows: Array<{label: string, values: string[]}> = [];
		let headers: string[] = [];

		// Strategy 1: Tables with N = XXX headers and percentage data
		// Support both uppercase N and lowercase n
		const nEqualsPattern = /[Nn]\s*=\s*(\d+)/g;
		let headerMatch;
		while ((headerMatch = nEqualsPattern.exec(tableContent)) !== null) {
			headers.push(`N=${headerMatch[1]}`);
		}

		if (headers.length >= 2) {
			// Look for rows with "X (X.X)" format
			const dataRowPattern = /([A-Z][A-Za-z\s]+?)\s+((?:\d+\s*\([^)]+\)\s*)+)/g;
			let rowMatch;
			while ((rowMatch = dataRowPattern.exec(tableContent)) !== null) {
				const condition = rowMatch[1].trim();
				const valuesStr = rowMatch[2];
				const values = valuesStr.match(/\d+\s*\([^)]+\)/g) || [];
				if (values.length >= 2 && condition.length > 2 && condition.length < 50) {
					rows.push({ label: condition, values });
				}
			}
		}

		// Strategy 2: Tables with percentage data but no N = format
		if (rows.length === 0 && tableContent.match(/\d+\.?\d*\s*%/)) {
			// Look for rows with plain percentages
			const percentRowPattern = /([A-Z][A-Za-z\s]+?)(?:\s+(\d+\.?\d*\s*%)){2,}/g;
			let rowMatch;
			while ((rowMatch = percentRowPattern.exec(tableContent)) !== null) {
				const label = rowMatch[1].trim();
				const values = tableContent.substring(rowMatch.index).match(/\d+\.?\d*\s*%/g) || [];
				if (values.length >= 2 && label.length > 2 && label.length < 50) {
					rows.push({ label, values: values.slice(0, 4) });
				}
			}
		}

		// Strategy 3: Tables with plain numbers (no parentheses)
		if (rows.length === 0 && tableContent.match(/\d+\s+\d+/)) {
			// Detect column headers from first data line
			const lines = tableContent.split('\n').filter(l => l.trim());
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				// Look for lines with condition name followed by 2+ numbers
				const plainMatch = line.match(/^([A-Z][A-Za-z\s]+?)\s+((?:\d+(?:\.\d+)?\s*)+)$/);
				if (plainMatch) {
					const label = plainMatch[1].trim();
					const values = plainMatch[2].trim().split(/\s+/);
					if (values.length >= 2 && label.length > 2 && label.length < 50) {
						rows.push({ label, values });
					}
				}
			}
		}

		if (rows.length === 0) continue;

		// Build HTML table
		const hasNHeaders = headers.length >= rows[0].values.length;
		let tableHtml = `<div class="fda-table-container">
			<div class="fda-table-header">Table ${tableNum}: ${title}</div>
			<table class="fda-adverse-table">
				<thead>
					<tr>
						<th>Mellékhatás / Állapot</th>
						${hasNHeaders
							? headers.slice(0, rows[0].values.length).map(h => `<th>${h}</th>`).join('')
							: rows[0].values.map((_, i) => `<th>Csoport ${i + 1}</th>`).join('')
						}
					</tr>
				</thead>
				<tbody>`;

		for (const row of rows) {
			tableHtml += `<tr>
				<td class="fda-condition-cell">${row.label}</td>
				${row.values.map(v => `<td class="fda-value-cell">${v}</td>`).join('')}
			</tr>`;
		}

		tableHtml += `</tbody></table></div>`;

		// Replace the table section in result
		const fullMatch = `Table ${tableNum}:${tableContent}`;
		const originalStart = result.indexOf(fullMatch);
		if (originalStart !== -1) {
			// Stop at next table or ANY section header (1-3 level)
			const nextTableMatch = result.substring(originalStart + 10).match(/Table\s+\d+:|\d+(?:\.\d+)+\s+[A-Z]/);
			const endIndex = nextTableMatch
				? originalStart + 10 + (nextTableMatch.index || 0)
				: originalStart + fullMatch.length;

			result = result.substring(0, originalStart) + tableHtml + result.substring(endIndex);
		}
	}

	return result;
}

/**
 * Format pharmacokinetic tables into HTML tables
 * Pattern: Table N: Effect of X on Y... DrugName Dose AUC Cmax values
 * Enhanced to support:
 * - More unit types (mg, mcg, µg, g, ng, mL, IU, units, L)
 * - Hyphenated drug names (CYP3A4-Inhibitor)
 * - Dose ranges (1-2 mg)
 * - Multiple title formats
 */
function formatPharmacokineticTables(text: string): string {
	// Check for PK table patterns (has AUC, Cmax, geometric mean ratio)
	if (!text.match(/AUC|C\s*max|Geometric Mean/i)) {
		return text;
	}

	let result = text;

	// Find tables with PK data pattern - expanded title patterns
	// Stop at next table or ANY section header (1-3 level)
	const tablePattern = /Table\s+(\d+):\s*(?:Effect(?:s)?\s+of\s+)?([^]*?)(?=Table\s+\d+:|\d+(?:\.\d+)+\s+[A-Z]|Effects of|$)/gi;
	let match;

	while ((match = tablePattern.exec(text)) !== null) {
		const tableNum = match[1];
		const tableContent = match[2];

		// Extract title - expanded patterns to catch more formats
		const titlePatterns = [
			/^([^]*?)(?=Coadministered Drug)/i,
			/^([^]*?)(?=All doses)/i,
			/^([^]*?)(?=Drug\s+Name)/i,
			/^([^]*?)(?=Interacting\s+Drug)/i,
			/^([^]*?)(?=Concomitant\s+Drug)/i,
			/^([^]*?)(?=\n\s*[A-Z][a-z]+\s+\d)/i
		];

		let title = '';
		for (const pattern of titlePatterns) {
			const m = tableContent.match(pattern);
			if (m && m[1]) {
				title = m[1].trim().replace(/\s+/g, ' ').substring(0, 80);
				break;
			}
		}
		if (!title) title = tableContent.split('\n')[0].trim().substring(0, 80);

		// Find drug rows with expanded pattern:
		// - Drug names can be hyphenated (CYP3A4-Inhibitor, Co-administered)
		// - Support more unit types
		// - Support dose ranges (1-2 mg, 100-200 mg)
		const drugPattern = /([A-Z][A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+){0,3})\s+(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*(?:mg|mcg|µg|g|ng|mL|IU|units?|L|µL)(?:\/(?:day|kg|mL|L|dose))?[^]*?)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)/gi;
		const rows: Array<{drug: string, dose: string, auc: string, cmax: string}> = [];

		let rowMatch;
		while ((rowMatch = drugPattern.exec(tableContent)) !== null) {
			const drug = rowMatch[1].trim();
			// Skip if it's a header row
			if (drug.toLowerCase() === 'drug' || drug.toLowerCase() === 'coadministered') continue;

			rows.push({
				drug,
				dose: rowMatch[2].trim().substring(0, 60),
				auc: rowMatch[3].replace(',', '.'),
				cmax: rowMatch[4].replace(',', '.')
			});
		}

		if (rows.length === 0) continue;

		// Build HTML table
		let tableHtml = `<div class="fda-table-container">
			<div class="fda-table-header">Table ${tableNum}: ${title || 'Pharmacokinetic Interactions'}</div>
			<table class="fda-pk-table">
				<thead>
					<tr>
						<th>Gyógyszer</th>
						<th>Adag</th>
						<th>AUC arány</th>
						<th>C<sub>max</sub> arány</th>
					</tr>
				</thead>
				<tbody>`;

		for (const row of rows) {
			// Highlight if ratio significantly different from 1.0
			const aucVal = parseFloat(row.auc);
			const cmaxVal = parseFloat(row.cmax);
			const aucClass = (aucVal < 0.8 || aucVal > 1.25) ? 'fda-significant' : '';
			const cmaxClass = (cmaxVal < 0.8 || cmaxVal > 1.25) ? 'fda-significant' : '';

			tableHtml += `<tr>
				<td class="fda-drug-cell">${row.drug}</td>
				<td>${row.dose}</td>
				<td class="${aucClass}">${row.auc}</td>
				<td class="${cmaxClass}">${row.cmax}</td>
			</tr>`;
		}

		tableHtml += `</tbody></table></div>`;

		// Replace in result (simplified - just append after finding pattern)
		const fullMatch = `Table ${tableNum}:${tableContent}`;
		const originalStart = result.indexOf(fullMatch);
		if (originalStart !== -1) {
			// Stop at next table or ANY section header (1-3 level)
			const nextMatch = result.substring(originalStart + 10).match(/Table\s+\d+:|\d+(?:\.\d+)+\s+[A-Z]|Effects of/);
			const endIndex = nextMatch
				? originalStart + 10 + (nextMatch.index || 0)
				: originalStart + fullMatch.length;

			result = result.substring(0, originalStart) + tableHtml + result.substring(endIndex);
		}
	}

	return result;
}

/**
 * Format clinical studies tables into HTML tables
 * Handles various clinical study table formats including:
 * - Glycemic parameters (diabetes drugs)
 * - Response rates (oncology)
 * - Relapse rates (MS drugs)
 * - Survival data
 * - Efficacy endpoints
 */
function formatClinicalStudiesTables(text: string): string {
	let result = text;

	// Pattern 1: Glycemic parameter tables (diabetes)
	// Stop at next table or ANY section header (1-3 level)
	const glycemicPattern = /Table\s+(\d+):\s*(Glycemic Parameters[^]*?)(?=Table\s+\d+:|\d+(?:\.\d+)+\s+[A-Z]|$)/gi;
	let match;

	while ((match = glycemicPattern.exec(text)) !== null) {
		const tableNum = match[1];
		const tableContent = match[0];

		const hba1cMatch = tableContent.match(/HbA1c\s*\(%\)[^]*?(?:baseline|change)[^]*?(-?\d+\.?\d*)/i);
		const fpgMatch = tableContent.match(/FPG[^]*?(?:baseline|change)[^]*?(-?\d+\.?\d*)/i);

		if (hba1cMatch || fpgMatch) {
			let tableHtml = `<div class="fda-table-container">
				<div class="fda-table-header">Table ${tableNum}: Glycemic Parameters</div>
				<div class="fda-clinical-summary">
					<p class="fda-clinical-note">📊 Klinikai vizsgálati eredmények - részletes táblázat az eredeti FDA címkében</p>`;
			if (hba1cMatch) tableHtml += `<p><strong>HbA1c változás:</strong> ${hba1cMatch[1]}%</p>`;
			if (fpgMatch) tableHtml += `<p><strong>Éhomi vércukor változás:</strong> ${fpgMatch[1]} mg/dL</p>`;
			tableHtml += `</div></div>`;

			const startIdx = result.indexOf(`Table ${tableNum}:`);
			if (startIdx !== -1) {
				// Stop at next table or ANY section header (1-3 level)
				const nextTable = result.substring(startIdx + 10).match(/Table\s+\d+:|\d+(?:\.\d+)+\s+[A-Z]/);
				const endIdx = nextTable ? startIdx + 10 + (nextTable.index || 0) : startIdx + 200;
				result = result.substring(0, startIdx) + tableHtml + result.substring(endIdx);
			}
		}
	}

	// Pattern 2: Clinical efficacy tables with response rates, relapse rates, survival
	// Stop at next table or ANY section header (1-3 level)
	const efficacyPattern = /Table\s+(\d+):\s*([^]*?(?:Response|Relapse|Survival|Efficacy|Endpoint|Outcome|Result)[^]*?)(?=Table\s+\d+:|\d+(?:\.\d+)+\s+[A-Z]|$)/gi;

	while ((match = efficacyPattern.exec(text)) !== null) {
		const tableNum = match[1];
		const title = match[2].split('\n')[0].trim().replace(/\s+/g, ' ').substring(0, 100);
		const tableContent = match[0];

		// Extract key efficacy metrics
		const metrics: Array<{label: string, value: string}> = [];

		// Response rates
		const responseMatch = tableContent.match(/(?:overall\s+)?response\s*(?:rate)?[:\s]+(\d+(?:\.\d+)?)\s*%/i);
		if (responseMatch) metrics.push({ label: 'Válaszarány', value: `${responseMatch[1]}%` });

		// Relapse rates
		const relapseMatch = tableContent.match(/relapse\s*(?:rate|reduction)?[:\s]+(\d+(?:\.\d+)?)\s*%/i);
		if (relapseMatch) metrics.push({ label: 'Relapszus arány', value: `${relapseMatch[1]}%` });

		// Annualized relapse rate (ARR) for MS drugs
		const arrMatch = tableContent.match(/ARR[:\s]+(\d+(?:\.\d+)?)/i);
		if (arrMatch) metrics.push({ label: 'Éves relapszus arány (ARR)', value: arrMatch[1] });

		// Disability progression
		const progressionMatch = tableContent.match(/disability\s*progression[:\s]+(\d+(?:\.\d+)?)\s*%/i);
		if (progressionMatch) metrics.push({ label: 'Rokkantság progresszió', value: `${progressionMatch[1]}%` });

		// Survival rates
		const survivalMatch = tableContent.match(/(?:overall\s+)?survival[:\s]+(\d+(?:\.\d+)?)\s*(?:%|months)/i);
		if (survivalMatch) metrics.push({ label: 'Túlélés', value: survivalMatch[1] + (survivalMatch[0].includes('month') ? ' hónap' : '%') });

		// Hazard ratio
		const hrMatch = tableContent.match(/hazard\s*ratio[:\s]+(\d+(?:\.\d+)?)/i);
		if (hrMatch) metrics.push({ label: 'Kockázati arány (HR)', value: hrMatch[1] });

		// P-value
		const pValueMatch = tableContent.match(/p\s*[<=>]\s*(\d+(?:\.\d+)?)/i);
		if (pValueMatch) metrics.push({ label: 'p-érték', value: `p ${tableContent.match(/p\s*([<=>])\s*\d+/i)?.[1] || '<'} ${pValueMatch[1]}` });

		if (metrics.length > 0) {
			let tableHtml = `<div class="fda-table-container">
				<div class="fda-table-header">Table ${tableNum}: ${title}</div>
				<div class="fda-clinical-summary">
					<p class="fda-clinical-note">📊 Klinikai vizsgálati eredmények</p>
					<ul class="fda-metrics-list">`;
			for (const m of metrics) {
				tableHtml += `<li><strong>${m.label}:</strong> ${m.value}</li>`;
			}
			tableHtml += `</ul></div></div>`;

			const startIdx = result.indexOf(`Table ${tableNum}:`);
			if (startIdx !== -1 && !result.substring(startIdx, startIdx + 50).includes('fda-table-container')) {
				// Stop at next table or ANY section header (1-3 level)
				const nextTable = result.substring(startIdx + 10).match(/Table\s+\d+:|\d+(?:\.\d+)+\s+[A-Z]/);
				const endIdx = nextTable ? startIdx + 10 + (nextTable.index || 0) : startIdx + 200;
				result = result.substring(0, startIdx) + tableHtml + result.substring(endIdx);
			}
		}
	}

	return result;
}

/**
 * Universal table parser for generic FDA table formats
 * Handles:
 * - Pipe-separated tables (| col | col |)
 * - Whitespace-aligned columnar data
 * - Adverse reaction frequency tables
 * - Any table with "Table N:" header followed by columnar data
 */
function formatGenericTables(text: string): string {
	let result = text;

	// Pattern 1: Pipe-separated tables
	const pipeTableBlocks = findPipeTableBlocks(result);
	for (const block of pipeTableBlocks.reverse()) {
		const tableHtml = parsePipeTable(block.content, block.tableNum, block.title);
		if (tableHtml) {
			result = result.substring(0, block.start) + tableHtml + result.substring(block.end);
		}
	}

	// Pattern 2: Whitespace-aligned tables with percentage data
	const alignedTableBlocks = findAlignedTableBlocks(result);
	for (const block of alignedTableBlocks.reverse()) {
		const tableHtml = parseAlignedTable(block.content, block.tableNum, block.title);
		if (tableHtml) {
			result = result.substring(0, block.start) + tableHtml + result.substring(block.end);
		}
	}

	return result;
}

interface TableBlock {
	start: number;
	end: number;
	content: string;
	tableNum: string;
	title: string;
}

/**
 * Find pipe-separated table blocks in text
 */
function findPipeTableBlocks(text: string): TableBlock[] {
	const blocks: TableBlock[] = [];
	const tableHeaderPattern = /Table\s+(\d+)[:\.]?\s*([^\n]+)/g;
	let match;

	while ((match = tableHeaderPattern.exec(text)) !== null) {
		const tableNum = match[1];
		const title = match[2].trim();
		const startIdx = match.index;

		// Look for pipe-separated lines after the header
		const afterHeader = text.substring(startIdx + match[0].length);
		const lines = afterHeader.split('\n');
		let endIdx = startIdx + match[0].length;
		let hasPipes = false;
		let tableContent = match[0] + '\n';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				tableContent += '\n';
				endIdx += line.length + 1;
				continue;
			}

			// Check for pipe-separated line
			if (trimmed.includes('|') && (trimmed.match(/\|/g) || []).length >= 2) {
				hasPipes = true;
				tableContent += line + '\n';
				endIdx += line.length + 1;
			} else if (hasPipes && !trimmed.startsWith('Table ') && !trimmed.match(/^\d+(?:\.\d+)+\s+[A-Z]/)) {
				// Include non-pipe lines that are part of the table context
				if (trimmed.length < 100 && !trimmed.includes('. ')) {
					tableContent += line + '\n';
					endIdx += line.length + 1;
				} else {
					break;
				}
			} else if (trimmed.startsWith('Table ') || trimmed.match(/^\d+(?:\.\d+)+\s+[A-Z]/)) {
				break;
			}
		}

		if (hasPipes) {
			blocks.push({
				start: startIdx,
				end: endIdx,
				content: tableContent,
				tableNum,
				title
			});
		}
	}

	return blocks;
}

/**
 * Parse pipe-separated table into HTML
 */
function parsePipeTable(content: string, tableNum: string, title: string): string | null {
	const lines = content.split('\n').filter(l => l.includes('|'));
	if (lines.length < 2) return null;

	// Parse headers from first pipe line
	const headerLine = lines[0];
	const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);

	if (headers.length < 2) return null;

	// Check if second line is a separator (---)
	let dataStartIdx = 1;
	if (lines[1] && lines[1].match(/^[\s|:-]+$/)) {
		dataStartIdx = 2;
	}

	// Parse data rows
	const rows: string[][] = [];
	for (let i = dataStartIdx; i < lines.length; i++) {
		const cells = lines[i].split('|').map(c => c.trim()).filter(c => c);
		if (cells.length >= 2) {
			rows.push(cells);
		}
	}

	if (rows.length === 0) return null;

	// Build HTML table
	let html = `<div class="fda-table-container fda-generic-table">
		<div class="fda-table-header">Table ${tableNum}: ${title}</div>
		<table class="fda-data-table">
			<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
			<tbody>`;

	for (const row of rows) {
		html += `<tr>${row.map((c, i) => `<td class="${i === 0 ? 'fda-label-cell' : 'fda-data-cell'}">${c}</td>`).join('')}</tr>`;
	}

	html += '</tbody></table></div>';
	return html;
}

/**
 * Find whitespace-aligned table blocks (e.g., adverse reactions with % data)
 */
function findAlignedTableBlocks(text: string): TableBlock[] {
	const blocks: TableBlock[] = [];
	const tableHeaderPattern = /Table\s+(\d+)[:\.]?\s*([^\n]+)/g;
	let match;

	while ((match = tableHeaderPattern.exec(text)) !== null) {
		const tableNum = match[1];
		const title = match[2].trim();
		const startIdx = match.index;

		const afterHeader = text.substring(startIdx + match[0].length);
		const lines = afterHeader.split('\n');
		let endIdx = startIdx + match[0].length;
		let hasData = false;
		let tableContent = match[0] + '\n';
		let consecutiveEmpty = 0;

		// Look for N = pattern (indicates treatment groups) - support both uppercase and lowercase
		let hasNEquals = false;
		for (const line of lines.slice(0, 10)) {
			if (line.match(/[Nn]\s*=\s*\d+/)) {
				hasNEquals = true;
				break;
			}
		}

		if (!hasNEquals) continue;

		for (const line of lines) {
			const trimmed = line.trim();

			if (!trimmed) {
				consecutiveEmpty++;
				if (consecutiveEmpty > 2) break;
				tableContent += '\n';
				endIdx += line.length + 1;
				continue;
			}
			consecutiveEmpty = 0;

			// Stop at new section or any numbered section header
			if (trimmed.startsWith('Table ') && !trimmed.includes(title)) break;
			if (trimmed.match(/^\d+(?:\.\d+)?(?:\.\d+)?\s+[A-Z]/)) break;

			// Check for data rows: text followed by numbers/percentages
			if (trimmed.match(/\d+(?:\.\d+)?%?/) || trimmed.match(/[Nn]\s*=\s*\d+/) || trimmed.match(/^[A-Z][a-z]+/)) {
				hasData = true;
			}

			tableContent += line + '\n';
			endIdx += line.length + 1;
		}

		if (hasData && tableContent.length > 100) {
			blocks.push({
				start: startIdx,
				end: endIdx,
				content: tableContent,
				tableNum,
				title
			});
		}
	}

	return blocks;
}

/**
 * Parse whitespace-aligned table into HTML
 */
function parseAlignedTable(content: string, tableNum: string, title: string): string | null {
	const lines = content.split('\n');

	// Find header line(s) with N = patterns (supports both uppercase and lowercase)
	let headerLine = '';
	let dataStartIdx = 0;
	const headers: string[] = [''];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const nMatches = line.match(/[Nn]\s*=\s*\d+/g);
		if (nMatches && nMatches.length >= 2) {
			headerLine = line;
			dataStartIdx = i + 1;

			// Extract group names from the line before if present
			const prevLine = lines[i - 1] || '';
			const groupNames = prevLine.split(/\s{2,}/).filter(s => s.trim());
			if (groupNames.length >= nMatches.length) {
				for (let j = 0; j < nMatches.length; j++) {
					headers.push(`${groupNames[j + (groupNames.length - nMatches.length)] || ''} ${nMatches[j]}`.trim());
				}
			} else {
				headers.push(...nMatches);
			}
			break;
		}
	}

	if (headers.length < 2) return null;

	// Parse data rows: ConditionName followed by numbers with optional percentages
	const rows: Array<{label: string, values: string[]}> = [];
	const valuePattern = /(\d+(?:\.\d+)?)\s*(?:\((\d+(?:\.\d+)?%?)\))?/g;

	for (let i = dataStartIdx; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;
		// Stop at next table or any section header (supports 1, 2, or 3 level sections)
		if (line.match(/^Table\s+\d+/) || line.match(/^\d+(?:\.\d+)?(?:\.\d+)?\s+[A-Z]/)) break;

		// Check if line looks like a data row
		const firstWord = line.match(/^([A-Z][a-z]+(?:\s+[a-z]+)*)/);
		if (!firstWord) continue;

		const label = firstWord[1];
		const restOfLine = line.substring(label.length);
		const values: string[] = [];

		let valMatch;
		while ((valMatch = valuePattern.exec(restOfLine)) !== null) {
			if (valMatch[2]) {
				values.push(`${valMatch[1]} (${valMatch[2]})`);
			} else {
				values.push(valMatch[1]);
			}
		}
		valuePattern.lastIndex = 0;

		if (values.length >= 2 && label.length >= 3 && label.length <= 50) {
			rows.push({ label, values });
		}
	}

	if (rows.length === 0) return null;

	// Build HTML table
	let html = `<div class="fda-table-container fda-aligned-table">
		<div class="fda-table-header">Table ${tableNum}: ${title}</div>
		<table class="fda-data-table">
			<thead><tr><th>Mellékhatás / Paraméter</th>${headers.slice(1).map(h => `<th>${h}</th>`).join('')}</tr></thead>
			<tbody>`;

	for (const row of rows) {
		html += `<tr><td class="fda-label-cell">${row.label}</td>`;
		for (const val of row.values) {
			html += `<td class="fda-data-cell">${val}</td>`;
		}
		html += '</tr>';
	}

	html += '</tbody></table></div>';
	return html;
}

/**
 * Format clinical studies figures into styled references
 */
function formatFigureReferences(text: string): string {
	return text.replace(FIGURE_PATTERN, (match, figNum, caption) => {
		const captionText = caption ? caption.trim() : '';
		return `<div class="fda-figure-ref">
			<span class="fda-figure-label">📊 Figure ${figNum}</span>
			${captionText ? `<span class="fda-figure-caption">${captionText}</span>` : ''}
			<span class="fda-figure-note">(Az eredeti FDA címkében található ábra)</span>
		</div>`;
	});
}

/**
 * Format drug interaction tables into HTML tables
 * Pattern: Drug Class → Clinical Impact → Intervention → Examples (repeating)
 * Handles multiple FDA table formats for any drug
 */
function formatDrugInteractionTables(text: string): string {
	// Check if this text contains Drug Interaction table patterns
	if (!text.includes('Clinical Impact:') || !text.includes('Intervention:')) {
		return text;
	}

	let result = text;

	// Find ALL tables with Clinical Impact/Intervention pattern
	// Match various table title formats:
	// - "Table N: Clinically Significant Drug Interactions with DRUG"
	// - "Table N: Drug Interactions that may Increase/Decrease..."
	// - "Table N: DRUG Effects on Other Drugs"
	const tablePattern = /Table\s+(\d+):\s*([^]+?)(?=\s+(?:[A-Z][a-z]+(?:\s+[A-Za-z]+)*|Select\s+)\s*Clinical Impact:)/gi;

	let tableMatch;
	const tables: Array<{num: string, title: string, startIdx: number}> = [];

	while ((tableMatch = tablePattern.exec(text)) !== null) {
		tables.push({
			num: tableMatch[1],
			title: tableMatch[2].trim().replace(/\s+/g, ' '),
			startIdx: tableMatch.index
		});
	}

	if (tables.length === 0) {
		return text;
	}

	// Process each table (in reverse to preserve indices)
	for (let t = tables.length - 1; t >= 0; t--) {
		const table = tables[t];
		const nextTableStart = t < tables.length - 1 ? tables[t + 1].startIdx : text.length;
		const tableContent = text.substring(table.startIdx, nextTableStart);

		// Find drug class names followed by "Clinical Impact:"
		// Generic pattern that works for ANY drug, not just specific hardcoded ones
		// Handles:
		// - "with [AnyDrug] [DrugName] Clinical Impact:" (interaction with target drug)
		// - "to [AnyDrug] [DrugName] Clinical Impact:" (effect on target drug)
		// - "Other Drugs [DrugName] Clinical Impact:"
		// - "[DrugName] Clinical Impact:" (standalone drug class)
		// - Period or bracket ending previous entry followed by drug name
		const drugClassPattern = /(?:(?:with|to)\s+[A-Z][A-Za-z]+(?:\s+[A-Za-z]+)?\s+|Other\s+Drugs\s+|Rhabdomyolysis\s+with\s+\w+(?:\s+\w+)?\s+|Exposure\s+to\s+\w+\s+|[.\]]\s+|^\s*)([A-Z][A-Za-z\s,()/>-]+?)(?=\s*Clinical Impact:)/gm;
		const drugClasses = [...tableContent.matchAll(drugClassPattern)].map(m => m[1].trim());

		if (drugClasses.length === 0) continue;

		// Parse each drug interaction entry
		const rows: Array<{drug: string, impact: string, intervention: string, examples: string}> = [];

		for (const drugClass of drugClasses) {
			const escapedDrug = drugClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const sectionPattern = new RegExp(
				escapedDrug + '\\s*Clinical Impact:\\s*([^]*?)(?=Intervention:)' +
				'Intervention:\\s*([^]*?)(?=Examples:|(?:[A-Z][A-Za-z\\s,()/>-]+\\s*Clinical Impact:)|Table\\s+\\d+:|$)' +
				'(?:Examples:\\s*([^]*?)(?=(?:[A-Z][A-Za-z\\s,()/>-]+\\s*Clinical Impact:)|Table\\s+\\d+:|$))?',
				'i'
			);

			const sectionMatch = tableContent.match(sectionPattern);
			if (sectionMatch) {
				rows.push({
					drug: drugClass,
					impact: (sectionMatch[1] || '').trim().replace(/\s+/g, ' '),
					intervention: (sectionMatch[2] || '').trim().replace(/\s+/g, ' '),
					examples: (sectionMatch[3] || '').trim().replace(/\.$/, '').replace(/\s+/g, ' ')
				});
			}
		}

		if (rows.length === 0) continue;

		// Build HTML table for this specific table
		const hasExamples = rows.some(r => r.examples);
		let tableHtml = `<div class="fda-table-container"><div class="fda-table-header">Table ${table.num}: ${table.title}</div><table class="fda-interaction-table"><thead><tr><th>Gyógyszer/Osztály</th><th>Klinikai hatás</th><th>Beavatkozás</th>${hasExamples ? '<th>Példák</th>' : ''}</tr></thead><tbody>`;

		for (const row of rows) {
			tableHtml += `<tr><td class="fda-drug-cell">${row.drug}</td><td>${row.impact}</td><td>${row.intervention}</td>${hasExamples ? `<td class="fda-examples-cell">${row.examples}</td>` : ''}</tr>`;
		}

		tableHtml += `</tbody></table></div>`;

		// Replace this table section in result
		const tableEndIdx = nextTableStart;
		result = result.substring(0, table.startIdx) + tableHtml + result.substring(tableEndIdx);
	}

	return result;
}

/**
 * Split text on semicolons that precede capital letters (list pattern)
 */
function splitOnSemicolonLists(text: string): string {
	// Replace semicolon list patterns with line breaks
	return text.replace(SEMICOLON_LIST_PATTERN, ';\n');
}

/**
 * Split numbered lists into separate lines
 */
function splitNumberedLists(text: string): string {
	return text.replace(NUMBERED_LIST_PATTERN, '\n$1. ');
}

/**
 * Extract highlights (important terms, values, references)
 */
function extractHighlights(text: string): FdaHighlight[] {
	const highlights: FdaHighlight[] = [];

	// Drug names - use generic pattern with filtering
	const drugMatches = text.matchAll(GENERIC_DRUG_PATTERN);
	for (const match of drugMatches) {
		// Only include if it looks like a drug name (not a common word)
		if (isDrugName(match[0])) {
			highlights.push({
				type: 'drug',
				text: match[0]
			});
		}
	}

	// Clinical values
	const valueMatches = text.matchAll(CLINICAL_VALUE_PATTERN);
	for (const match of valueMatches) {
		highlights.push({
			type: 'value',
			text: match[0]
		});
	}

	// References to other sections
	const refMatches = text.matchAll(REFERENCE_PATTERN);
	for (const match of refMatches) {
		highlights.push({
			type: 'reference',
			text: match[0],
			context: match[1]
		});
	}

	return highlights;
}

/**
 * Format FDA text content for display
 */
export function formatFdaContent(text: string | null): FormattedFdaContent | null {
	if (!text || text.trim().length === 0) {
		return null;
	}

	// Pre-process text for better structure
	let processedText = text;
	processedText = splitOnSemicolonLists(processedText);
	processedText = splitNumberedLists(processedText);

	const sections = parseSections(processedText);
	const bulletPoints = extractBulletPoints(text);
	const keyValuePairs = extractKeyValuePairs(text);
	const summary = extractSummary(text);
	const summaryBullets = extractSummaryBullets(text);
	const wordCount = text.split(/\s+/).length;
	const hasTables = hasTableContent(text);

	return {
		summary,
		summaryBullets,
		sections,
		bulletPoints,
		keyValuePairs,
		hasSubsections: sections.some((s) => s.isSubsection),
		hasTables,
		wordCount
	};
}

/**
 * Format section content with inline styling hints
 * Returns content with markers that can be styled
 */
export function formatSectionContent(content: string): string {
	let formatted = content;

	// Pre-process: format all types of tables into HTML tables
	formatted = formatGenericTables(formatted);  // Universal table parser (run first)
	formatted = formatDrugInteractionTables(formatted);
	formatted = formatAdverseReactionsTables(formatted);
	formatted = formatPharmacokineticTables(formatted);
	formatted = formatClinicalStudiesTables(formatted);
	formatted = formatFigureReferences(formatted);  // Format figure references

	// Pre-process: Add line breaks before ALL numbered sections
	// Supports 1, 2, and 3 level sections: "5 Title", "5.1 Title", "5.1.1 Title"
	// Also handles sections 7.x, 8.x, 12.x, 14.x etc., not just 5.x
	// This ensures visual clarity by separating sections with proper spacing

	// First, handle section numbers at the start of text/lines
	// Pattern: 1-3 level section numbers followed by capitalized title
	formatted = formatted.replace(
		/^(\d+(?:\.\d+)?(?:\.\d+)?)\s+([A-Z][A-Za-z\s,()-]+?)(?=\s{2}|\n|$)/gm,
		'<br/><br/><span class="fda-subsection-header"><span class="fda-section-number">$1</span> <span class="fda-section-title">$2</span></span>'
	);

	// Then handle section numbers that appear mid-text (after any character)
	// Adds line break before ALL section numbers for better visual separation
	formatted = formatted.replace(
		/([^\n<])(\s*)(\d+(?:\.\d+)?(?:\.\d+)?)\s+([A-Z][A-Za-z\s,()-]+?)(?=\s{2}|\n|[.!?]|$)/g,
		'$1$2<br/><br/><span class="fda-subsection-header"><span class="fda-section-number">$3</span> <span class="fda-section-title">$4</span></span>'
	);

	// Pre-process: split on semicolons and numbered lists for better line breaks
	formatted = splitOnSemicolonLists(formatted);
	formatted = splitNumberedLists(formatted);

	// Highlight warning keywords (DO NOT, CONTRAINDICATED, etc.)
	formatted = formatted.replace(
		WARNING_KEYWORDS_PATTERN,
		'<span class="fda-warning-keyword">$1</span>'
	);

	// Highlight action verbs (Monitor, Avoid, etc.)
	formatted = formatted.replace(
		ACTION_VERB_PATTERN,
		'<span class="fda-action-verb">$1</span>'
	);

	// Highlight drug classes (Class I, Class III/IV)
	formatted = formatted.replace(
		DRUG_CLASS_PATTERN,
		'<span class="fda-drug-class">$&</span>'
	);

	// Highlight table references
	formatted = formatted.replace(
		TABLE_PATTERN,
		'<span class="fda-table-ref">$&</span>'
	);

	// Highlight Notes blocks
	formatted = formatted.replace(
		NOTES_PATTERN,
		'<span class="fda-notes-label">Notes: </span>'
	);

	// Highlight section references like (5.1) or (5.1, 12.3)
	formatted = formatted.replace(SECTION_REF_PATTERN, '<span class="fda-ref">($1)</span>');

	// Highlight "see" references
	formatted = formatted.replace(
		REFERENCE_PATTERN,
		'<span class="fda-see-ref">[see $1]</span>'
	);

	// Highlight clinical values
	formatted = formatted.replace(CLINICAL_VALUE_PATTERN, '<span class="fda-value">$&</span>');

	// Highlight drug names - use dynamic pattern with filtering
	// Only highlight words that look like drug names (not common FDA label words)
	formatted = formatted.replace(GENERIC_DRUG_PATTERN, (match) => {
		if (isDrugName(match)) {
			return `<span class="fda-drug">${match}</span>`;
		}
		return match;
	});

	// Convert bullet/dash lines to list items
	formatted = formatted.replace(
		/(?:^|\n)\s*[•·]\s*(.+?)(?=\n|$)/g,
		'\n<li class="fda-list-item">$1</li>'
	);
	formatted = formatted.replace(
		/(?:^|\n)\s*[-–—]\s+(.+?)(?=\n|$)/g,
		'\n<li class="fda-list-item">$1</li>'
	);

	// Convert numbered items to list items
	formatted = formatted.replace(
		/(?:^|\n)\s*(\d+)\.\s+(.+?)(?=\n|$)/g,
		'\n<li class="fda-numbered-item"><span class="fda-list-number">$1.</span> $2</li>'
	);

	// Wrap consecutive list items in ul
	formatted = formatted.replace(
		/(<li class="fda-(?:list|numbered)-item">.*?<\/li>\n?)+/g,
		'<ul class="fda-list">$&</ul>'
	);

	// Convert key-value patterns (only if colon is followed by actual content)
	formatted = formatted.replace(
		/^([A-Z][A-Za-z\s\/]+):\s+([A-Z].+)$/gm,
		'<div class="fda-key-value"><span class="fda-key-term">$1:</span> $2</div>'
	);

	// Convert paragraphs (text separated by double newlines)
	const paragraphs = formatted.split(/\n\n+/);
	formatted = paragraphs
		.map((para) => {
			para = para.trim();
			if (!para) return '';
			// Don't wrap if already wrapped in HTML tags
			if (
				para.startsWith('<ul') ||
				para.startsWith('<li') ||
				para.startsWith('<div')
			) {
				return para;
			}
			// Replace single newlines with <br> for better readability
			return `<p class="fda-paragraph">${para.replace(/\n/g, '<br/>')}</p>`;
		})
		.filter((p) => p)
		.join('\n');

	return formatted;
}

/**
 * Format content for compact display (fewer line breaks)
 */
export function formatSectionContentCompact(content: string): string {
	let formatted = content;

	// Highlight warning keywords
	formatted = formatted.replace(
		WARNING_KEYWORDS_PATTERN,
		'<span class="fda-warning-keyword">$1</span>'
	);

	// Highlight section references
	formatted = formatted.replace(SECTION_REF_PATTERN, '<span class="fda-ref">($1)</span>');

	// Highlight clinical values
	formatted = formatted.replace(CLINICAL_VALUE_PATTERN, '<span class="fda-value">$&</span>');

	// Highlight drug names - use dynamic pattern with filtering
	formatted = formatted.replace(GENERIC_DRUG_PATTERN, (match) => {
		if (isDrugName(match)) {
			return `<span class="fda-drug">${match}</span>`;
		}
		return match;
	});

	// Simple paragraph handling - convert double newlines to single breaks
	formatted = formatted
		.replace(/\n\n+/g, '</p><p class="fda-paragraph">')
		.replace(/\n/g, ' ');

	return `<p class="fda-paragraph">${formatted}</p>`;
}

/**
 * Get severity level based on content keywords
 */
export function getContentSeverity(
	content: string
): 'critical' | 'high' | 'moderate' | 'info' {
	const lowerContent = content.toLowerCase();

	// Critical keywords
	if (
		lowerContent.includes('death') ||
		lowerContent.includes('fatal') ||
		lowerContent.includes('life-threatening') ||
		lowerContent.includes('contraindicated') ||
		lowerContent.includes('do not use') ||
		lowerContent.includes('black box')
	) {
		return 'critical';
	}

	// High severity keywords
	if (
		lowerContent.includes('discontinue') ||
		lowerContent.includes('serious') ||
		lowerContent.includes('severe') ||
		lowerContent.includes('immediately') ||
		lowerContent.includes('emergency')
	) {
		return 'high';
	}

	// Moderate keywords
	if (
		lowerContent.includes('caution') ||
		lowerContent.includes('monitor') ||
		lowerContent.includes('risk') ||
		lowerContent.includes('may cause')
	) {
		return 'moderate';
	}

	return 'info';
}

/**
 * Get quick stats for FDA content
 */
export function getFdaContentStats(text: string | null): {
	sectionCount: number;
	bulletCount: number;
	wordCount: number;
	severity: 'critical' | 'high' | 'moderate' | 'info';
	readTime: string;
} {
	if (!text) {
		return {
			sectionCount: 0,
			bulletCount: 0,
			wordCount: 0,
			severity: 'info',
			readTime: '0 min'
		};
	}

	const formatted = formatFdaContent(text);
	const wordCount = text.split(/\s+/).length;
	const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

	return {
		sectionCount: formatted?.sections.length || 0,
		bulletCount: formatted?.bulletPoints.length || 0,
		wordCount,
		severity: getContentSeverity(text),
		readTime: `${readTimeMinutes} min`
	};
}

/**
 * Format boxed warning content with enhanced styling
 * Handles section numbers, bullet points, and emphasis for black box warnings
 */
export function formatBoxedWarning(content: string): string {
	if (!content || content.trim().length === 0) {
		return content;
	}

	let formatted = content;

	// Add line breaks before ALL numbered sections
	// Supports 1, 2, and 3 level sections: "5 Title", "5.1 Title", "5.1.1 Title"
	// First, handle section numbers at start of text/lines
	formatted = formatted.replace(
		/^(\d+(?:\.\d+)?(?:\.\d+)?)\s+([A-Z][A-Za-z\s,()-]+?)(?=\s{2}|\n|$)/gm,
		'<br/><br/><span class="boxed-subsection"><span class="boxed-section-number">$1</span> <span class="boxed-section-title">$2</span></span>'
	);

	// Then handle section numbers that appear mid-text
	formatted = formatted.replace(
		/([^\n<])(\s*)(\d+(?:\.\d+)?(?:\.\d+)?)\s+([A-Z][A-Za-z\s,()-]+?)(?=\s{2}|\n|[.!?]|$)/g,
		'$1$2<br/><br/><span class="boxed-subsection"><span class="boxed-section-number">$3</span> <span class="boxed-section-title">$4</span></span>'
	);

	// Highlight warning keywords
	formatted = formatted.replace(
		/\b(DO NOT|MUST NOT|SHOULD NOT|WARNING|CAUTION|CONTRAINDICATED|DISCONTINUE|IMMEDIATELY|FATAL|DEATH|LIFE-THREATENING|BLACK BOX|SERIOUS|SEVERE|PERMANENT|IRREVERSIBLE)\b/gi,
		'<span class="boxed-keyword">$1</span>'
	);

	// Highlight action verbs
	formatted = formatted.replace(
		/\b(Monitor|Avoid|Consider|Obtain|Discontinue|Withhold|Administer|Evaluate|Assess|Check|Measure|Test|Perform|Initiate|Resume|Delay|Suspend|Reduce|Increase|Adjust|Recommend)\b/g,
		'<span class="boxed-action">$1</span>'
	);

	// Section references like (5.1), (5.1.1), (5.1, 12.3.2)
	formatted = formatted.replace(
		/\(\s*(\d+(?:\.\d+)?(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?(?:\.\d+)?)*)\s*\)/g,
		'<span class="boxed-ref">($1)</span>'
	);

	// "see" references
	formatted = formatted.replace(
		/\[see\s+([^\]]+)\]/gi,
		'<span class="boxed-see-ref">[see $1]</span>'
	);

	// Clinical values
	formatted = formatted.replace(
		/(<|>|≤|≥|±)?\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:x\s*10\s*\d*\s*\/L|mg(?:\/(?:day|kg|mL))?|mL|%|mcg|IU|kg|g\/dL|cells\/mm3|mmol\/L|msec|months|weeks|days|hours|years|fold)/gi,
		'<span class="boxed-value">$&</span>'
	);

	// Convert numbered items
	formatted = formatted.replace(
		/(?:^|\n)\s*(\d+)\.\s+(.+?)(?=\n|$)/g,
		'\n<div class="boxed-list-item"><span class="boxed-list-number">$1.</span> $2</div>'
	);

	// Convert bullet/dash items
	formatted = formatted.replace(
		/(?:^|\n)\s*[•·-–—]\s*(.+?)(?=\n|$)/g,
		'\n<div class="boxed-bullet-item">• $1</div>'
	);

	// Paragraph breaks
	formatted = formatted.replace(/\n\n+/g, '</p><p class="boxed-paragraph">');
	formatted = formatted.replace(/\n/g, '<br/>');

	// Wrap in paragraph if not starting with a div
	if (!formatted.trim().startsWith('<div') && !formatted.trim().startsWith('<p')) {
		formatted = `<p class="boxed-paragraph">${formatted}</p>`;
	}

	return formatted;
}
