var BaseReporter = require('./base');

/**
 * Summary reporter with tables.
 */
var SummaryReporter = function() {
    this.Table = require('cli-table');
    this.hasError = false;
    this.errorsByRule = {};
    this.style = {
        'padding-left': 0,
        'padding-right': 0,
        'head': ['yellow'],
        'border': ['red'],
        'compact': false
    };

    this.errorsByFileTable = new this.Table({
        'head': ['Path', 'Total Errors'],
        'colAligns': [
            'middle',
            'middle',
            'middle'
        ],
        'colWidths': [62, 18],
        'style': this.style
    });

    this.errorsByRuleTable = new this.Table({
        'head': ['Rule', 'Total Errors', 'Files With Errors'],
        'colAligns': [
            'middle',
            'middle',
            'middle'
        ],
        'colWidths': [49, 12, 18],
        'style': this.style
    });
};

SummaryReporter.prototype = Object.create(BaseReporter.prototype);

SummaryReporter.prototype.beforeFile = function(errors) {
    var fileName = errors.getFilename();
    if (!errors.isEmpty()) {
        this.hasError = true;
        this.errorsByFileTable.push([fileName, errors.getErrorCount()]);
        this.currentFileName = fileName;
    }
};

SummaryReporter.prototype.onError = function(error) {
    var fileName = this.currentFileName;
    if (error.rule in this.errorsByRule) {
        this.errorsByRule[error.rule].count += 1;
    } else {
        this.errorsByRule[error.rule] = {
            count: 1,
            files: {}
        };
    }
    this.errorsByRule[error.rule].files[fileName] = 1;
};

SummaryReporter.prototype.afterAll = function() {
    var totalErrors = 0;
    var totalFilesWithErrors = 0;
    Object.getOwnPropertyNames(this.errorsByRule).forEach(function(ruleName) {
        var fileCount = Object.getOwnPropertyNames(this.errorsByRule[ruleName].files).length;
        this.errorsByRuleTable.push([ruleName, this.errorsByRule[ruleName].count, fileCount]);
        totalErrors += this.errorsByRule[ruleName].count;
        totalFilesWithErrors += fileCount;
    }, this);
    this.errorsByRuleTable.push(['All', totalErrors, totalFilesWithErrors]);

    if (this.hasError === false) {
        console.log('No code style errors found.');
    } else {
        console.log(this.errorsByFileTable.toString());
        console.log(this.errorsByRuleTable.toString());
    }
};

module.exports = BaseReporter.create(SummaryReporter);
