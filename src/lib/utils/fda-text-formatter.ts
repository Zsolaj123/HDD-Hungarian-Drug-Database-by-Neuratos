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
const SECTION_HEADER_PATTERN = /^(\d+(?:\.\d+)?)\s+([A-Z][A-Za-z\s]+?)(?:\s|$)/gm;
const SUBSECTION_PATTERN = /(\d+\.\d+)\s+([A-Z][A-Za-z\s,]+?)(?:\n|:)/g;
const BULLET_PATTERN = /(?:^|\n)[\u2022\u2023\u25E6\u2043\u2219•]\s*(.+?)(?=\n|$)/g;
const REFERENCE_PATTERN = /\[see\s+([^\]]+)\]/gi;
const SECTION_REF_PATTERN = /\(\s*(\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*)\s*\)/g;
const CLINICAL_VALUE_PATTERN = /(<|>|≤|≥|±)?\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:x\s*10\s*\d*\s*\/L|mg(?:\/(?:day|kg|mL))?|mL|%|mcg|IU|kg|g\/dL|cells\/mm3|mmol\/L|msec|months|weeks|days|hours|years|fold)/gi;

// Extended MS drug pattern - all major DMTs
const DRUG_NAME_PATTERN =
	/TECFIDERA|TYSABRI|OCREVUS|KESIMPTA|AUBAGIO|GILENYA|MAVENCLAD|LEMTRADA|COPAXONE|BETASERON|AVONEX|REBIF|PLEGRIDY|ZEPOSIA|PONVORY|VUMERITY|BAFIERTAM|BRIUMVI|RITUXIMAB|NATALIZUMAB|FINGOLIMOD|DIMETHYL\s+FUMARATE|TERIFLUNOMIDE|OCRELIZUMAB|OFATUMUMAB|ALEMTUZUMAB|MITOXANTRONE|CLADRIBINE|SIPONIMOD|OZANIMOD|PONESIMOD/gi;

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

// Drug interaction table pattern - detects the repeating structure
const DRUG_INTERACTION_TABLE_PATTERN = /Table\s+\d+:\s*([^\n]+)\s+((?:[A-Z][A-Za-z\s,()]+(?:Clinical Impact:|Intervention:|Examples:)[^]*?)+)/gi;

// Individual drug interaction row pattern
const INTERACTION_ROW_PATTERN = /([A-Z][A-Za-z\s,()/-]+?)(?=Clinical Impact:)\s*Clinical Impact:\s*([^]*?)(?=Intervention:)\s*Intervention:\s*([^]*?)(?=Examples:|(?=[A-Z][A-Za-z\s,()/-]+Clinical Impact:)|$)(?:Examples:\s*([^]*?))?(?=(?:[A-Z][A-Za-z\s,()/-]+Clinical Impact:)|$)/g;

// Notes block detection
const NOTES_PATTERN = /Notes?:\s*/gi;

// Summary bullet pattern - short lines ending with section references
const SUMMARY_BULLET_PATTERN = /^[A-Z][^.]+\.\s*\(\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\s*\)$/gm;

/**
 * Extract summary bullets from the top of FDA content
 * These are short lines at the top that end with section references like ( 5.1 )
 */
