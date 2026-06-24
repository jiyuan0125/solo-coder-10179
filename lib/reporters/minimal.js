/**
 * Minimal reporter implementation.
 * Demonstrates the new reporter contract:
 * accepts a standardized reportContext object
 * and uses its accessor methods instead of
 * directly traversing the errors collection.
 *
 * Reporter Contract (new):
 * Function receives a single reportContext argument with:
 *   - errorsCollection: Errors[]  (raw errors per file)
 *   - getTotalErrorCount(): Number
 *   - getFileCount(): Number
 *   - getAllErrors(): Error[]
 *   - getFilename(errors): String
 *   - explainError(errors, error): String
 *
 * Legacy Mode (backward compat):
 * Function receives raw errorsCollection as only argument.
 *
 * @param {Object} reportContext - Standardized reporter input
 */
module.exports = function(reportContext) {
    // Support both new contract (reportContext) and legacy mode (errorsCollection)
    var errorsCollection = reportContext.errorsCollection || reportContext;
    var totalErrors = 0;
    var fileCount = 0;

    if (reportContext && typeof reportContext.getTotalErrorCount === 'function') {
        totalErrors = reportContext.getTotalErrorCount();
        fileCount = reportContext.getFileCount();
    } else {
        errorsCollection.forEach(function(errors) {
            if (!errors.isEmpty()) {
                fileCount++;
                totalErrors += errors.getErrorCount();
            }
        });
    }

    if (totalErrors === 0) {
        return;
    }

    console.log(fileCount + ' file(s) with ' + totalErrors + ' code style error(s).');
};
