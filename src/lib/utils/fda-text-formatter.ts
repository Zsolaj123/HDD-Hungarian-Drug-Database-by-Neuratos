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
 * Format adverse reactions tables into HTML tables
 * Pattern: Table N: Title... N = XXX headers... ConditionName X (X.X) X (X.X)...
 */
function formatAdverseReactionsTables(text: string): string {
	// Check for adverse reactions table pattern (has "N = XXX" and percentage data)
	if (!text.match(/N\s*=\s*\d+/) || !text.match(/\d+\s*\(\d+\.?\d*\)/)) {
		return text;
	}

	let result = text;

	// Find all table sections
	const tablePattern = /Table\s+(\d+):\s*([^]*?)(?=Table\s+\d+:|6\.\d|$)/gi;
	let match;

	while ((match = tablePattern.exec(text)) !== null) {
		const tableNum = match[1];
		const tableContent = match[2];

		// Extract title (before "Intent-to-treat" or "Number of Patients")
		const titleMatch = tableContent.match(/^([^]*?)(?=Intent-to-treat|Number of Patients|\sN\s*=)/i);
		if (!titleMatch) continue;
		const title = titleMatch[1].trim().replace(/\s+/g, ' ');

		// Find treatment group headers (N = XXX patterns)
		const headerPattern = /N\s*=\s*(\d+)/g;
		const headers: string[] = [];
		let headerMatch;
		while ((headerMatch = headerPattern.exec(tableContent)) !== null) {
			headers.push(`N=${headerMatch[1]}`);
		}

		if (headers.length < 2) continue;

		// Find data rows: ConditionName followed by multiple "X (X.X)" patterns
		const dataRowPattern = /([A-Z][A-Za-z\s]+?)\s+((?:\d+\s*\([^)]+\)\s*)+)/g;
		const rows: Array<{condition: string, values: string[]}> = [];

		let rowMatch;
		while ((rowMatch = dataRowPattern.exec(tableContent)) !== null) {
			const condition = rowMatch[1].trim();
			const valuesStr = rowMatch[2];
			// Extract individual values like "7 (4)" or "5 (2.8)"
			const values = valuesStr.match(/\d+\s*\([^)]+\)/g) || [];

			if (values.length >= 2 && condition.length > 2 && condition.length < 50) {
				rows.push({ condition, values });
			}
		}

		if (rows.length === 0) continue;

		// Build HTML table
		let tableHtml = `<div class="fda-table-container">
			<div class="fda-table-header">Table ${tableNum}: ${title}</div>
			<table class="fda-adverse-table">
				<thead>
					<tr>
						<th>Mellékhatás</th>
						${headers.slice(0, rows[0].values.length).map(h => `<th>${h}</th>`).join('')}
					</tr>
				</thead>
				<tbody>`;

		for (const row of rows) {
			tableHtml += `<tr>
				<td class="fda-condition-cell">${row.condition}</td>
				${row.values.map(v => `<td class="fda-value-cell">${v}</td>`).join('')}
			</tr>`;
		}

		tableHtml += `</tbody></table></div>`;

		// Replace the table section in result
		const fullMatch = `Table ${tableNum}:${tableContent}`;
		const originalStart = result.indexOf(fullMatch);
		if (originalStart !== -1) {
			// Find where next table or section starts
			const nextTableMatch = result.substring(originalStart + 10).match(/Table\s+\d+:|6\.\d/);
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
 */
function formatPharmacokineticTables(text: string): string {
	// Check for PK table patterns (has AUC, Cmax, geometric mean ratio)
	if (!text.match(/AUC|C\s*max|Geometric Mean/i)) {
		return text;
	}

	let result = text;

	// Find tables with PK data pattern
	const tablePattern = /Table\s+(\d+):\s*Effect of ([^]*?)(?=Table\s+\d+:|12\.\d|Effects of|$)/gi;
	let match;

	while ((match = tablePattern.exec(text)) !== null) {
		const tableNum = match[1];
		const tableContent = match[2];

		// Extract title
		const titleMatch = tableContent.match(/^([^]*?)(?=Coadministered Drug|All doses)/i);
		if (!titleMatch) continue;
		const title = `Effect of ${titleMatch[1].trim().replace(/\s+/g, ' ')}`;

		// Find drug rows: DrugName followed by dose info and ratio values
		const drugPattern = /([A-Z][a-z]+(?:\s+[A-Za-z]+)?)\s+(\d+(?:\.\d+)?\s*(?:mg|µg)[^]*?)\s+(\d+\.\d+)\s+(\d+\.\d+)/g;
		const rows: Array<{drug: string, dose: string, auc: string, cmax: string}> = [];

		let rowMatch;
		while ((rowMatch = drugPattern.exec(tableContent)) !== null) {
			rows.push({
				drug: rowMatch[1].trim(),
				dose: rowMatch[2].trim().substring(0, 50),
				auc: rowMatch[3],
				cmax: rowMatch[4]
			});
		}

		if (rows.length === 0) continue;

		// Build HTML table
		let tableHtml = `<div class="fda-table-container">
			<div class="fda-table-header">Table ${tableNum}: ${title}</div>
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
			const nextMatch = result.substring(originalStart + 10).match(/Table\s+\d+:|12\.\d|Effects of/);
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
 * Pattern: Table N: Glycemic Parameters... with HbA1c, FPG values
 */
function formatClinicalStudiesTables(text: string): string {
	// Check for clinical studies table patterns
	if (!text.match(/Glycemic Parameters|HbA1c|FPG|Fasting Plasma Glucose/i)) {
		return text;
	}

	let result = text;

	// Find glycemic parameter tables
	const tablePattern = /Table\s+(\d+):\s*Glycemic Parameters[^]*?(?=Table\s+\d+:|14\.\d|$)/gi;
	let match;

	while ((match = tablePattern.exec(text)) !== null) {
		const tableNum = match[1];
		const tableContent = match[0];

		// Extract key data points
		const hba1cMatch = tableContent.match(/HbA1c\s*\(%\)[^]*?(?:baseline|change)[^]*?(-?\d+\.?\d*)/i);
		const fpgMatch = tableContent.match(/FPG[^]*?(?:baseline|change)[^]*?(-?\d+\.?\d*)/i);

		// Create a summary card instead of trying to parse complex table
		let tableHtml = `<div class="fda-table-container">
			<div class="fda-table-header">Table ${tableNum}: Glycemic Parameters</div>
			<div class="fda-clinical-summary">
				<p class="fda-clinical-note">📊 Klinikai vizsgálati eredmények - részletes táblázat az eredeti FDA címkében</p>`;

		if (hba1cMatch) {
			tableHtml += `<p><strong>HbA1c változás:</strong> ${hba1cMatch[1]}%</p>`;
		}
		if (fpgMatch) {
			tableHtml += `<p><strong>Éhomi vércukor változás:</strong> ${fpgMatch[1]} mg/dL</p>`;
		}

		tableHtml += `</div></div>`;

		// Find where this table section ends
		const startIdx = result.indexOf(`Table ${tableNum}:`);
		if (startIdx !== -1) {
			const nextTable = result.substring(startIdx + 10).match(/Table\s+\d+:|14\.\d/);
			const endIdx = nextTable ? startIdx + 10 + (nextTable.index || 0) : startIdx + 200;

			// Only replace if we found meaningful data
			if (hba1cMatch || fpgMatch) {
				result = result.substring(0, startIdx) + tableHtml + result.substring(endIdx);
			}
		}
	}

	return result;
}

/**
 * Format drug interaction tables into HTML tables
 * Pattern: Drug Class → Clinical Impact → Intervention → Examples (repeating)
 * Handles multiple FDA table formats (metformin, atorvastatin, etc.)
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
		// Handles various FDA table formats:
		// - "with Atorvastatin Cyclosporine Clinical Impact:"
		// - "to Atorvastatin Rifampin Clinical Impact:"
		// - "Other Drugs Oral Contraceptives Clinical Impact:"
		// - Period or bracket ending previous entry
		const drugClassPattern = /(?:(?:with|to)\s+(?:Atorvastatin|Metformin|ZITUVIMET)(?:\s+Calcium)?\s+|Other\s+Drugs\s+|Rhabdomyolysis\s+with\s+\w+(?:\s+\w+)?\s+|Exposure\s+to\s+\w+\s+|[.\]]\s+)([A-Z][A-Za-z\s,()/>-]+?)(?=\s*Clinical Impact:)/gm;
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

	// Pre-process: format all types of tables into HTML tables
	formatted = formatDrugInteractionTables(formatted);
	formatted = formatAdverseReactionsTables(formatted);
	formatted = formatPharmacokineticTables(formatted);
	formatted = formatClinicalStudiesTables(formatted);

	// Pre-process: Add line breaks before section numbers like "5.1 Title" or "5.2 Risk"
	// Pattern: number.number followed by space and capitalized word (subsection header)
	formatted = formatted.replace(
		/([.!?:]\s*)(\d+\.\d+)\s+([A-Z][A-Za-z\s]+?)(?=\s|$)/g,
		'$1<br/><span class="fda-subsection-header"><span class="fda-section-number">$2</span> <span class="fda-section-title">$3</span></span>'
	);

	// Also handle section numbers at start of text
	formatted = formatted.replace(
		/^(\d+\.\d+)\s+([A-Z][A-Za-z\s]+?)(?=\s|$)/gm,
		'<span class="fda-subsection-header"><span class="fda-section-number">$1</span> <span class="fda-section-title">$2</span></span>'
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

/**
 * Format boxed warning content with enhanced styling
 * Handles section numbers, bullet points, and emphasis for black box warnings
 */
export function formatBoxedWarning(content: string): string {
	if (!content || content.trim().length === 0) {
		return content;
	}

	let formatted = content;

	// Add line breaks before section numbers like "5.1 Title"
	formatted = formatted.replace(
		/([.!?:]\s*)(\d+\.\d+)\s+([A-Z][A-Za-z\s]+?)(?=\s|$)/g,
		'$1<br/><span class="boxed-subsection"><span class="boxed-section-number">$2</span> <span class="boxed-section-title">$3</span></span>'
	);

	// Section numbers at start
	formatted = formatted.replace(
		/^(\d+\.\d+)\s+([A-Z][A-Za-z\s]+?)(?=\s|$)/gm,
		'<span class="boxed-subsection"><span class="boxed-section-number">$1</span> <span class="boxed-section-title">$2</span></span>'
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

	// Section references like (5.1)
	formatted = formatted.replace(
		/\(\s*(\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*)\s*\)/g,
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
