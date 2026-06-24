var BaseReporter = require('./base');

function escapeAttrValue(attrValue) {
    return String(attrValue)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Checkstyle XML reporter.
 */
var CheckstyleReporter = function() {};

CheckstyleReporter.prototype = Object.create(BaseReporter.prototype);

CheckstyleReporter.prototype.beforeAll = function() {
    console.log('<?xml version="1.0" encoding="utf-8"?>\n<checkstyle version="4.3">');
};

CheckstyleReporter.prototype.beforeFile = function(errors) {
    console.log('    <file name="' + escapeAttrValue(errors.getFilename()) + '">');
};

CheckstyleReporter.prototype.onError = function(error) {
    console.log(
        '        <error ' +
        'line="' + error.line + '" ' +
        'column="' + (error.column + 1) + '" ' +
        'severity="error" ' +
        'message="' + escapeAttrValue(error.message) + '" ' +
        'source="jscs" />'
    );
};

CheckstyleReporter.prototype.afterFile = function() {
    console.log('    </file>');
};

CheckstyleReporter.prototype.afterAll = function() {
    console.log('</checkstyle>');
};

module.exports = BaseReporter.create(CheckstyleReporter);
