/**
 * Database Module - Patient Workflow Canvas
 *
 * Implements Dexie.js wrapper for IndexedDB storage.
 * All patient data stays local per Constitution Principle I.
 */
import Dexie, { type Table } from 'dexie';

// ============================================================================
// Type Definitions
// ============================================================================

export type PatientStatus = 'active' | 'discharged';

export type MedicalSpecialty =
	| 'neurology'
	| 'internal_medicine'
	| 'cardiology'
	| 'pulmonology'
	| 'gastroenterology'
	| 'nephrology'
	| 'general';

export type NodeType =
	| 'admission'
	| 'history'
	| 'drug'
	| 'medication' // alias for drug
	| 'finding'
	| 'task'
	| 'note'
	| 'examination'
	// Patient card section types (detachable)
	| 'patientCard'
	| 'caveSection'
	| 'anamnesisSection'
	| 'complaintsSection'
	| 'statusSection'
	| 'neurologicalSection'
	| 'diagnosisSection'
	| 'drugsSection'
	| 'planSection'
	| 'summarySection'
	// AI suggestion nodes
	| 'aiSuggestion';

export interface Patient {
	id?: number;
	initials: string;
	birthYear: number; // 4-digit year (e.g., 1947)
	roomNumber: string;
	bedNumber: string;
	status: PatientStatus;
	admissionDate: Date;
	gender?: 'male' | 'female' | 'other';
	currentDMT?: string; // Current disease-modifying therapy
	latestEDSS?: number; // Latest EDSS score
	aiMetadata?: AIMetadata[]; // History of AI enhancement sessions
}

export interface SectionCustomization {
	key: string;
	label: string;
	labelHu: string;
	visible: boolean;
	order: number;
}

export interface TemplateConfig {
	negativeStatusTemplate: string;
	dekurzusTemplate: string;
}

export type UnitDelimiter = '||' | '\n' | ',' | ';' | 'auto';

export interface ParserConfig {
	unitDelimiter: UnitDelimiter;
}

export interface UserSettings {
	id: string; // Always 'default' for single-user app
	specialty: MedicalSpecialty;
	n8nWebhookUrl?: string;
	aiEnhancementEnabled: boolean;
	// Enhanced settings
	sectionCustomizations?: Partial<Record<MedicalSpecialty, SectionCustomization[]>>;
	templates?: Partial<Record<MedicalSpecialty, TemplateConfig>>;
	parserConfig?: ParserConfig;
	// Document parsing configuration (section rules, unit rules, overrides)
	parsingConfiguration?: ParsingConfiguration;
	createdAt: Date;
	updatedAt: Date;
}

export interface NodePosition {
	x: number;
	y: number;
}

export interface NodeDimensions {
	width: number;
	height: number;
}

export interface MediaAttachment {
	id: string;
	type: 'image' | 'screenshot';
	dataUrl: string;
	filename?: string;
	createdAt: Date;
}

export interface TimelineNode {
	id: string;
	patientId: number;
	type: NodeType;
	content: NodeContent;
	label?: string; // Optional display label
	isCompleted?: boolean;
	createdAt: Date;
	targetDate: Date;
	// New fields for enhanced UI
	position?: NodePosition;
	dimensions?: NodeDimensions;
	connections?: string[]; // IDs of connected nodes
	media?: MediaAttachment[];
}

// ============================================================================
// Content Type Definitions
// ============================================================================

export interface AdmissionContent {
	chiefComplaint?: string;
	admittingDiagnosis?: string;
	notes?: string;
}

/**
 * Extended admission content for parsed document data
 */
