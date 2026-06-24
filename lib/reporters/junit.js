var xml = require('xmlbuilder');
var reporterUtils = require('../reporter-utils');

module.exports = function(errorCollection) {
    var i = 0;
    var testsuite = xml.create('testsuite');

    testsuite.att('name', 'JSCS');
    testsuite.att('tests', errorCollection.length);

    reporterUtils.iterate(errorCollection, {
        onFile: function(fileErrors) {
            var errorsCount = fileErrors.getErrorCount();
            var testcase = testsuite.ele('testcase', {
                name: fileErrors.getFilename(),
                failures: errorsCount
            });

            i += errorsCount;

            fileErrors.getErrorList().forEach(function(error) {
                testcase.ele('failure', {}, fileErrors.explainError(error));
            });
        }
    });

    testsuite.att('failures', i);

    console.log(testsuite.end({pretty: true}));
};
