/**
 * Minimal reporter implementation.
 * Demonstrates the new reporter contract:
 * accepts a standardized reportContext object
 * and uses its accessor methods instead of
 * directly traversing the errors collection.
 *
 * Opts in to the new contract via the
 * StringChecker.REPORTER_CONTRACT marker.
 *
 * New Contract ReportContext:
 *   - errorsCollection: Errors[]  (raw errors per file)
 *   - getTotalErrorCount(): Number
 *   - getFileCount(): Number
 *   - getAllErrors(): Error[]
 *   - getFilename(errors): String
 *   - explainError(errors, error): String
 *
 * @param {Object} reportContext - Standardized reporter input
 */
var reporter = function(reportContext) {
    // Accept both the new contract (reportContext object with accessor methods)
    // and the legacy contract (raw errorsCollection array) so the reporter
    // works whether invoked through StringChecker.runReporter or the CLI
    // layer which passes the raw array.
    var totalErrors;
    var fileCount;

    if (reportContext && typeof reportContext.getTotalErrorCount === 'function') {
        totalErrors = reportContext.getTotalErrorCount();
        fileCount = reportContext.getFileCount();
    } else if (Array.isArray(reportContext)) {
        var errorsCollection = reportContext;
        fileCount = errorsCollection.length;
        totalErrors = 0;
        errorsCollection.forEach(function(errors) {
            if (errors && typeof errors.getErrorList === 'function') {
                totalErrors += errors.getErrorList().length;
            }
        });
    } else {
        return;
    }

    if (totalErrors === 0) {
        return;
    }

    console.log(fileCount + ' file(s) with ' + totalErrors + ' code style error(s).');
};

// Explicitly opt in to the new reporter contract.
// Without this marker, a plain function is treated as a
// legacy reporter receiving the raw errorsCollection array.
var StringChecker = require('../string-checker');
reporter[StringChecker.REPORTER_CONTRACT] = true;

module.exports = reporter;