export interface ExtendedAdmissionContent {
	// Basic fields
	chiefComplaint?: string;
	notes?: string;
	// CAVE / Allergies
	cave?: {
		allergies?: string[];
		contraindications?: string[];
		notes?: string;
	};
	// Anamnesis
	anamnezis?: string;
	// Current complaints
	jelenPanaszok?: string;
	// Internal medicine status
	belgyogyaszatiStatusz?: string;
	// Neurological status - can be string or structured object
	neurologiaiStatusz?: string | {
		summary?: string;
		pupillak?: string;
		motorosFunkciok?: string;
		szenzoros?: string;
		reflexek?: string;
		koordinacio?: string;
		jaras?: string;
		beszed?: string;
		kopoideges?: string;
		edss?: number;
	};
	// Vitals
	vitals?: {
		bloodPressure?: string;
		heartRate?: string;
		temperature?: string;
		respiratoryRate?: string;
		oxygenSaturation?: string;
		weight?: string;
		height?: string;
	};
	// Diagnosis
	diagnozis?: {
		primary?: string;
		icdCode?: string;
		differentials?: string[];
		notes?: string;
	};
	// Medications
	gyogyszerek?: Array<{
		name: string;
		dosage: string;
		frequency?: string;
		route?: 'oral' | 'iv' | 'im' | 'sc' | 'topical' | 'inhaled' | 'rectal';
		startDate?: Date;
	}>;
	// Summary / Epicrisis
	osszefoglalas?: string;
	// Treatment plan
	terv?: string;
	// Source document info (if imported)
	sourceDocument?: {
		filename?: string;
		uploadedAt?: Date;
		rawText?: string;
		parseConfidence?: number;
	};
	// Section status metadata for canvas color coding
	// Values: 'original' | 'edited' | 'ai-enhanced' | 'empty'
	sectionStatuses?: Record<string, string>;
	// Track ejected sections (persisted to IndexedDB)
	ejectedSections?: string[];
	// Structured data extracted by AI
	structuredData?: {
		icdCodes?: Array<{ code: string; description: string; confidence: number }>;
		vitals?: Array<{ name: string; value: string; unit: string; isAbnormal?: boolean }>;
		labValues?: Array<{
			name: string;
			value: string;
			unit: string;
			referenceRange?: string;
			flag?: 'high' | 'low' | 'critical_high' | 'critical_low';
		}>;
	};
	// AI enhancement confidence scores per section
	aiConfidenceScores?: Record<string, number>;
}

export interface HistoryContent {
	category: 'medical' | 'surgical' | 'family' | 'social';
	description: string;
	date?: string;
}

export interface DrugContent {
	name: string;
	dosage: string;
	frequency: string;
	route?: 'oral' | 'iv' | 'im' | 'sc' | 'topical' | 'inhaled';
	startDate?: Date;
	endDate?: Date;
	notes?: string;
}

export interface FindingContent {
	description: string;
	category?: 'vital' | 'lab' | 'imaging' | 'exam' | 'other';
	value?: string;
	unit?: string;
	notes?: string;
}

export interface TaskContent {
	description: string;
	priority?: 'low' | 'medium' | 'high' | 'urgent';
	dueDate?: Date;
	assignedTo?: string;
	notes?: string;
	// Checklist-specific fields for daily to-do functionality
	isChecklistItem?: boolean;
	checklistDate?: Date; // The date this checklist item belongs to
	autoCreateEntry?: boolean; // If true, creates a timeline entry when completed
	entryType?: 'note' | 'finding'; // Type of entry to create on completion
	entryTemplate?: string; // Template for the auto-created entry
}

/**
 * Predefined checklist item template for daily tasks
 */
export interface ChecklistItemTemplate {
	id: string;
	label: string;
	labelHu: string; // Hungarian label
	category: 'vital' | 'lab' | 'medication' | 'procedure' | 'documentation' | 'custom';
	autoCreateEntry: boolean;
	entryType: 'note' | 'finding';
	entryTemplate?: string;
	defaultChecked?: boolean;
}

export interface NoteContent {
	text: string;
	category?: 'progress' | 'consultation' | 'discharge' | 'other' | 'complaints' | 'panasz';
}

