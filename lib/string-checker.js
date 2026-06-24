var Errors = require('./errors');
var JsFile = require('./js-file');
var TokenIndex = require('./token-index');
var Configuration = require('./config/configuration');

var MAX_FIX_ATTEMPTS = 5;

function getInternalErrorMessage(rule, e) {
    return 'Error running rule ' + rule + ': ' +
        'This is an issue with JSCS and not your codebase.\n' +
        'Please file an issue (with the stack trace below) at: ' +
        'https://github.com/jscs-dev/node-jscs/issues/new\n' + e.stack;
}

/**
 * FixCycleState - tracks the state of the fix loop.
 *
 * This class provides public API for external tools to inspect:
 * - Which rounds have been executed
 * - Whether a fixed point has been reached
 * - Whether oscillation has been detected
 * - Errors from each round
 *
 * @name FixCycleState
 */
var FixCycleState = function() {
    this.rounds = [];
    this.currentRound = 0;
    this.reachedFixedPoint = false;
    this.detectedOscillation = false;
    this.detectedNonConvergence = false;
    this.previousSources = [];
    this.warnings = [];
};

FixCycleState.prototype = {
    /**
     * Start a new round.
     *
     * @param {String} source - source code before fixes
     * @param {Number} errorCount - number of errors before fixes
     */
    startRound: function(source, errorCount) {
        this.rounds.push({
            round: this.currentRound,
            sourceBefore: source,
            errorCountBefore: errorCount,
            errors: [],
            fixesApplied: 0,
            sourceAfter: null,
            errorCountAfter: 0
        });
    },

    /**
     * Record an error for the current round.
     *
     * @param {Object} error
     */
    recordError: function(error) {
        if (this.rounds.length > 0) {
            this.rounds[this.rounds.length - 1].errors.push(error);
        }
    },

    /**
     * Record that a fix was applied.
     */
    recordFix: function() {
        if (this.rounds.length > 0) {
            this.rounds[this.rounds.length - 1].fixesApplied++;
        }
    },

    /**
     * End the current round.
     *
     * @param {String} source - source code after fixes
     * @param {Number} errorCount - number of errors after fixes
     */
    endRound: function(source, errorCount) {
        if (this.rounds.length > 0) {
            var round = this.rounds[this.rounds.length - 1];
            round.sourceAfter = source;
            round.errorCountAfter = errorCount;

            if (round.fixesApplied === 0) {
                this.reachedFixedPoint = true;
            }

            if (round.sourceBefore === source) {
                this.warnings.push('Round ' + this.currentRound + ': fixes were marked but code did not change');
            }

            if (this.previousSources.indexOf(source) !== -1) {
                this.detectedOscillation = true;
                this.warnings.push('Oscillation detected in round ' + this.currentRound);
            }

            this.previousSources.push(source);
        }

        this.currentRound++;
    },

    /**
     * Mark that non-convergence was detected.
     */
    markNonConvergence: function() {
        this.detectedNonConvergence = true;
        this.warnings.push('Maximum fix attempts (' + MAX_FIX_ATTEMPTS + ') reached without convergence');
    },

    /**
     * Get all warnings.
     *
     * @returns {String[]}
     */
    getWarnings: function() {
        return this.warnings.slice();
    },

    /**
     * Check if the error should appear in final output.
     * This implements the logic: if error was fixed AND code actually changed,
     * it should NOT appear in final output.
     *
     * @param {Object} error
     * @param {Boolean} codeActuallyChanged
     * @returns {Boolean}
     */
    shouldErrorAppearInFinalOutput: function(error, codeActuallyChanged) {
        if (error.fixed && codeActuallyChanged) {
            return false;
        }
        return true;
    }
};

/**
 * Starts Code Style checking process.
 *
 * @name StringChecker
 */
var StringChecker = function() {
    this._configuredRules = [];

    this._errorsFound = 0;
    this._maxErrorsExceeded = false;

    this._configuration = this._createConfiguration();
    this._configuration.registerDefaultPresets();
};