function extractSummaryBullets(text: string): string[] {
	const bullets: string[] = [];
	const lines = text.split('\n');

	// Find consecutive lines at top that match summary pattern
	for (const line of lines) {
		const trimmed = line.trim();

		// Skip empty lines and main section headers
		if (!trimmed || /^\d+\s+[A-Z]+/.test(trimmed)) continue;

		// Check if this looks like a summary bullet (ends with reference like (5.1) or contains colon)
		if (/\(\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\s*\)\s*$/.test(trimmed)) {
			bullets.push(trimmed);
		} else if (trimmed.includes(':') && trimmed.length < 200) {
			// Also capture colon-separated summary items like "Herpes infections: Life-threatening..."
			const beforeRef = trimmed.replace(/\(\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\s*\)\s*$/, '').trim();
			if (beforeRef.includes(':')) {
				bullets.push(trimmed);
			}
		}

		// Stop when we hit a subsection header
		if (/^\d+\.\d+\s+[A-Z]/.test(trimmed)) break;

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
		// Check for section header (e.g., "5.1 Anaphylaxis and Angioedema")
		const headerMatch = line.match(/^(\d+(?:\.\d+)?)\s+([A-Z][A-Za-z\s,()-]+)$/);

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
 * Format drug interaction tables into HTML tables
 * Pattern: Drug Class → Clinical Impact → Intervention → Examples (repeating)
 */
function formatDrugInteractionTables(text: string): string {
	// Check if this text contains Drug Interaction table patterns
	if (!text.includes('Clinical Impact:') || !text.includes('Intervention:')) {
		return text;
	}

	// Find table header like "Table 4: Clinically Significant Drug Interactions with DRUG_NAME"
	// Pattern captures everything up to but NOT including the first drug class
	// Titles typically end with drug name (Atorvastatin, Metformin, etc.)
	const tableHeaderMatch = text.match(/Table\s+(\d+):\s*((?:Clinically Significant )?Drug Interactions[^]*?(?:with\s+\w+(?:\s+Calcium)?))(?=\s+[A-Z])/i);
	if (!tableHeaderMatch) {
		return text;
	}

	const tableNum = tableHeaderMatch[1];
	const tableTitle = tableHeaderMatch[2].trim();

	// Find drug class names followed by "Clinical Impact:"
	// Pattern: after period/space, table header, closing bracket, or drug name ending, find capitalized words before "Clinical Impact:"
	// Added patterns: "] " for references, "in " or "Atorvastatin " for end of title
	const drugClassPattern = /(?:(?:\.\s+)|(?:ZITUVIMET\s+)|(?:Atorvastatin\s+)|(?:\]\s*)|(?:^))([A-Z][A-Za-z\s,()/-]+?)(?=\s*Clinical Impact:)/g;
	const drugClasses = [...text.matchAll(drugClassPattern)].map(m => m[1].trim());

	if (drugClasses.length === 0) {
		return text;
	}

	// Parse each drug interaction entry
	const rows: Array<{drug: string, impact: string, intervention: string, examples: string}> = [];

	for (const drugClass of drugClasses) {
		// Find the section for this drug class
		const escapedDrug = drugClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const sectionPattern = new RegExp(
			escapedDrug + '\\s*Clinical Impact:\\s*([^]*?)(?=Intervention:)' +
			'Intervention:\\s*([^]*?)(?=Examples:|(?:[A-Z][A-Za-z\\s,()/-]+Clinical Impact:)|$)' +
			'(?:Examples:\\s*([^.]*\\.?))?',
			'i'
		);

		const sectionMatch = text.match(sectionPattern);
		if (sectionMatch) {
			rows.push({
				drug: drugClass,
				impact: (sectionMatch[1] || '').trim().replace(/\s+/g, ' '),
				intervention: (sectionMatch[2] || '').trim().replace(/\s+/g, ' '),
				examples: (sectionMatch[3] || '').trim().replace(/\.$/, '')
			});
		}
	}

	if (rows.length === 0) {
		return text;
	}

	// Build HTML table
	const hasExamples = rows.some(r => r.examples);
	let tableHtml = `<div class="fda-table-container"><div class="fda-table-header">Table ${tableNum}: ${tableTitle}</div><table class="fda-interaction-table"><thead><tr><th>Gyógyszer/Osztály</th><th>Klinikai hatás</th><th>Beavatkozás</th>${hasExamples ? '<th>Példák</th>' : ''}</tr></thead><tbody>`;

	for (const row of rows) {
		tableHtml += `<tr><td class="fda-drug-cell">${row.drug}</td><td>${row.impact}</td><td>${row.intervention}</td>${hasExamples ? `<td class="fda-examples-cell">${row.examples}</td>` : ''}</tr>`;
	}

	tableHtml += `</tbody></table></div>`;

	// Find where the table content starts (first drug class)
	const firstDrug = rows[0].drug;
	const firstDrugIndex = text.indexOf(firstDrug + ' Clinical Impact:') || text.indexOf(firstDrug);

	// Find where the table content ends (after the last row's content)
	const lastRow = rows[rows.length - 1];
	const lastContent = lastRow.examples || lastRow.intervention;
	const tableEndIndex = text.indexOf(lastContent) + lastContent.length + 1;

	// Replace table section with formatted HTML - remove from table title to end of last row
	const tableStartIndex = tableHeaderMatch.index || 0;
	const beforeTable = text.substring(0, tableStartIndex);
	const afterTable = text.substring(tableEndIndex);

	return beforeTable + tableHtml + afterTable;
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

	// Drug names
	const drugMatches = text.matchAll(DRUG_NAME_PATTERN);
	for (const match of drugMatches) {
		highlights.push({
			type: 'drug',
			text: match[0]
		});
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

	// Pre-process: format drug interaction tables into HTML tables
	formatted = formatDrugInteractionTables(formatted);

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

	// Highlight drug names (MS drugs)
	formatted = formatted.replace(DRUG_NAME_PATTERN, '<span class="fda-drug">$&</span>');

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

	// Highlight drug names
	formatted = formatted.replace(DRUG_NAME_PATTERN, '<span class="fda-drug">$&</span>');

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
