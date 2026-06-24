var reporterUtils = require('../reporter-utils');

/**
 * @param {Errors[]} errorsCollection
 */
module.exports = function(errorsCollection) {
    var jsonOutput = {};
    var anyError = false;

    reporterUtils.iterate(errorsCollection, {
        onFile: function(fileErrors) {
            var file = fileErrors.getFilename();
            jsonOutput[file] = [];
            anyError = true;
        },
        onError: function(error, fileErrors) {
            var file = fileErrors.getFilename();
            jsonOutput[file].push({
                line: error.line,
                column: error.column + 1,
                message: error.message
            });
        }
    });

    if (anyError) {
        console.log(JSON.stringify(jsonOutput));
    }
};
