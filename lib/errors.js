var chalk = require('chalk');
var TokenAssert = require('./token-assert');

var LINE_SEPARATOR = /\r\n|\r|\n/g;

var EMPTY_POS = {
    line: 1,
    column: 0
};

function createErrorObject(properties) {
    var error = {};
    for (var key in properties) {
        if (properties.hasOwnProperty(key)) {
            error[key] = properties[key];
        }
    }
    Object.defineProperty(error, 'fixed', {
        value: false,
        enumerable: false,
        writable: true,
        configurable: true
    });
    Object.defineProperty(error, '_actuallyChanged', {
        value: false,
        enumerable: false,
        writable: true,
        configurable: true
    });
    return error;
}

/**
 * Set of errors for specified file.
 *
 * @name Errors
 * @param {JsFile} file
 */
var Errors = function(file) {
    this._errorList = [];
    this._file = file;
    this._currentRule = '';

    /**
     * @type {TokenAssert}
     * @public
     */
    this.assert = new TokenAssert(file);
    this.assert.on('error', this._addError.bind(this));
};

Errors.prototype = {
    /**
     * Adds style error to the list
     *
     * @param {String | Error} message
     * @param {cst.types.Element} element
     * @param {Number} [offset] relative offset
     */
    add: function(message, element, offset) {
        if (message instanceof Error) {
            this._addParseError(message);
            return;
        }

        this._addError({
            message: message,
            element: element,
            offset: offset
        });
    },

    /**
     * Adds style error to the list - unified public API.
     * Use this instead of directly accessing _errorList.
     *
     * @param {Object} errorInfo
     */
    cast: function(errorInfo) {
        this._addError(errorInfo);
    },

    /**
     * Public API for adding an already-constructed error object.
     * Used by extract-js and other modules that need to add errors
     * with pre-computed locations.
     *
     * @param {Object} error - Complete error object with filename, rule, message, line, column
     */
    addRawError: function(error) {
        this._errorList.push(createErrorObject({
            filename: error.filename,
            rule: error.rule,
            message: error.message,
            line: error.line,
            column: error.column
        }));
    },

    /**
     * Adds parser error to error list.
     *
     * @param {Object} errorInfo
     * @private
     */
    _addParseError: function(errorInfo) {
        this._errorList.push(createErrorObject({
            filename: this._file.getFilename(),
            rule: 'parseError',
            message: errorInfo.message,
            line: errorInfo.loc ? errorInfo.loc.line : 1,
            column: errorInfo.loc ? errorInfo.loc.column : 0
        }));
    },

    /**
     * Adds error to error list.
     *
     * @param {Object} errorInfo
     * @private
     */
    _addError: function(errorInfo) {
        this._errorList.push(createErrorObject({
            filename: this._file.getFilename(),
            rule: this._currentRule,
            message: this._prepareMessage(errorInfo),
            element: errorInfo.element,
            offset: errorInfo.offset,
            additional: errorInfo.additional,
            fix: errorInfo.fix
        }));
    },

    /**
     * Prepare error message.
     *
     * @param {Object} errorInfo
     * @private
     */
    _prepareMessage: function(errorInfo) {
        var rule = errorInfo instanceof Error ? 'parseError' : this._currentRule;

        if (rule) {
            return rule + ': ' + errorInfo.message;
        }

        return errorInfo.message;
    },

    /**
     * Marks an error as fixed, tracking whether the code actually changed.
     * This is the unified public API for marking errors as fixed - do NOT
     * set error.fixed directly.
     *
     * @param {Object} error - The error to mark
     * @param {Boolean} actuallyChanged - Whether the fix actually modified the source code
     */
    markAsFixed: function(error, actuallyChanged) {
        error.fixed = true;
        error._actuallyChanged = !!actuallyChanged;
    },

    /**
     * Checks if a fix actually changed the source code (as opposed to
     * the rule marking it fixed without making any real changes).
     *
     * @param {Object} error
     * @returns {Boolean}
     */
    wasActuallyChanged: function(error) {
        return !!error._actuallyChanged;
    },

    /**
     * Determines whether an error should appear in the final output.
     * Errors that were marked fixed but didn't actually change code
     * should be suppressed from the final output.
     *
     * @param {Object} error
     * @returns {Boolean}
     */
    shouldAppearInFinalOutput: function(error) {
        if (error.fixed && !error._actuallyChanged) {
            return false;
        }
        return true;
    },

    /**
     * Filters out errors that shouldn't appear in the final output.
     * Call this at the end of the fix loop before returning errors.
     */
    filterSuppressedErrors: function() {
        var self = this;
        this._errorList = this._errorList.filter(function(error) {
            return self.shouldAppearInFinalOutput(error);
        });
    },

    /**
     * Returns style error list.
     *
     * @returns {Object[]}
     */
    getErrorList: function() {
        return this._errorList;
    },

    /**
     * Returns filename of file this error list is for.
     *
     * @returns {String}
     */
    getFilename: function() {
        return this._file.getFilename();
    },

    /**
     * Returns true if no errors are added.
     *
     * @returns {Boolean}
     */
    isEmpty: function() {
        return this._errorList.length === 0;
    },

    /**
     * Returns amount of errors added by the rules.
     *
     * @returns {Number}
     */
    getValidationErrorCount: function() {
        return this._errorList.filter(function(error) {
            return error.rule !== 'parseError' && error.rule !== 'internalError';
        });
    },

    /**
     * Returns amount of errors added by the rules.
     *
     * @returns {Number}
     */
    getErrorCount: function() {
        return this._errorList.length;
    },

    /**
     * Strips error list to the specified length.
     *
     * @param {Number} length
     */
    stripErrorList: function(length) {
        this._errorList.splice(length);
    },

    /**
     * Filters out errors based on the supplied filter function
     *
     * @param {Function} filter
     */
    filter: function(filter) {
        this._errorList = this._errorList.filter(filter);
    },

    /**
     * Iterates through all errors with standardized callbacks.
     * Part of the unified reporter protocol.
     *
     * @param {Object} handlers
     * @param {Function} [handlers.onError] - Called for each error: (error) => void
     */
    forEachError: function(handlers) {
        var onError = handlers.onError;
        if (onError) {
            this._errorList.forEach(function(error) {
                onError(error);
            });
        }
    },

    /**
     * @param {TokenIndex} tokenIndex
     */
    calculateErrorLocations: function(tokenIndex) {
        this._errorList.forEach(function(error) {
            var pos = Errors.getPosition(error, tokenIndex);
            error.line = pos.line;
            error.column = pos.column;
        });
    },

    /**
     * Formats error for further output.
     *
     * @param {Object} error
     * @param {Boolean} [colorize = false]
     * @returns {String}
     */
    explainError: function(error, colorize) {
        var lineNumber = error.line - 1;
        var lines = this._file.getLines();
        var result = [
            renderLine(lineNumber, lines[lineNumber], colorize),
            renderPointer(error.column, colorize)
        ];
        var i = lineNumber - 1;
        var linesAround = 2;
        while (i >= 0 && i >= (lineNumber - linesAround)) {
            result.unshift(renderLine(i, lines[i], colorize));
            i--;
        }
        i = lineNumber + 1;
        while (i < lines.length && i <= (lineNumber + linesAround)) {
            result.push(renderLine(i, lines[i], colorize));
            i++;
        }
        result.unshift(formatErrorMessage(error.message, this.getFilename(), colorize));
        return result.join('\n');
    },

    /**
     * Sets the current rule so that errors are aware
     * of which rule triggered them.
     *
     * @param {String} rule
     */
    setCurrentRule: function(rule) {
        this._currentRule = rule;
    }

};

