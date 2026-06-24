var util = require('util');
var BaseReporter = require('./base');

/**
 * inlinesingle solves an issue that Windows (7+) users have been
 * experiencing using SublimeLinter-jscs. It appears this is due to
 * SublimeText not managing multi-line output properly on these machines.
 * This reporter differs from inline.js by producing one comment line
 * separated by linebreaks rather than a series of separate lines.
 */

/**
 * Inline single reporter.
 */
var InlineSingleReporter = function() {
    this.currentOut = [];
};

InlineSingleReporter.prototype = Object.create(BaseReporter.prototype);

InlineSingleReporter.prototype.beforeFile = function(errors) {
    this.currentFile = errors.getFilename();
    this.currentOut = [];
};

InlineSingleReporter.prototype.onError = function(error) {
    this.currentOut.push(util.format('%s: line %d, col %d, %s', this.currentFile, error.line, error.column, error.message));
};

InlineSingleReporter.prototype.afterFile = function() {
    if (this.currentOut.length > 0) {
        console.log(this.currentOut.join('\n'));
    }
};

module.exports = BaseReporter.create(InlineSingleReporter);
