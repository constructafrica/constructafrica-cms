// Helper: Escape CSV field
function escapeCsv(value) {
    if (value === null || value === undefined) return '';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
}

// Helper: Format date for CSV (remove timezone)
function formatDateForCsv(dateString) {
    if (!dateString) return '';
    return dateString.split('+')[0].split('T')[0]; // Returns YYYY-MM-DD
}

// Helper: Format datetime for CSV (remove timezone)
function formatDateTimeForCsv(dateTimeString) {
    if (!dateTimeString) return '';
    return dateTimeString.split('+')[0]; // Returns YYYY-MM-DDTHH:mm:ss
}

module.exports = {
    escapeCsv,
    formatDateForCsv,
    formatDateTimeForCsv
};