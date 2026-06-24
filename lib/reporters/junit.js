var xml = require('xmlbuilder');
var BaseReporter = require('./base');

/**
 * JUnit XML reporter.
 */
var JunitReporter = function() {
    this.i = 0;
    this.testsuite = xml.create('testsuite');
};

JunitReporter.prototype = Object.create(BaseReporter.prototype);

JunitReporter.prototype.beforeAll = function(errorCollection) {
    this.testsuite.att('name', 'JSCS');
    this.testsuite.att('tests', errorCollection.length);
};

JunitReporter.prototype.beforeFile = function(errors) {
    var errorsCount = errors.getErrorCount();
    this.currentTestcase = this.testsuite.ele('testcase', {
        name: errors.getFilename(),
        failures: errorsCount
    });

    this.i += errorsCount;
    this.currentErrors = errors;
};

JunitReporter.prototype.onError = function(error) {
    this.currentTestcase.ele('failure', {}, this.currentErrors.explainError(error));
};

JunitReporter.prototype.afterAll = function() {
    this.testsuite.att('failures', this.i);
    console.log(this.testsuite.end({pretty: true}));
};

module.exports = BaseReporter.create(JunitReporter);
