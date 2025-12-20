# HDD - Hungarian Drug Database by Neuratos

Comprehensive Hungarian drug database with offline-first architecture and multiple data source integration.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Svelte](https://img.shields.io/badge/svelte-5.x-orange.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)

## Features

- **46,485 drugs** from NEAK (pupha_kozos.mdb) official Hungarian drug database
- **23,664 ICD-10 BNO codes** with organ system filtering
- **758 EU support points** (GYSE) with prescriber eligibility
- **FDA clinical data** integration (contraindications, interactions, warnings)
- **40,520 OGYÉI products** with authorization status
- **Offline-first** architecture with IndexedDB caching
- **Smart search** by drug name, active ingredient, or ATC code

## Pages

- `/drugs` - Drug search and browser
- `/bno` - ICD-10 diagnosis code search with organ system grouping
- `/gyse` - EU support points browser

## Data Sources

| Source | Description | Records |
|--------|-------------|---------|
| **NEAK** | Official Hungarian drug database (pupha_kozos.mdb) | 46,485 drugs |
| **OpenFDA** | FDA Drug Label API for clinical data | Real-time |
| **OGYÉI** | Hungarian authorized products list | 40,520 products |
| **ICD-10 HU** | Hungarian BNO diagnosis codes | 23,664 codes |

## Tech Stack

- **SvelteKit 2** + **Svelte 5** with runes
- **TypeScript** 5.x
- **Tailwind CSS** 3.x
- **Dexie** (IndexedDB) for offline caching
- **Lucide** icons

## Installation

```bash
# Clone the repository
git clone https://github.com/Zsolaj123/HDD-Hungarian_drug_database.git
cd HDD-Hungarian_drug_database

# Install dependencies
npm install

# Start development server
npm run dev
```

## Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
src/
├── routes/
│   ├── +page.svelte         # Landing page
│   ├── +layout.svelte       # Navigation header
│   ├── drugs/+page.svelte   # Drug search
│   ├── bno/+page.svelte     # BNO code search
│   └── gyse/+page.svelte    # GYSE browser
├── lib/
│   ├── services/            # Data services
│   │   ├── drug-database-service.ts
│   │   ├── indication-service.ts
│   │   ├── openfda-service.ts
│   │   ├── ogyei-service.ts
│   │   └── ...
│   ├── components/ui/       # UI components
│   │   ├── DrugAutocomplete.svelte
│   │   ├── DrugInfoModal.svelte
│   │   └── ...
│   └── utils/               # Utilities
static/
└── data/                    # Static JSON databases
    ├── drugs/               # Drug data (~38MB)
    ├── indications/         # Drug-BNO mappings (~101MB)
    ├── bno/                 # BNO codes (~6MB)
    ├── specialties/         # Medical specialties
    └── ogyei/               # OGYÉI products (~49MB)
```

## Key Features

### Drug Search
- Grouped search by base drug name
- Two-step selection: group → variant
- Active ingredient (hatóanyag) display
- ATC code classification
- Dosage and packaging information

### BNO Codes
- Full ICD-10 Hungarian adaptation
- Organ system (szervrendszer) filtering
- Drug-indication mappings
- EU support point links

### FDA Integration
- Contraindications
- Drug interactions
- Warnings and precautions
- Adverse reactions
- Boxed warnings

### GYSE / EU Points
- Prescriber eligibility by specialty
- Time limits for prescriptions
- Off-label indication markers
- Support category details

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

**Neuratos** - [GitHub](https://github.com/Zsolaj123)

---

*HDD - Hungarian Drug Database is not intended for clinical decision-making. Always consult official sources and healthcare professionals.*
