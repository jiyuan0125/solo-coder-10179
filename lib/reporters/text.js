var BaseReporter = require('./base');

/**
 * Text reporter without colors.
 */
var TextReporter = function() {
    this.errorCount = 0;
};

TextReporter.prototype = Object.create(BaseReporter.prototype);

TextReporter.prototype.onError = function(error, errors) {
    this.errorCount++;
    console.log(errors.explainError(error) + '\n');
};

TextReporter.prototype.afterAll = function() {
    if (this.errorCount) {
        console.log('\n' + this.errorCount + ' code style ' + (this.errorCount === 1 ? 'error' : 'errors') + ' found.');
    }
};

module.exports = BaseReporter.create(TextReporter);
