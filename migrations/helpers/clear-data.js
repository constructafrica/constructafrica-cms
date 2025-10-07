/**
 * Helper script to empty all files inside the "data" directory.
 * It removes only file contents, not the directory itself.
 *
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../data');

async function clearDataFiles() {
    if (!fs.existsSync(DATA_DIR)) {
        console.log(`⚠️ Data directory not found: ${DATA_DIR}`);
        return;
    }

    const files = fs.readdirSync(DATA_DIR);

    if (files.length === 0) {
        console.log('✅ No files found in data directory.');
        return;
    }

    for (const file of files) {
        const filePath = path.join(DATA_DIR, file);

        try {
            const stats = fs.statSync(filePath);

            if (stats.isFile()) {
                fs.writeFileSync(filePath, '');
                console.log(`🧹 Cleared contents of: ${file}`);
            } else if (stats.isDirectory()) {
                console.log(`📁 Skipping directory: ${file}`);
            }
        } catch (err) {
            console.error(`❌ Failed to clear ${file}: ${err.message}`);
        }
    }

    console.log('\n✅ All files in "data" have been cleared.');
}

clearDataFiles();