/**
 * Formats error message header.
 *
 * @param {String} message
 * @param {String} filename
 * @param {Boolean} colorize
 * @returns {String}
 */
function formatErrorMessage(message, filename, colorize) {
    return (colorize ? chalk.bold(message) : message) +
        ' at ' +
        (colorize ? chalk.green(filename) : filename) + ' :';
}

/**
 * Simple util for prepending spaces to the string until it fits specified size.
 *
 * @param {String} s
 * @param {Number} len
 * @returns {String}
 */
function prependSpaces(s, len) {
    while (s.length < len) {
        s = ' ' + s;
    }
    return s;
}

/**
 * Renders single line of code in style error formatted output.
 *
 * @param {Number} n line number
 * @param {String} line
 * @param {Boolean} [colorize = false]
 * @returns {String}
 */
function renderLine(n, line, colorize) {
    // Convert tabs to spaces, so errors in code lines with tabs as indention symbol
    // could be correctly rendered, plus it will provide less verbose output
    line = line.replace(/\t/g, ' ');

    // "n + 1" to print lines in human way (counted from 1)
    var lineNumber = prependSpaces((n + 1).toString(), 5) + ' |';
    return ' ' + (colorize ? chalk.grey(lineNumber) : lineNumber) + line;
}

/**
 * Renders pointer:
 * ---------------^
 *
 * @param {Number} column
 * @param {Boolean} [colorize = false]
 * @returns {String}
 */
function renderPointer(column, colorize) {
    var res = (new Array(column + 9)).join('-') + '^';
    return colorize ? chalk.grey(res) : res;
}

/**
 * Get position of the element
 *
 * @param {Error} [error]
 * @param {TokenIndex} [tokenIndex]
 * @return {Object}
 */
Errors.getPosition = function(error, tokenIndex) {
    var element = error.element;
    var offset = error.offset;
    var rule = error.rule;

    if (!element) {
        return EMPTY_POS;
    }

    if (offset === undefined) {
        // TODO: probably should be generalized
        if (rule === 'validateQuoteMarks') {
            offset = 0;
        } else if (element.getSourceCodeLength() === 1) {
            offset = 0;
        } else {
            offset = (element.getNewlineCount() === 0 && Math.ceil(element.getSourceCodeLength() / 2)) || 0;
        }
    }

    var pos = tokenIndex ? tokenIndex.getElementLoc(element) : element.getLoc().start;
    if (!pos) {
        return EMPTY_POS;
    }

    if (offset === 0) {
        return pos;
    }

    var newlineCount = element.getNewlineCount();
    if (newlineCount > 0) {
        var code = element.getSourceCode();
        LINE_SEPARATOR.lastIndex = 0;
        var lineOffset = 0;
        var match;
        var previousOffset = 0;
        var firstLineColumnOffset = pos.column;
        while ((match = LINE_SEPARATOR.exec(code)) !== null) {
            var currentOffset = match.index;
            if (offset <= currentOffset) {
                return {
                    line: pos.line + lineOffset,
                    column: firstLineColumnOffset + offset - previousOffset
                };
            }
            previousOffset = currentOffset + match[0].length;
            firstLineColumnOffset = 0;
            lineOffset++;
        }
        return {
            line: pos.line + newlineCount,
            column: offset - previousOffset
        };
    } else {
        return {
            line: pos.line,
            column: pos.column + offset
        };
    }
};

module.exports = Errors;
