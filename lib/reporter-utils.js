/**
 * Reporter utilities - unified interface for all reporter formats.
 * Provides standardized iteration and data aggregation to eliminate
 * duplicate traversal code across all 9 reporter implementations.
 */

/**
 * Iterates through all errors in an errors collection with standardized callbacks.
 * Eliminates the repetitive "forEach -> isEmpty -> getErrorList -> forEach" pattern
 * that was duplicated across all 9 reporter implementations.
 *
 * @param {Errors[]} errorsCollection
 * @param {Object} handlers - Callback handlers
 * @param {Function} [handlers.onFile] - Called for each file that has errors: (fileErrors) => void
 * @param {Function} [handlers.onError] - Called for each error: (error, fileErrors) => void
 */
exports.iterate = function(errorsCollection, handlers) {
    var onFile = handlers.onFile;
    var onError = handlers.onError;

    var files = Array.isArray(errorsCollection) ? errorsCollection : [errorsCollection];

    files.forEach(function(fileErrors) {
        if (!fileErrors.isEmpty()) {
            if (onFile) {
                onFile(fileErrors);
            }

            if (onError) {
                fileErrors.getErrorList().forEach(function(error) {
                    onError(error, fileErrors);
                });
            }
        }
    });
};

/**
 * Gets the total count of errors across all files.
 *
 * @param {Errors[]} errorsCollection
 * @returns {Number}
 */
exports.getTotalErrorCount = function(errorsCollection) {
    var count = 0;
    exports.iterate(errorsCollection, {
        onError: function() {
            count++;
        }
    });
    return count;
};

/**
 * Groups errors by rule name.
 *
 * @param {Errors[]} errorsCollection
 * @returns {Object} Map of ruleName -> { count: Number, files: Object }
 */
exports.groupByRule = function(errorsCollection) {
    var errorsByRule = {};

    exports.iterate(errorsCollection, {
        onError: function(error, fileErrors) {
            var fileName = fileErrors.getFilename();
            var ruleName = error.rule;

            if (ruleName in errorsByRule) {
                errorsByRule[ruleName].count += 1;
            } else {
                errorsByRule[ruleName] = {
                    count: 1,
                    files: {}
                };
            }
            errorsByRule[ruleName].files[fileName] = 1;
        }
    });

    return errorsByRule;
};

/**
 * Groups errors by file name.
 *
 * @param {Errors[]} errorsCollection
 * @returns {Object} Map of filename -> errorCount
 */
exports.groupByFile = function(errorsCollection) {
    var errorsByFile = {};

    exports.iterate(errorsCollection, {
        onFile: function(fileErrors) {
            errorsByFile[fileErrors.getFilename()] = fileErrors.getErrorCount();
        }
    });

    return errorsByFile;
};
