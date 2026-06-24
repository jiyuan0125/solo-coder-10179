var reporterUtils = require('../reporter-utils');

/**
 * @param {Errors[]} errorsCollection
 */
module.exports = function(errorsCollection) {
    var errorCount = 0;

    reporterUtils.iterate(errorsCollection, {
        onError: function(error, fileErrors) {
            errorCount++;
            console.log(fileErrors.explainError(error, true) + '\n');
        }
    });

    if (errorCount) {
        console.log('\n' + errorCount + ' code style ' + (errorCount === 1 ? 'error' : 'errors') + ' found.');
    }
};