// Patient Card Section Content Types (Ambuláns Lap format)
export interface PatientCardContent {
	// Main patient card - comprehensive data structure for ambuláns lap
	history?: string; // Anamnézis
	vitals?: {
		bloodPressure?: string;
		pulse?: string;
		temperature?: string;
		saturation?: string;
		respiratoryRate?: string;
	};
	medications?: Array<{ name: string; dosage: string; frequency?: string }>;
	workingDiagnosis?: string;
	icdCode?: string;
	differentialDiagnoses?: string[];
	plan?: string;
	notes?: string;
}

export interface StatusSectionContent {
	vitals?: {
		bloodPressure?: string;
		heartRate?: string;
		temperature?: string;
		respiratoryRate?: string;
		oxygenSaturation?: string;
	};
	parameters?: Array<{ name: string; value: string; unit?: string }>;
	notes?: string;
}

export interface DiagnosisSectionContent {
	chiefComplaint?: string;
	workingDiagnosis?: string;
	differentialDiagnoses?: string[];
	icd10Codes?: string[];
	notes?: string;
}

export interface PlanSectionContent {
	treatments?: string[];
	investigations?: string[];
	consultations?: string[];
	followUp?: string;
	notes?: string;
}

// AI Suggestion Node content
export interface AISuggestionContent {
	suggestion: string;
	sectionKey: string;
	confidence: number; // 0-1
	feedbackQuality?: number; // 0-100 percentage
	feedbackMessage?: string;
	sourceMetadataId?: string; // Reference to the AI metadata that generated this
	status?: 'pending' | 'accepted' | 'rejected';
}

export type NodeContent =
	| AdmissionContent
	| ExtendedAdmissionContent
	| HistoryContent
	| DrugContent
	| FindingContent
	| TaskContent
	| NoteContent
	| PatientCardContent
	| StatusSectionContent
	| DiagnosisSectionContent
	| PlanSectionContent
	| AISuggestionContent;

// ============================================================================
// AI Enhancement Types
// ============================================================================

/**
 * Severity levels for drug interactions
 */
export type DrugInteractionSeverity = 'critical' | 'major' | 'moderate' | 'minor' | 'info';

/**
 * Record of a drug interaction detected by AI
 */
export interface DrugInteractionRecord {
	id: string;
	drug1: string;
	drug2: string;
	severity: DrugInteractionSeverity;
	description: string;
	recommendation?: string;
	acknowledged: boolean;
	acknowledgedAt?: Date;
	acknowledgedBy?: string;
	notes?: string;
}

/**
 * ICD code extracted by AI
 */
export interface ExtractedICDCode {
	code: string;
	description: string;
	confidence: number;
	sourceText?: string; // The text that triggered this extraction
}

/**
 * Vital sign extracted by AI
 */
export interface ExtractedVital {
	name: string;
	value: string;
	unit: string;
	normalRange?: { min: number; max: number };
	isAbnormal?: boolean;
}

/**
 * Lab value extracted by AI
 */
export interface ExtractedLabValue {
	name: string;
	value: string;
	unit: string;
	referenceRange?: string;
	isAbnormal?: boolean;
	flag?: 'high' | 'low' | 'critical_high' | 'critical_low';
}

/**
 * Structured data extracted by AI from kórlap text
 */
export interface StructuredExtraction {
	icdCodes?: ExtractedICDCode[];
	vitals?: ExtractedVital[];
	labValues?: ExtractedLabValue[];
	extractedAt: Date;
}

/**
 * Metadata about an AI enhancement session
 */
/**
 * Stores per-section clinical suggestions from AI enhancement
 */
export interface SectionSuggestion {
	sectionKey: string;
	suggestion: string;
	confidence: number;
	timestamp: Date;
}

export interface AIMetadata {
	id: string;
	timestamp: Date;
	model?: string;
	totalConfidence: number;
	sectionsEnhanced: string[];
	sectionsApproved: string[];
	sectionsRejected: string[];
	aiConfidenceScores?: Record<string, number>; // Per-section confidence scores
	sectionSuggestions?: SectionSuggestion[]; // Per-section clinical suggestions from AI
	drugInteractions?: DrugInteractionRecord[];
	structuredData?: StructuredExtraction;
	processingTimeMs?: number;
	webhookUrl?: string;
}

