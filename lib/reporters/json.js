var BaseReporter = require('./base');

/**
 * JSON reporter.
 */
var JsonReporter = function() {
    this.jsonOutput = {};
    this.anyError = false;
};

JsonReporter.prototype = Object.create(BaseReporter.prototype);

JsonReporter.prototype.beforeFile = function(errors) {
    var file = errors.getFilename();
    this.jsonOutput[file] = [];

    if (!errors.isEmpty()) {
        this.anyError = true;
    }
};

JsonReporter.prototype.onError = function(error) {
    var arr = this.jsonOutput[error.filename];
    arr.push({
        line: error.line,
        column: error.column + 1,
        message: error.message
    });
};

JsonReporter.prototype.afterAll = function() {
    if (this.anyError) {
        console.log(JSON.stringify(this.jsonOutput));
    }
};

module.exports = BaseReporter.create(JsonReporter);
