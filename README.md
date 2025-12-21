# HDD - Hungarian Drug Database by Neuratos

<div align="center">

**Comprehensive Hungarian drug database with EMA/FDA integration and offline-first architecture**

*Teljes magyar gyógyszer-adatbázis EMA/FDA integrációval és offline-first architektúrával*

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Svelte](https://img.shields.io/badge/svelte-5.x-orange.svg)](https://svelte.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://www.typescriptlang.org)
[![SvelteKit](https://img.shields.io/badge/sveltekit-2.x-red.svg)](https://kit.svelte.dev)

[English](#english) | [Magyar](#magyar)

</div>

---

## English

### Overview

HDD (Hungarian Drug Database) is a comprehensive drug information system designed for healthcare professionals in Hungary. It integrates multiple authoritative data sources including NEAK, EMA, FDA, and OGYÉI to provide complete drug information with clinical safety data.

### Key Features

| Feature | Description |
|---------|-------------|
| **46,485 Drugs** | Complete NEAK database with active ingredients, ATC codes, dosages |
| **EMA Integration** | EU authorization status, shortages, safety alerts (DHPCs) |
| **FDA Clinical Data** | Contraindications, drug interactions, boxed warnings |
| **Multi-Ingredient Support** | Per-ingredient data lookup for combination drugs (98.3% coverage) |
| **23,664 BNO Codes** | Full ICD-10 Hungarian adaptation with organ system filtering |
| **Offline-First** | Works without internet after initial load |

### Screenshots

#### Drug Search with EMA/FDA Data
- Tabbed interface showing basic info, dosage, packaging, regulatory data
- EMA tab: EU authorization, shortages, safety alerts
- FDA tab: Contraindications, interactions, warnings, boxed warnings
- Multi-ingredient drugs: Per-ingredient sub-tabs with status indicators

### Data Sources

| Source | Description | Records |
|--------|-------------|---------|
| **NEAK** | Official Hungarian drug database | 46,485 drugs |
| **EMA** | European Medicines Agency | 2,649 EU-authorized medicines |
| **OpenFDA** | FDA Drug Labels API | Real-time clinical data |
| **OGYÉI** | Hungarian Drug Authority | 40,520 authorized products |
| **ICD-10 HU** | Hungarian BNO codes | 23,664 diagnosis codes |

### Installation

```bash
# Clone the repository
git clone https://github.com/Zsolaj123/HDD-Hungarian-Drug-Database-by-Neuratos.git
cd HDD-Hungarian-Drug-Database-by-Neuratos

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Production

```bash
npm run build
npm run preview
```

### Project Structure

```
src/
├── routes/
│   ├── drugs/+page.svelte    # Drug search with EMA/FDA tabs
│   ├── bno/+page.svelte      # BNO code search
│   └── gyse/+page.svelte     # EU support points browser
├── lib/
│   ├── services/
│   │   ├── drug-database-service.ts      # Core drug search
│   │   ├── ema-service.ts                # EMA data integration
│   │   ├── openfda-service.ts            # FDA labels API
│   │   ├── ingredient-parser-service.ts  # Multi-ingredient parsing
│   │   ├── ingredient-translation-service.ts  # HU→EN translation
│   │   └── indication-service.ts         # Drug-BNO mappings
│   └── components/ui/
│       ├── DrugAutocomplete.svelte       # Smart search component
│       ├── FdaContentDisplay.svelte      # FDA content renderer
│       └── ...
static/data/
├── drugs/           # Drug database (~38MB)
├── ema/             # EMA medicines, shortages, DHPCs (~5MB)
├── indications/     # Drug-BNO mappings (~101MB)
├── bno/             # BNO codes (~6MB)
└── ogyei/           # OGYÉI products (~49MB)
```

### Tech Stack

- **SvelteKit 2** + **Svelte 5** (runes mode)
- **TypeScript 5.x**
- **Tailwind CSS 3.x**
- **Dexie** (IndexedDB for offline caching)
- **Lucide** icons

### API Coverage

#### EMA Features
- Medicine authorization status (Authorised, Withdrawn, etc.)
- Active shortage alerts with affected forms/strengths
- DHPC safety communications
- Therapeutic indications
- Special flags: Biosimilar, Orphan, Additional Monitoring

#### FDA Features
- Boxed warnings (Black Box)
- Contraindications
- Drug interactions
- Warnings and precautions
- Adverse reactions
- Special populations (pregnancy, pediatric, geriatric)

#### Multi-Ingredient Drugs
- Automatic parsing of combination drugs
- Supports patterns: "A and B", "A és B", "A, B and C"
- Per-ingredient EMA/FDA lookup
- ATC code fallback for generic placeholders
- 98.3% coverage for 382 multi-ingredient drugs

---

## Magyar

### Áttekintés

A HDD (Hungarian Drug Database) egy átfogó gyógyszerinformációs rendszer magyarországi egészségügyi szakemberek számára. Több hivatalos adatforrást integrál (NEAK, EMA, FDA, OGYÉI), hogy teljes körű gyógyszerinformációt biztosítson klinikai biztonsági adatokkal.

### Főbb Funkciók

| Funkció | Leírás |
|---------|--------|
| **46 485 Gyógyszer** | Teljes NEAK adatbázis hatóanyagokkal, ATC kódokkal, dózisokkal |
| **EMA Integráció** | EU engedélyezési státusz, hiánycikkek, biztonsági figyelmeztetések |
| **FDA Klinikai Adatok** | Ellenjavallatok, gyógyszer-interakciók, fekete dobozos figyelmeztetések |
| **Többhatóanyagú Támogatás** | Hatóanyagonkénti adatlekérdezés kombinált készítményekhez (98,3% lefedettség) |
| **23 664 BNO Kód** | Teljes ICD-10 magyar adaptáció szervrendszeri szűréssel |
| **Offline-First** | Internet nélkül is működik az első betöltés után |

### Adatforrások

| Forrás | Leírás | Rekordok |
|--------|--------|----------|
| **NEAK** | Hivatalos magyar gyógyszertörzs | 46 485 gyógyszer |
| **EMA** | Európai Gyógyszerügynökség | 2 649 EU-engedélyezett gyógyszer |
| **OpenFDA** | FDA gyógyszercímke API | Valós idejű klinikai adatok |
| **OGYÉI** | Országos Gyógyszerészeti Intézet | 40 520 engedélyezett termék |
| **ICD-10 HU** | Magyar BNO kódok | 23 664 diagnóziskód |

### Telepítés

```bash
# Klónozás
git clone https://github.com/Zsolaj123/HDD-Hungarian-Drug-Database-by-Neuratos.git
cd HDD-Hungarian-Drug-Database-by-Neuratos

# Függőségek telepítése
npm install

# Fejlesztői szerver indítása
npm run dev
```

### Funkciók Részletesen

#### Gyógyszerkeresés
- Intelligens keresés név, hatóanyag vagy ATC kód alapján
- Csoportosított találatok alap gyógyszernév szerint
- Forgalomban lévő/kivont státusz jelzése
- Részletes adatlap 7 füllel

#### EMA (EU) Fül
- **Engedélyezési státusz**: Authorised, Withdrawn, stb.
- **Hiánycikk figyelmeztetések**: Érintett formák, dózisok, alternatívák
- **DHPC biztonsági közlemények**: Mellékhatás, minőségi hiba, hiány
- **Speciális jelzések**: Bioszimiláris, ritka betegség, fokozott felügyelet

#### FDA Klinikai Fül
- **Fekete dobozos figyelmeztetés** (Boxed Warning)
- **Ellenjavallatok** (Contraindications)
- **Gyógyszer-interakciók** (Drug Interactions)
- **Figyelmeztetések és óvintézkedések**
- **Mellékhatások** (Adverse Reactions)
- **Speciális populációk**: Terhesség, gyermekek, idősek

#### Többhatóanyagú Gyógyszerek
A rendszer automatikusan felismeri és kezeli a kombinált készítményeket:
- **Támogatott minták**: "A and B", "A és B", "A, B and C"
- **Hatóanyagonkénti fül**: Zöld/piros pont jelzi az adatelérhetőséget
- **Aggregált figyelmeztetések**: Minden hatóanyag hiány/DHPC egy helyen
- **ATC fallback**: Generikus helyőrzők kezelése (pl. "irbesartan and diuretics")

#### BNO Kódok
- Teljes ICD-10 magyar adaptáció
- Szervrendszeri szűrés
- Gyógyszer-indikáció összerendelések
- EU támogatási pont linkek

#### GYSE / EU Pontok
- Felírási jogosultság szakma szerint
- Időkorlátok vényekhez
- Off-label indikáció jelölés
- Támogatási kategória részletek

### Technológiai Stack

- **SvelteKit 2** + **Svelte 5** (runes mód)
- **TypeScript 5.x**
- **Tailwind CSS 3.x**
- **Dexie** (IndexedDB offline gyorsítótárazás)
- **Lucide** ikonok

---

## Scripts

```bash
npm run dev      # Development server
npm run build    # Production build
npm run preview  # Preview production build
npm run check    # TypeScript check
```

### Audit Script

Test drug coverage across all data sources:

```bash
npx tsx scripts/audit-drug-coverage.ts --sample  # Quick 50-drug test
npx tsx scripts/audit-drug-coverage.ts --limit=1000  # Test 1000 drugs
npx tsx scripts/audit-drug-coverage.ts  # Full audit (9,063 active drugs)
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

**Neuratos** - Dr. Zsolaj

[![GitHub](https://img.shields.io/badge/GitHub-Zsolaj123-black?logo=github)](https://github.com/Zsolaj123)

---

<div align="center">

**Disclaimer / Figyelmeztetés**

*HDD is not intended for clinical decision-making. Always consult official sources and healthcare professionals.*

*A HDD nem klinikai döntéshozatalra készült. Mindig konzultáljon hivatalos forrásokkal és egészségügyi szakemberekkel.*

</div>