// ============================================================================
// Task & Timeline Types
// ============================================================================

/**
 * Priority levels for tasks
 */
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Category of a task
 */
export type TaskCategory = 'lab' | 'imaging' | 'consult' | 'medication' | 'procedure' | 'documentation' | 'general';

/**
 * Undated task that lives in the permanent to-do section
 * When completed, moves to current day as a timeline event
 */
export interface UndatedTask {
	id: string;
	patientId: number;
	content: string;
	priority: TaskPriority;
	category: TaskCategory;
	createdAt: Date;
	dueDate?: Date; // Optional scheduled date
	isGeneral?: boolean; // True if this is a general/undated task
	notes?: string; // Completion notes
	completedAt?: Date; // When task was checked off
	movedToTimelineAt?: Date; // When moved to day timeline
	timelineNodeId?: string; // Reference to created timeline node
}

// ============================================================================
// Medication Types (Állandó vs Eseti)
// ============================================================================

export type MedicationType = 'allando' | 'eseti';
export type MedicationRoute = 'oral' | 'iv' | 'im' | 'sc' | 'topical' | 'inhaled' | 'rectal' | 'other';
export type MedicationSource = 'database' | 'custom' | 'korlap';

/**
 * Medication with type distinction (állandó = regular, eseti = temporary/as-needed)
 */
export interface Medication {
	id: string;
	patientId: number;
	drugId?: string;      // Link to drug database ID (for database-sourced medications)
	name: string;
	dosage: string;
	frequency?: string;
	route?: MedicationRoute;
	type: MedicationType;
	// For eseti terápia - can be single date OR date range
	startDate?: Date;
	endDate?: Date;
	singleDate?: Date; // For one-time administration
	notes?: string;
	createdAt: Date;
	isActive: boolean; // False if medication has been stopped
	source?: MedicationSource; // Track where the medication came from
}

// ============================================================================
// Vital Reading Types
// ============================================================================

export type VitalType = 'bloodPressure' | 'heartRate' | 'temperature' | 'respiratoryRate' | 'oxygenSaturation' | 'weight' | 'height';

/**
 * Single vital reading with timestamp
 */
export interface VitalReading {
	id: string;
	patientId: number;
	type: VitalType;
	value: string;
	unit: string;
	timestamp: Date;
	notes?: string;
}

// ============================================================================
// Document Parsing Configuration Types
// ============================================================================

/**
 * Supported medical document types for parsing
 */
export type DocumentType = 'korlap' | 'ambulans_lap' | 'zarojelentes';

/**
 * Visual rule builder condition types
 */
export type RuleConditionType = 'keyword' | 'format' | 'position';

/**
 * A single condition for matching a section header
 */
export interface RuleCondition {
	type: RuleConditionType;
	// Keyword matching
	keywords?: string[];
	caseSensitive?: boolean;
	// Format detection
	hasBold?: boolean;
	hasColon?: boolean;
	hasLineBreakBefore?: boolean;
	hasLineBreakAfter?: boolean;
	// Position in line
	linePosition?: 'start' | 'any';
}

/**
 * Section parsing rule - configurable by user
 */
export interface SectionParsingRule {
	id: string;
	sectionKey: string; // Internal key (e.g., 'cave', 'anamnezis')
	displayName: string; // English name
	displayNameHu: string; // Hungarian name
	color: string; // Hex color for UI
	priority: number; // Order of matching (lower = checked first)
	enabled: boolean;
	conditions: RuleCondition[];
	isCustom: boolean; // True if user-created
}

/**
 * Unit parsing rule - for drugs, diagnoses, plan items
 */
export type UnitType = 'drug' | 'diagnosis' | 'plan';

export interface UnitParsingRule {
	id: string;
	unitType: UnitType;
	name: string;
	delimiter: UnitDelimiter;
	extractDosage: boolean;
	extractFrequency: boolean;
	dosageUnits?: string[]; // mg, g, ml, IE, etc.
	frequencyKeywords?: string[]; // reggel, este, naponta, etc.
	routeKeywords?: string[]; // iv, im, sc, po, etc.
	minItemLength?: number; // Minimum characters for valid item
	detectNumberedList?: boolean;
	detectBNOCode?: boolean; // For diagnosis parsing
}

