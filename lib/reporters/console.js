var BaseReporter = require('./base');

/**
 * Console reporter with colors.
 */
var ConsoleReporter = function() {
    this.errorCount = 0;
};

ConsoleReporter.prototype = Object.create(BaseReporter.prototype);

ConsoleReporter.prototype.onError = function(error, errors) {
    this.errorCount++;
    console.log(errors.explainError(error, true) + '\n');
};

ConsoleReporter.prototype.afterAll = function() {
    if (this.errorCount) {
        console.log('\n' + this.errorCount + ' code style ' + (this.errorCount === 1 ? 'error' : 'errors') + ' found.');
    }
};

module.exports = BaseReporter.create(ConsoleReporter);
