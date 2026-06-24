/**
 * Base reporter class that provides standard traversal methods
 * for all error collection processing.
 *
 * All reporters should extend this class to avoid code duplication.
 *
 * @name BaseReporter
 */
var BaseReporter = function() {};

BaseReporter.prototype = {
    /**
     * Main entry point for all reporters.
     * Traverses the errors collection and calls appropriate hooks.
     *
     * @param {Errors[]} errorsCollection
     */
    traverse: function(errorsCollection) {
        var self = this;

        if (this.beforeAll) {
            this.beforeAll(errorsCollection);
        }

        errorsCollection.forEach(function(errors) {
            if (self.beforeFile) {
                self.beforeFile(errors);
            }

            if (!errors.isEmpty()) {
                errors.getErrorList().forEach(function(error) {
                    if (self.onError) {
                        self.onError(error, errors);
                    }
                });
            }

            if (self.afterFile) {
                self.afterFile(errors);
            }
        });

        if (this.afterAll) {
            this.afterAll(errorsCollection);
        }
    },

    /**
     * Returns total error count across all files.
     *
     * @param {Errors[]} errorsCollection
     * @returns {Number}
     */
    getTotalErrorCount: function(errorsCollection) {
        return errorsCollection.reduce(function(count, errors) {
            return count + errors.getErrorCount();
        }, 0);
    }
};

/**
 * Helper to create a reporter function from a class that extends BaseReporter.
 *
 * @param {Function} ReporterClass
 * @returns {Function}
 */
BaseReporter.create = function(ReporterClass) {
    return function(errorsCollection) {
        var reporter = new ReporterClass();
        reporter.traverse(errorsCollection);
    };
};

module.exports = BaseReporter;