/**
 * Per-document-type configuration with overrides
 */
export interface DocumentTypeConfig {
	documentType: DocumentType;
	displayName: string;
	displayNameHu: string;
	sectionRules: SectionParsingRule[];
	unitRules: UnitParsingRule[];
}

/**
 * Manual override from wizard - for learning user corrections
 */
export interface ManualParsingOverride {
	id: string;
	sourceText: string; // The text that was incorrectly parsed
	targetSection: string; // The correct section it belongs to
	originalSection?: string; // What section it was originally assigned to
	documentType?: DocumentType;
	createdAt: Date;
	usageCount: number; // How many times this override was applied
}

/**
 * Main parsing configuration - stored in UserSettings
 */
export interface ParsingConfiguration {
	id: string;
	// Base rules (shared across all document types)
	baseSectionRules: SectionParsingRule[];
	baseUnitRules: UnitParsingRule[];
	// Per-document-type overrides (only stores differences from base)
	documentTypeOverrides: Partial<Record<DocumentType, DocumentTypeConfig>>;
	// Learned corrections from user's manual edits
	manualOverrides: ManualParsingOverride[];
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Default section rules - pre-populated for Hungarian medical documents
 */
export const DEFAULT_SECTION_RULES: SectionParsingRule[] = [
	{
		id: 'cave',
		sectionKey: 'cave',
		displayName: 'CAVE / Allergies',
		displayNameHu: 'CAVE / Allergiák',
		color: '#ef4444', // red
		priority: 1,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['CAVE', 'ALLERGIA', 'KONTRAINDIKÁCIÓ', 'TÚLÉRZÉKENYSÉG'], caseSensitive: false },
			{ type: 'format', hasColon: true },
			{ type: 'position', linePosition: 'start' }
		],
		isCustom: false
	},
	{
		id: 'anamnezis',
		sectionKey: 'anamnezis',
		displayName: 'Anamnesis',
		displayNameHu: 'Anamnézis',
		color: '#8b5cf6', // purple
		priority: 2,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['ANAMNÉZIS', 'KÓRELŐZMÉNY', 'ELŐZMÉNY'], caseSensitive: false },
			{ type: 'format', hasColon: true },
			{ type: 'position', linePosition: 'start' }
		],
		isCustom: false
	},
	{
		id: 'jelen_panaszok',
		sectionKey: 'jelenPanaszok',
		displayName: 'Current Complaints',
		displayNameHu: 'Jelen Panaszok',
		color: '#f97316', // orange
		priority: 3,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['JELEN PANASZOK', 'FELVÉTELI PANASZOK', 'AKTUÁLIS PANASZOK', 'PANASZOK'], caseSensitive: false },
			{ type: 'format', hasColon: true },
			{ type: 'position', linePosition: 'start' }
		],
		isCustom: false
	},
	{
		id: 'vitalis',
		sectionKey: 'vitals',
		displayName: 'Vitals',
		displayNameHu: 'Vitális Paraméterek',
		color: '#10b981', // emerald
		priority: 3.2,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['RR:', 'O2', 'SpO2', 'EKG', 'VÉRNYOMÁS', 'PULZUS'], caseSensitive: false },
			{ type: 'format', hasColon: true }
		],
		isCustom: false
	},
	{
		id: 'gyogyszerek',
		sectionKey: 'gyogyszerek',
		displayName: 'Medications',
		displayNameHu: 'Gyógyszerek',
		color: '#06b6d4', // cyan
		priority: 3.5,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['GYÓGYSZEREK', 'MEDIKÁCIÓ', 'AKTUÁLIS GYÓGYSZER', 'GYÓGYSZERES TERÁPIA'], caseSensitive: false },
			{ type: 'format', hasColon: true },
			{ type: 'position', linePosition: 'start' }
		],
		isCustom: false
	},
	{
		id: 'belgyogyaszati',
		sectionKey: 'belgyogyaszatiStatusz',
		displayName: 'Internal Medicine Status',
		displayNameHu: 'Belgyógyászati Státusz',
		color: '#3b82f6', // blue
		priority: 4,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['BELGYÓGYÁSZATI STÁTUSZ', 'FIZIKÁLIS VIZSGÁLAT', 'FIZIKÁLIS STÁTUSZ', 'BELGYÓGYÁSZAT'], caseSensitive: false },
			{ type: 'format', hasColon: true },
			{ type: 'position', linePosition: 'start' }
		],
		isCustom: false
	},
	{
		id: 'neurologiai',
		sectionKey: 'neurologiaiStatusz',
		displayName: 'Neurological Status',
		displayNameHu: 'Neurológiai Státusz',
		color: '#ec4899', // pink
		priority: 5,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['NEUROLÓGIAI STÁTUSZ', 'NEURO', 'NEUROLÓGIA', 'IDEGRENDSZERI'], caseSensitive: false },
			{ type: 'format', hasColon: true },
			{ type: 'position', linePosition: 'start' }
		],
		isCustom: false
	},
	{
		id: 'diagnozis',
		sectionKey: 'diagnozis',
		displayName: 'Diagnosis',
		displayNameHu: 'Diagnózis',
		color: '#f59e0b', // amber
		priority: 6,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['DIAGNÓZIS', 'KÓRISME', 'DG:', 'BNO', 'VÉGSŐ DIAGNÓZIS'], caseSensitive: false },
			{ type: 'format', hasColon: true },
			{ type: 'position', linePosition: 'start' }
		],
		isCustom: false
	},
	{
		id: 'osszefoglalas',
		sectionKey: 'osszefoglalas',
		displayName: 'Summary',
		displayNameHu: 'Összefoglalás',
		color: '#0ea5e9', // sky
		priority: 8,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['ÖSSZEFOGLALÁS', 'EPIKRÍZIS', 'ZÁRÓJELENTÉS', 'KÓRLEFOLYÁS'], caseSensitive: false },
			{ type: 'format', hasColon: true },
			{ type: 'position', linePosition: 'start' }
		],
		isCustom: false
	},
	{
		id: 'terv',
		sectionKey: 'terv',
		displayName: 'Treatment Plan',
		displayNameHu: 'Terv',
		color: '#22c55e', // green
		priority: 9,
		enabled: true,
		conditions: [
			{ type: 'keyword', keywords: ['TERV', 'TERAPIA', 'KEZELÉSI TERV', 'JAVASLATOK', 'TOVÁBBI TEENDŐK'], caseSensitive: false },
			{ type: 'format', hasColon: true },
			{ type: 'position', linePosition: 'start' }
		],
		isCustom: false
	}
];

