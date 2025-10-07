const fs = require('fs');
const path = require('path');

// Helper for CSV escaping
function escapeCsv(value) {
    if (!value) return '';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
}

async function generateEventTypesCsv() {
    const filePath = path.join(__dirname, '../data/events.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw);

    const csv = ['id,title,status,created,updated'];

    for (const event of json.data) {
        const a = event.attributes;
        csv.push([
            event.id,
            escapeCsv(a.title),
            a.status ? 'published' : 'draft',
            a.created,
            a.changed
        ].join(','));
    }

    fs.writeFileSync(path.join(__dirname, '../csv/events.csv'), csv.join('\n'));
    console.log('✅ CSV generated from local file.');
}

generateEventTypesCsv();