StringChecker.prototype = {
    /**
     * Registers single Code Style checking rule.
     *
     * @param {Rule} rule
     */
    registerRule: function(rule) {
        this._configuration.registerRule(rule);
    },

    /**
     * Registers built-in Code Style checking rules.
     */
    registerDefaultRules: function() {
        this._configuration.registerDefaultRules();
    },

    /**
     * Get processed config.
     *
     * @return {Object}
     */
    getProcessedConfig: function() {
        return this._configuration.getProcessedConfig();
    },

    /**
     * Loads configuration from JS Object. Activates and configures required rules.
     *
     * @param {Object} config
     */
    configure: function(config) {
        this._configuration.load(config);

        this._configuredRules = this._configuration.getConfiguredRules();
        this._maxErrors = this._configuration.getMaxErrors();
    },

    /**
     * Checks file provided with a string.
     *
     * @param {String} source
     * @param {String} [filename='input']
     * @returns {Errors}
     */
    checkString: function(source, filename) {
        filename = filename || 'input';

        var file = this._createJsFileInstance(filename, source);

        var errors = new Errors(file);

        file.getParseErrors().forEach(function(parseError) {
            if (!this._maxErrorsExceeded) {
                this._addParseError(errors, parseError, file);
            }
        }, this);

        if (file.isEmpty()) {
            return errors;
        }

        this._checkJsFile(file, errors);

        return errors;
    },

    /**
     * Standard rule protocol: execute a rule's check phase.
     * This is the only way rules should be invoked for checking.
     *
     * @param {Rule} rule
     * @param {JsFile} file
     * @param {Errors} errors
     * @private
     */
    _executeRuleCheck: function(rule, file, errors) {
        errors.setCurrentRule(rule.getOptionName());

        try {
            rule.check(file, errors);
        } catch (e) {
            errors.setCurrentRule('internalError');
            errors.add(getInternalErrorMessage(rule.getOptionName(), e), file.getProgram());
        }
    },

    /**
     * Standard rule protocol: execute a rule's fix phase.
     * This is the only way rules should be invoked for fixing.
     * Implements the standard protocol:
     * 1. Set error.fixed = true first
     * 2. Call rule's fix method
     * 3. Rule can override by setting error.fixed = false
     *
     * Supports both public `fix` (new standard) and private `_fix` (backward compatibility).
     *
     * @param {Rule} rule
     * @param {JsFile} file
     * @param {Object} error
     * @returns {Boolean} whether the error was fixed
     * @private
     */
    _executeRuleFix: function(rule, file, error) {
        if (!rule) {
            return false;
        }

        var fixMethod = rule.fix || rule._fix;
        if (!fixMethod) {
            return false;
        }

        error.fixed = true;
        fixMethod.call(rule, file, error);

        return !!error.fixed;
    },

    /**
     * Apply fix for common errors.
     *
     * @param {Error} error
     * @return {Boolean} whether the correction was carried out
     * @private
     */
    _fixCommonError: function(error) {
        if (error.fix) {
            error.fixed = true;
            error.fix();
        }

        return !!error.fixed;
    },

    /**
     * Apply fix for specific error using the standard rule protocol.
     *
     * @param {JsFile} file
     * @param {Error} error
     * @return {Boolean} whether the correction was carried out
     * @private
     */
    _fixSpecificError: function(file, error) {
        var configuration = this.getConfiguration();
        var rule = configuration.getConfiguredRule(error.rule);

        return this._executeRuleFix(rule, file, error);
    },

    /**
     * Apply specific and common fixes.
     *
     * @param {JsFile} file
     * @param {Errors} errors
     * @param {FixCycleState} [fixState]
     * @protected
     */
    _fixJsFile: function(file, errors, fixState) {
        errors.getErrorList().forEach(function(error, index) {
            if (error.fixed) {
                return;
            }

            if (fixState) {
                fixState.recordError(error);
            }

            try {
                var isFixed = this._fixCommonError(error);

                if (!isFixed) {
                    this._fixSpecificError(file, error);
                }

                if (error.fixed && fixState) {
                    fixState.recordFix();
                }
            } catch (e) {
                error.fixed = false;
                errors.add(
                    getInternalErrorMessage(error.rule, e),
                    file.getProgram()
                );
            }
        }, this);
    },

    /**
     * Checks a file specified using JsFile instance.
     * Fills Errors instance with validation errors.
     *
     * @param {JsFile} file
     * @param {Errors} errors
     * @protected
     */
    _checkJsFile: function(file, errors) {
        if (this._maxErrorsExceeded) {
            return;
        }

        var errorFilter = this._configuration.getErrorFilter();

        this._configuredRules.forEach(function(rule) {
            this._executeRuleCheck(rule, file, errors);
        }, this);

        this._configuration.getUnsupportedRuleNames().forEach(function(rulename) {
            errors.add('Unsupported rule: ' + rulename, file.getProgram());
        });

        var program = file.getProgram();
        var tokenIndex = new TokenIndex(program.getFirstToken());
        errors.calculateErrorLocations(tokenIndex);
        errors.filter(function(error) {
            if (error.element) {
                return tokenIndex.isRuleEnabled(error.rule, error.element);
            } else {
                return true;
            }
        });

        errors.sortErrors(function(a, b) {
            return (a.line - b.line) || (a.column - b.column);
        });

        if (errorFilter) {
            errors.filter(errorFilter);
        }

        if (this.maxErrorsEnabled()) {
            if (this._maxErrors === -1 || this._maxErrors === null) {
                this._maxErrorsExceeded = false;

            } else {
                this._maxErrorsExceeded = this._errorsFound + errors.getErrorCount() > this._maxErrors;
                errors.stripErrorList(Math.max(0, this._maxErrors - this._errorsFound));
            }
        }

        this._errorsFound += errors.getErrorCount();
    },

    /**
     * Adds parse error to the error list.
     *
     * @param {Errors} errors
     * @param {Error} parseError
     * @param {JsFile} file
     * @private
     */
    _addParseError: function(errors, parseError, file) {
        if (this._maxErrorsExceeded) {
            return;
        }

        errors.add(parseError, file.getProgram());

        if (this.maxErrorsEnabled()) {
            this._errorsFound += 1;
            this._maxErrorsExceeded = this._errorsFound >= this._maxErrors;
        }
    },

    /**
     * Creates configured JsFile instance.
     *
     * @param {String} filename
     * @param {String} source
     * @private
     */
    _createJsFileInstance: function(filename, source) {
        return new JsFile({
            filename: filename,
            source: source,
            es3: this._configuration.isES3Enabled()
        });
    },

    /**
     * Checks and fix file provided with a string.
     *
     * @param {String} source
     * @param {String} [filename='input']
     * @returns {{output: String, errors: Errors, fixCycleState: FixCycleState}}
     */
    fixString: function(source, filename) {
        filename = filename || 'input';

        var file = this._createJsFileInstance(filename, source);
        var errors = new Errors(file);

        var parseErrors = file.getParseErrors();
        if (parseErrors.length > 0) {
            parseErrors.forEach(function(parseError) {
                this._addParseError(errors, parseError, file);
            }, this);

            return {output: source, errors: errors, fixCycleState: null};
        } else {
            var fixState = new FixCycleState();
            this._lastFixCycleState = fixState;

            var attempt = 0;
            var originalSource = source;
            var lastSource = source;

            do {
                fixState.startRound(file.render(), errors.getErrorCount());

                this._checkJsFile(file, errors);
                this._fixJsFile(file, errors, fixState);

                var newSource = file.render();
                var codeActuallyChanged = newSource !== lastSource;

                var hasFixes = errors.getErrorList().some(function(err) {
                    return err.fixed;
                });

                fixState.endRound(newSource, errors.getErrorCount());

                if (!hasFixes) {
                    errors.filter(function(error) {
                        return fixState.shouldErrorAppearInFinalOutput(error, codeActuallyChanged);
                    });
                    break;
                }

                if (!codeActuallyChanged) {
                    errors = new Errors(file);
                    break;
                }

                lastSource = newSource;
                file = this._createJsFileInstance(filename, newSource);
                errors = new Errors(file);
                attempt++;
            } while (attempt < MAX_FIX_ATTEMPTS);

            if (attempt >= MAX_FIX_ATTEMPTS && !fixState.reachedFixedPoint) {
                fixState.markNonConvergence();
            }

            this._errorsFound = 0;
            this._maxErrorsExceeded = false;

            return {output: file.getSource(), errors: errors, fixCycleState: fixState};
        }
    },

    /**
     * Public API to get the fix cycle state from the last fixString call.
     *
     * @returns {FixCycleState|null}
     */
    getLastFixCycleState: function() {
        return this._lastFixCycleState || null;
    },

    /**
     * Returns `true` if max erros limit is enabled.
     *
     * @returns {Boolean}
     */
    maxErrorsEnabled: function() {
        return this._maxErrors !== null && this._maxErrors !== -1;
    },

    /**
     * Returns `true` if error count exceeded `maxErrors` option value.
     *
     * @returns {Boolean}
     */
    maxErrorsExceeded: function() {
        return this._maxErrorsExceeded;
    },

    /**
     * Returns new configuration instance.
     *
     * @protected
     * @returns {Configuration}
     */
    _createConfiguration: function() {
        return new Configuration();
    },

    /**
     * Returns current configuration instance.
     *
     * @returns {Configuration}
     */
    getConfiguration: function() {
        return this._configuration;
    }
};

module.exports = StringChecker;
