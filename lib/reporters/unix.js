var util = require('util');
var reporterUtils = require('../reporter-utils');

/**
 * @param {Errors[]} errorsCollection
 */
module.exports = function(errorsCollection) {
    reporterUtils.iterate(errorsCollection, {
        onError: function(error, fileErrors) {
            var file = fileErrors.getFilename();
            console.log(util.format('%s:%d:%d: %s', file, error.line, error.column, error.message));
        }
    });
};