/**
 * Default unit parsing rules
 */
export const DEFAULT_UNIT_RULES: UnitParsingRule[] = [
	{
		id: 'drug-default',
		unitType: 'drug',
		name: 'Gyógyszer',
		delimiter: 'auto',
		extractDosage: true,
		extractFrequency: true,
		dosageUnits: ['mg', 'g', 'ml', 'IE', 'NE', 'µg', 'mcg', 'U', 'E', 'tbl', 'amp', 'fiol'],
		frequencyKeywords: ['reggel', 'este', 'délben', 'naponta', 'szükség szerint', 'éhgyomorra', 'étkezés után', '1x', '2x', '3x', '4x'],
		routeKeywords: ['iv', 'im', 'sc', 'po', 'per os', 'inh', 'top', 'rect', 'subl']
	},
	{
		id: 'diagnosis-default',
		unitType: 'diagnosis',
		name: 'Diagnózis',
		delimiter: 'auto',
		extractDosage: false,
		extractFrequency: false,
		detectBNOCode: true,
		detectNumberedList: true,
		minItemLength: 3
	},
	{
		id: 'plan-default',
		unitType: 'plan',
		name: 'Terv',
		delimiter: 'auto',
		extractDosage: false,
		extractFrequency: false,
		detectNumberedList: true,
		minItemLength: 5
	}
];

