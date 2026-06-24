var util = require('util');
var BaseReporter = require('./base');

/**
 * Inline reporter.
 */
var InlineReporter = function() {
    this.errorCount = 0;
};

InlineReporter.prototype = Object.create(BaseReporter.prototype);

InlineReporter.prototype.beforeFile = function(errors) {
    this.currentFile = errors.getFilename();
};

InlineReporter.prototype.onError = function(error) {
    this.errorCount++;
    console.log(util.format('%s: line %d, col %d, %s', this.currentFile, error.line, error.column, error.message));
};

module.exports = BaseReporter.create(InlineReporter);
