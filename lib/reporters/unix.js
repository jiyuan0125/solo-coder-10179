var util = require('util');
var BaseReporter = require('./base');

/**
 * Unix style reporter.
 */
var UnixReporter = function() {};

UnixReporter.prototype = Object.create(BaseReporter.prototype);

UnixReporter.prototype.beforeFile = function(errors) {
    this.currentFile = errors.getFilename();
};

UnixReporter.prototype.onError = function(error) {
    console.log(util.format('%s:%d:%d: %s', this.currentFile, error.line, error.column, error.message));
};

module.exports = BaseReporter.create(UnixReporter);