/**
 * Creates a default parsing configuration
 */
export function createDefaultParsingConfiguration(): ParsingConfiguration {
	return {
		id: 'default',
		baseSectionRules: [...DEFAULT_SECTION_RULES],
		baseUnitRules: [...DEFAULT_UNIT_RULES],
		documentTypeOverrides: {},
		manualOverrides: [],
		createdAt: new Date(),
		updatedAt: new Date()
	};
}

// ============================================================================
// Database Class
// ============================================================================

export class PatientWorkflowDB extends Dexie {
	patients!: Table<Patient>;
	timelineNodes!: Table<TimelineNode>;
	userSettings!: Table<UserSettings>;
	undatedTasks!: Table<UndatedTask>;
	medications!: Table<Medication>;
	vitalReadings!: Table<VitalReading>;

	constructor() {
		super('PatientWorkflowDB');

		// Version 1: Initial schema
		this.version(1).stores({
			patients: '++id, roomNumber, status, [roomNumber+bedNumber]',
			timelineNodes: 'id, patientId, type, [patientId+targetDate], isCompleted'
		});

		// Version 2: Added position, dimensions, connections, media fields
		// Also added new node types: patientCard, statusSection, diagnosisSection, planSection
		this.version(2).stores({
			patients: '++id, roomNumber, status, [roomNumber+bedNumber]',
			timelineNodes: 'id, patientId, type, [patientId+targetDate], isCompleted'
		});

		// Version 3: Added birthYear to Patient, added userSettings table
		this.version(3)
			.stores({
				patients: '++id, roomNumber, status, [roomNumber+bedNumber]',
				timelineNodes: 'id, patientId, type, [patientId+targetDate], isCompleted',
				userSettings: 'id'
			})
			.upgrade((tx) => {
				// Migrate existing patients - set birthYear to 0 (unknown)
				return tx
					.table('patients')
					.toCollection()
					.modify((patient) => {
						if (patient.birthYear === undefined) {
							patient.birthYear = 0;
						}
					});
			});

		// Version 4: Added AI metadata fields to Patient, structuredData to content,
		// and undatedTasks table for persistent to-do items
		this.version(4).stores({
			patients: '++id, roomNumber, status, [roomNumber+bedNumber]',
			timelineNodes: 'id, patientId, type, [patientId+targetDate], isCompleted',
			userSettings: 'id',
			undatedTasks: 'id, patientId, priority, category, createdAt'
		});

		// Version 5: Added medications and vitalReadings tables
		// Medications: állandó (regular) vs eseti (temporary) with date support
		// VitalReadings: timestamped vital parameters
		this.version(5).stores({
			patients: '++id, roomNumber, status, [roomNumber+bedNumber]',
			timelineNodes: 'id, patientId, type, [patientId+targetDate], isCompleted',
			userSettings: 'id',
			undatedTasks: 'id, patientId, priority, category, createdAt',
			medications: 'id, patientId, type, isActive, createdAt',
			vitalReadings: 'id, patientId, type, timestamp'
		});

		// Version 6: Added drugId and source fields to medications for database linkage
		// drugId links to NEAK drug database for proper drug identification
		// source tracks where medication came from (database, custom, korlap paste)
		this.version(6)
			.stores({
				patients: '++id, roomNumber, status, [roomNumber+bedNumber]',
				timelineNodes: 'id, patientId, type, [patientId+targetDate], isCompleted',
				userSettings: 'id',
				undatedTasks: 'id, patientId, priority, category, createdAt',
				medications: 'id, patientId, drugId, type, isActive, createdAt',
				vitalReadings: 'id, patientId, type, timestamp'
			})
			.upgrade((tx) => {
				// Migrate existing medications to have source: 'custom' (since they lack drugId)
				return tx
					.table('medications')
					.toCollection()
					.modify((med: Medication) => {
						if (med.drugId === undefined) {
							med.source = 'custom';
						}
					});
			});
	}
}

