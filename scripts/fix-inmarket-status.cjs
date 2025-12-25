/**
 * Fix inMarket Status Script
 *
 * Cross-references MDB drug database with OGYEI authorized products list
 * to fix incorrect "kivont" (withdrawn) status for authorized drugs.
 *
 * Problem: The MDB's inMarket field comes from NEAK reimbursement data,
 * not marketing authorization. Many drugs are incorrectly marked as
 * inMarket=false when they have valid OGYEI authorization.
 *
 * Solution: Set inMarket=true for any drug that exists in OGYEI's
 * authorized products list.
 *
 * Usage: node scripts/fix-inmarket-status.cjs
 */

const fs = require('fs');
const path = require('path');

const MDB_PATH = path.join(__dirname, '../static/data/drugs/drug-database-mdb.json');
const OGYEI_PATH = path.join(__dirname, '../static/data/ogyei/authorized-products.json');
const BACKUP_PATH = path.join(__dirname, '../static/data/drugs/drug-database-mdb-backup.json');

function normalizeProductName(name) {
    if (!name) return '';
    return name.toUpperCase().trim()
        // Normalize common variations
        .replace(/\s+/g, ' ')
        .replace(/,/g, '')
        .replace(/\./g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function main() {
    console.log('=== Fix inMarket Status Script ===\n');

    // Load data
    console.log('Loading databases...');
    const ogyei = JSON.parse(fs.readFileSync(OGYEI_PATH, 'utf8'));
    const mdb = JSON.parse(fs.readFileSync(MDB_PATH, 'utf8'));

    console.log(`OGYEI products: ${ogyei.products.length}`);
    console.log(`MDB drugs: ${mdb.drugs.length}\n`);

    // Create lookup set from OGYEI products (by normalized name)
    const ogyeiNames = new Set();
    ogyei.products.forEach(p => {
        if (p.name) {
            ogyeiNames.add(normalizeProductName(p.name));
        }
    });
    console.log(`Unique OGYEI product names: ${ogyeiNames.size}\n`);

    // Track statistics
    let fixed = 0;
    let alreadyCorrect = 0;
    let notInOgyei = 0;
    let stillWithdrawn = 0;

    // Initial state
    const initialInMarket = mdb.drugs.filter(d => d.inMarket === true).length;
    const initialWithdrawn = mdb.drugs.filter(d => d.inMarket === false).length;
    console.log('Before fix:');
    console.log(`  - In market (inMarket=true): ${initialInMarket}`);
    console.log(`  - Withdrawn (inMarket=false): ${initialWithdrawn}\n`);

    // Process each drug
    mdb.drugs.forEach(drug => {
        const normalizedName = normalizeProductName(drug.name);
        const isInOgyei = ogyeiNames.has(normalizedName);

        if (isInOgyei) {
            if (!drug.inMarket) {
                // Fix: drug is in OGYEI but marked as withdrawn
                drug.inMarket = true;
                fixed++;
            } else {
                alreadyCorrect++;
            }
        } else {
            if (drug.inMarket) {
                // Drug marked as in market but not in OGYEI - might be old data
                notInOgyei++;
            } else {
                stillWithdrawn++;
            }
        }
    });

    // Final state
    const finalInMarket = mdb.drugs.filter(d => d.inMarket === true).length;
    const finalWithdrawn = mdb.drugs.filter(d => d.inMarket === false).length;

    console.log('After fix:');
    console.log(`  - In market (inMarket=true): ${finalInMarket}`);
    console.log(`  - Withdrawn (inMarket=false): ${finalWithdrawn}\n`);

    console.log('Statistics:');
    console.log(`  - Fixed (was false, now true): ${fixed}`);
    console.log(`  - Already correct: ${alreadyCorrect}`);
    console.log(`  - In market but not in OGYEI: ${notInOgyei}`);
    console.log(`  - Still withdrawn (not in OGYEI): ${stillWithdrawn}\n`);

    // Backup original file
    console.log('Creating backup...');
    fs.copyFileSync(MDB_PATH, BACKUP_PATH);
    console.log(`Backup saved to: ${BACKUP_PATH}\n`);

    // Update metadata
    mdb.meta.lastInMarketFix = new Date().toISOString();
    mdb.meta.inMarketFixStats = {
        fixed,
        alreadyCorrect,
        notInOgyei,
        stillWithdrawn
    };

    // Save updated database
    console.log('Saving updated database...');
    fs.writeFileSync(MDB_PATH, JSON.stringify(mdb, null, 2), 'utf8');
    console.log(`Updated database saved to: ${MDB_PATH}\n`);

    // Verify bevacizumab fix
    console.log('Verifying bevacizumab fix:');
    const bevaDrugs = mdb.drugs.filter(d =>
        d.activeIngredient &&
        d.activeIngredient.toLowerCase() === 'bevacizumab'
    );
    const bevaInMarket = bevaDrugs.filter(d => d.inMarket === true).length;
    const bevaWithdrawn = bevaDrugs.filter(d => d.inMarket === false).length;
    console.log(`  - Bevacizumab in market: ${bevaInMarket}`);
    console.log(`  - Bevacizumab withdrawn: ${bevaWithdrawn}\n`);

    console.log('Done!');
}

main();