// ============================================================================
// Database Instance & Helpers
// ============================================================================

export const db = new PatientWorkflowDB();

// ============================================================================
// Chrome UnknownError Workaround
// See: https://github.com/dexie/Dexie.js/issues/543
// See: https://github.com/dexie/Dexie.js/issues/2008
// ============================================================================

let isOpening = false;
let openPromise: Promise<Dexie> | null = null;

/**
 * Opens the database with retry logic for Chrome UnknownError.
 * This error occurs when IndexedDB connection is lost (backgrounding, memory pressure).
 *
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param delayMs - Initial delay between retries in ms (default: 100, exponential backoff)
 */
export async function openWithRetry(maxRetries = 3, delayMs = 100): Promise<Dexie> {
	// If already opening, return the existing promise
	if (isOpening && openPromise) {
		return openPromise;
	}

	// If already open, return immediately
	if (db.isOpen()) {
		return db;
	}

	isOpening = true;
	openPromise = (async () => {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				await db.open();
				console.log('[DB] Database opened successfully');
				return db;
			} catch (error) {
				lastError = error as Error;
				const errorName = (error as { name?: string })?.name || 'Unknown';
				const errorMessage = (error as { message?: string })?.message || String(error);

				console.warn(
					`[DB] Open attempt ${attempt + 1}/${maxRetries + 1} failed:`,
					errorName,
					errorMessage
				);

				// Check if this is a recoverable error
				const isUnknownError = errorName === 'UnknownError' ||
					errorMessage.includes('UnknownError') ||
					errorMessage.includes('Internal error opening backing store');

				if (!isUnknownError || attempt >= maxRetries) {
					// Non-recoverable error or max retries reached
					throw error;
				}

				// Wait before retrying (exponential backoff)
				const waitTime = delayMs * Math.pow(2, attempt);
				console.log(`[DB] Retrying in ${waitTime}ms...`);
				await new Promise((resolve) => setTimeout(resolve, waitTime));
			}
		}

		throw lastError || new Error('Failed to open database after retries');
	})();

	try {
		const result = await openPromise;
		return result;
	} finally {
		isOpening = false;
		openPromise = null;
	}
}

/**
 * Ensures the database is open before performing operations.
 * Use this before any database operation that might fail due to closed connection.
 */
export async function ensureDbOpen(): Promise<void> {
	if (!db.isOpen()) {
		await openWithRetry();
	}
}

/**
 * Wraps a database operation with automatic reconnection on failure.
 * Use this for critical operations that must succeed.
 *
 * @param operation - The database operation to perform
 * @param maxRetries - Maximum retries for the operation (default: 2)
 */
export async function withDbRecovery<T>(
	operation: () => Promise<T>,
	maxRetries = 2
): Promise<T> {
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			await ensureDbOpen();
			return await operation();
		} catch (error) {
			const errorName = (error as { name?: string })?.name || 'Unknown';
			const isDatabaseClosed = errorName === 'DatabaseClosedError' ||
				errorName === 'UnknownError' ||
				(error as { message?: string })?.message?.includes('database connection is closing');

			if (!isDatabaseClosed || attempt >= maxRetries) {
				throw error;
			}

			console.warn(`[DB] Operation failed with ${errorName}, attempting recovery...`);

			// Close and reopen
			try {
				db.close();
			} catch {
				// Ignore close errors
			}

			await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
		}
	}

	throw new Error('Database operation failed after recovery attempts');
}

// Listen for database close events and attempt to reopen
db.on('close', () => {
	console.warn('[DB] Database connection closed unexpectedly');
	// Attempt to reopen in background (non-blocking)
	openWithRetry().catch((err) => {
		console.error('[DB] Failed to reopen database after close event:', err);
	});
});

// Initialize database on module load
openWithRetry().catch((err) => {
	console.error('[DB] Initial database open failed:', err);
});

/**
 * Generate a UUID for timeline node IDs.
 */
export const generateUUID = (): string => crypto.randomUUID();
